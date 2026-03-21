#!/usr/bin/env zsh

set -euo pipefail

ROOT_DIR=${0:A:h}
CONFIG_FILE="$ROOT_DIR/.self-host.env"
INSTALL_STAMP="$ROOT_DIR/.self-host.install-stamp"
CADDYFILE="$HOME/Caddyfile"
DEFAULT_HOST="spy.pinky.lilf.ir"
DEFAULT_PORT="3300"
DEFAULT_SESSION="spyfall-app"
NODE_VERSION="20"
CADDY_BEGIN="# BEGIN spyfall self-host"
CADDY_END="# END spyfall self-host"
PROXY_EXPORTS='export ALL_PROXY=http://127.0.0.1:2097 all_proxy=http://127.0.0.1:2097 http_proxy=http://127.0.0.1:2097 https_proxy=http://127.0.0.1:2097 HTTP_PROXY=http://127.0.0.1:2097 HTTPS_PROXY=http://127.0.0.1:2097 npm_config_proxy=http://127.0.0.1:2097 npm_config_https_proxy=http://127.0.0.1:2097'

tmuxnew () {
	tmux kill-session -t "$1" &> /dev/null || true
	tmux new -d -s "$@"
}

usage() {
	cat <<'EOF'
Usage:
  ./self_host.zsh setup [url]
  ./self_host.zsh redeploy [url]
  ./self_host.zsh start
  ./self_host.zsh stop

Notes:
  - The default URL is spy.pinky.lilf.ir.
  - Override the backend port with SPYFALL_PORT=3301 ./self_host.zsh setup ...
  - For pure intranet HTTP, pass a scheme too, e.g. http://spy.lan
EOF
}

die() {
	print -u2 -- "Error: $*"
	exit 1
}

caddy_site_label() {
	if [[ "$SPYFALL_HOST" == *"://"* ]]; then
		print -- "$SPYFALL_HOST"
	else
		print -- "http://$SPYFALL_HOST"
	fi
}

load_saved_config() {
	local env_host="${SPYFALL_HOST-}"
	local env_port="${SPYFALL_PORT-}"
	local env_session="${SPYFALL_SESSION-}"

	if [[ -f "$CONFIG_FILE" ]]; then
		source "$CONFIG_FILE"
	fi

	export SPYFALL_HOST="${env_host:-${SPYFALL_HOST:-$DEFAULT_HOST}}"
	export SPYFALL_PORT="${env_port:-${SPYFALL_PORT:-$DEFAULT_PORT}}"
	export SPYFALL_SESSION="${env_session:-${SPYFALL_SESSION:-$DEFAULT_SESSION}}"
}

write_config() {
	{
		printf 'SPYFALL_HOST=%q\n' "$SPYFALL_HOST"
		printf 'SPYFALL_PORT=%q\n' "$SPYFALL_PORT"
		printf 'SPYFALL_SESSION=%q\n' "$SPYFALL_SESSION"
	} > "$CONFIG_FILE"
}

require_commands() {
	local cmd
	for cmd in tmux caddy zsh curl ss python3; do
		command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
	done
}

require_node_toolchain() {
	zsh -ic "whence -w nvm-load >/dev/null && nvm-load && nvm use ${NODE_VERSION} >/dev/null && command -v node >/dev/null && command -v npm >/dev/null && command -v pnpm >/dev/null" \
		|| die "Unable to load Node ${NODE_VERSION} with nvm-load, npm, and pnpm."
}

run_node_task() {
	local task="$1"
	local quoted_root=${(q)ROOT_DIR}
	zsh -ic "set -e; $PROXY_EXPORTS; nvm-load; nvm use ${NODE_VERSION} >/dev/null; cd ${quoted_root}; ${task}"
}

lock_hash() {
	sha256sum "$ROOT_DIR/package-lock.json" | awk '{print $1}'
}

install_dependencies_if_needed() {
	local current_hash
	current_hash=$(lock_hash)

	if [[ -d "$ROOT_DIR/node_modules" && -f "$INSTALL_STAMP" && "$(cat "$INSTALL_STAMP")" == "$current_hash" ]]; then
		print -- "Skipping dependency install; package-lock.json is unchanged."
		return
	fi

	print -- "Installing dependencies with pnpm..."
	rm -rf "$ROOT_DIR/node_modules"
	run_node_task "export HUSKY=0; rm -f pnpm-lock.yaml; pnpm import; pnpm install --store-dir ./.pnpm-store --reporter append-only --network-concurrency 1 --fetch-retries 20 --fetch-retry-factor 2 --fetch-retry-mintimeout 2000 --fetch-retry-maxtimeout 120000"
	print -- "$current_hash" > "$INSTALL_STAMP"
}

