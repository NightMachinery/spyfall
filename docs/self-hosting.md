# Self-hosting

Use `./self_host.zsh` to run Spyfall behind your existing user-level Caddy instance without Docker.

## What it does

- uses Node 20 through `nvm-load` + `nvm use 20`
- uses the required HTTP proxy during dependency installation
- runs the custom Next/Express server in tmux
- forces Next onto the wasm SWC fallback so it works behind this firewall/runtime
- writes an idempotent `spyfall self-host` block into `~/Caddyfile`
- reloads Caddy after changing the config

The script stores its local settings in `.self-host.env` and defaults to:

- URL: `spy.pinky.lilf.ir`
- app port: `3300`
- tmux session: `spyfall-app`

Port `3000` is intentionally not used.
The generated Caddy site block is HTTP-only by default because this environment cannot obtain certificates through the firewall.
It runs the app in development mode, which makes `redeploy` simply restart the latest local checkout instead of depending on a production build.

## Commands

From the repo root:

```bash
./self_host.zsh setup
./self_host.zsh setup spy.pinky.lilf.ir
./self_host.zsh setup http://spy.lan
./self_host.zsh redeploy
./self_host.zsh redeploy spy2.pinky.lilf.ir
./self_host.zsh start
./self_host.zsh stop
```

### `setup [url]`

Initial deploy. It:

1. saves the chosen URL to `.self-host.env`
2. updates `~/Caddyfile`
3. reloads Caddy
4. runs `pnpm import` + `pnpm install` if dependencies are missing or `package-lock.json` changed
5. starts the app in tmux

### `redeploy [url]`

Same flow as `setup`, but intended for pushing the latest local working tree back into production. It restarts the tmux session against your current checkout and only reruns dependency installation when `package-lock.json` changed.

### `start`

Starts the app from the saved `.self-host.env` settings.
The port comes up before the first page compile finishes, so the first browser load can take a little longer than later ones.

### `stop`

Stops the `spyfall-app` tmux session.

## Caddy block

The script keeps a managed block in `~/Caddyfile`:

```caddyfile
# BEGIN spyfall self-host
http://spy.pinky.lilf.ir {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3300
}
# END spyfall self-host
```

If you pass a different URL to `setup` or `redeploy`, the script rewrites this block. If you pass a bare host like `spy.pinky.lilf.ir`, the script still writes it as `http://spy.pinky.lilf.ir`.

## Intranet notes

- The self-host flow does not rely on any external font/CDN requests; browsers fall back to local system fonts if the optional font packages are unavailable.
- The self-host flow disables Google Analytics unless you explicitly rebuild with `NEXT_PUBLIC_GA_MEASUREMENT_ID`.
- The self-host flow also disables the embedded YouTube/PDF help content so the client remains usable on an intranet with no public internet access.
- A successful dependency install writes `.self-host.install-stamp`, so later `redeploy` runs can skip the network when `package-lock.json` is unchanged.
- The script uses `pnpm import` + `pnpm install` with a repo-local `.pnpm-store` to better tolerate flaky network downloads.
- The script also installs `@next/swc-wasm-nodejs` and patches the local Next SWC loader so the app does not try to fetch native SWC binaries at runtime.

If you want a different backend port, override it before `setup`:

```bash
SPYFALL_PORT=3310 ./self_host.zsh setup spy.pinky.lilf.ir
```

## Logs

Attach to the running app:

```bash
tmux attach -t spyfall-app
```

Detach with `Ctrl-b` then `d`.
