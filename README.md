# Spyfall

Open source online Spyfall rooms you can run locally or self-host.

## Project links

- Repository: https://github.com/NightMachinery/spyfall
- Issues: https://github.com/NightMachinery/spyfall/issues
- Default branch for changes: `dev`

## Current feature highlights

- private rooms with reconnect-aware player identity
- built-in plain-text wordpacks with per-player language fallback
- flexible spy counts, including zero-spy rounds
- optional spy-role refusal flow
- accusation voting and terminal accusations
- custom word mode
- dark mode
- local visual + sound event cues with per-event-set toggles

## Development

1. Install Node.js 20 and npm 10.
2. Install dependencies: `npm install`
3. Start the app: `npm run dev`
4. Open the server URL shown in the console.
5. Create pull requests against the `dev` branch.
6. Production flow: `npm run build` then `npm start`

## Tips

- Set `PORT` to change the default port.
- If `NODE_ENV=development`, you can open `/ffff` to jump into the built-in dev room.
- The room URL shown in the app is generated from the current server origin at runtime.
- Built-in wordpacks now live under `./wordpacks/`.
- Self-hosting uses `./self_host.zsh start` for production and `./self_host.zsh dev-start` for hot-reloading development.

## Docs

- `docs/self-hosting.md` — VPS/self-host deploy flow
- `docs/2026-04-21-round-flow-and-branding.md` — gameplay, cue, and branding changes added in this update
- `docs/2026-04-23-wordpacks.md` — wordpack storage, locale fallback, and migration notes