ensure_swc_wasm_workaround() {
	if [[ ! -f "$ROOT_DIR/node_modules/@next/swc-wasm-nodejs/package.json" ]]; then
		print -- "Installing Next.js SWC wasm fallback..."
		run_node_task "npm install --no-save --prefer-offline --no-fund --no-audit @next/swc-wasm-nodejs@14.2.5"
	fi

	python3 - <<'PY'
from pathlib import Path

root = Path("/home/ubuntu/base/spyfall-dev")
next_root = root / "node_modules" / "@next"

for name in ("swc-linux-x64-gnu", "swc-linux-x64-musl"):
    src = next_root / name
    dst = next_root / f"{name}.disabled"
    if src.exists() and not dst.exists():
        src.rename(dst)

swc_index = root / "node_modules" / "next" / "dist" / "build" / "swc" / "index.js"
text = swc_index.read_text()

marker = '        const unsupportedPlatform = triples.some((triple)=>!!(triple == null ? void 0 : triple.raw) && knownDefaultWasmFallbackTriples.includes(triple.raw));\n'
if 'const forceWasmFallback = process.env.SPYFALL_FORCE_WASM === "1";' not in text:
    text = text.replace(
        marker,
        marker + '        const forceWasmFallback = process.env.SPYFALL_FORCE_WASM === "1";\n',
    )

old_should = '        const shouldLoadWasmFallbackFirst = !disableWasmFallback && unsupportedPlatform && useWasmBinary || isWebContainer;'
new_should = '        const shouldLoadWasmFallbackFirst = (!disableWasmFallback && unsupportedPlatform && useWasmBinary) || isWebContainer || forceWasmFallback;'
text = text.replace(old_should, new_should)

old_load = 'async function loadWasm(importPath = "") {'
new_load = '''async function loadWasm(importPath = "") {\n    if (process.env.SPYFALL_FORCE_WASM === "1" && !importPath) {\n        importPath = _path.default.dirname(_path.default.dirname(require.resolve("next/package.json")));\n    }'''
if 'process.env.SPYFALL_FORCE_WASM === "1" && !importPath' not in text:
    text = text.replace(old_load, new_load)

swc_index.write_text(text)
PY
}

port_in_use() {
	local port="$1"
	ss -ltn | awk '{print $4}' | grep -Eq "(^|:)$port\$"
}

update_caddyfile() {
	local tmp_file
	tmp_file=$(mktemp)

	if [[ -f "$CADDYFILE" ]]; then
		cp "$CADDYFILE" "${CADDYFILE}.spyfall.bak"
		local skipping=0
		while IFS= read -r line || [[ -n "$line" ]]; do
			if [[ "$line" == "$CADDY_BEGIN" ]]; then
				skipping=1
				continue
			fi
			if [[ "$line" == "$CADDY_END" ]]; then
				skipping=0
				continue
			fi
			(( skipping == 0 )) && print -r -- "$line" >> "$tmp_file"
		done < "$CADDYFILE"
	fi

	if [[ -s "$tmp_file" ]]; then
		print >> "$tmp_file"
	fi

	cat >> "$tmp_file" <<EOF
$CADDY_BEGIN
	$(caddy_site_label) {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$SPYFALL_PORT
}
$CADDY_END
EOF

	mv "$tmp_file" "$CADDYFILE"
	if ! caddy validate --config "$CADDYFILE" >/dev/null; then
		if [[ -f "${CADDYFILE}.spyfall.bak" ]]; then
			mv "${CADDYFILE}.spyfall.bak" "$CADDYFILE"
		fi
		die "Caddyfile validation failed; restored the previous $CADDYFILE"
	fi

	if pgrep -x caddy >/dev/null 2>&1; then
		print -- "Reloading Caddy..."
		caddy reload --config "$CADDYFILE"
	else
		print -- "Caddy is not running; start it manually with: caddy run --config $CADDYFILE"
	fi
}

stop_app() {
	if tmux has-session -t "$SPYFALL_SESSION" 2>/dev/null; then
		tmux kill-session -t "$SPYFALL_SESSION"
		print -- "Stopped tmux session: $SPYFALL_SESSION"
	else
		print -- "tmux session not running: $SPYFALL_SESSION"
	fi
}

start_app() {
	if port_in_use "$SPYFALL_PORT" && ! tmux has-session -t "$SPYFALL_SESSION" 2>/dev/null; then
		die "Port $SPYFALL_PORT is already in use; set SPYFALL_PORT to a free port and rerun setup."
	fi

	local quoted_root=${(q)ROOT_DIR}
	local start_cmd="nvm-load; nvm use ${NODE_VERSION} >/dev/null; cd ${quoted_root}; export PORT=${SPYFALL_PORT} NODE_ENV=development NEXT_PUBLIC_ENABLE_EXTERNAL_HELP=0 SPYFALL_FORCE_WASM=1; unset NEXT_PUBLIC_GA_MEASUREMENT_ID; exec node server.js"
	local tmux_cmd="zsh -ic ${(q)start_cmd}"

	tmuxnew "$SPYFALL_SESSION" "$tmux_cmd"
	print -- "Started tmux session: $SPYFALL_SESSION"

	local attempt
	for attempt in {1..120}; do
		if port_in_use "$SPYFALL_PORT"; then
			print -- "Spyfall is live at $(caddy_site_label) -> 127.0.0.1:$SPYFALL_PORT"
			print -- "The first browser request can take a bit while Next compiles in dev mode."
			print -- "Logs: tmux attach -t $SPYFALL_SESSION"
			return
		fi
		sleep 1
	done

	die "Spyfall did not become ready; inspect logs with: tmux attach -t $SPYFALL_SESSION"
}

setup_or_redeploy() {
	local maybe_host="${1-}"
	if [[ -n "$maybe_host" ]]; then
		SPYFALL_HOST="$maybe_host"
	fi

	[[ -n "$SPYFALL_HOST" ]] || die "Host cannot be empty."
	[[ "$SPYFALL_PORT" != "3000" ]] || die "Port 3000 is reserved by another service; choose a different SPYFALL_PORT."

	write_config
	update_caddyfile
	install_dependencies_if_needed
	ensure_swc_wasm_workaround
	start_app
}

main() {
	local command="${1-}"
	load_saved_config
	require_commands
	require_node_toolchain

	case "$command" in
		setup)
			setup_or_redeploy "${2-}"
			;;
		redeploy)
			setup_or_redeploy "${2-}"
			;;
		start)
			start_app
			;;
		stop)
			stop_app
			;;
		""|-h|--help|help)
			usage
			;;
		*)
			usage
			die "Unknown command: $command"
			;;
	esac
}

main "$@"
