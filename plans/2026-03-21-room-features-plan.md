# Plan: add persistent player identity, creator-only room control, richer round controls, and custom word mode

## Summary

Implement a room-scoped identity model backed by a random per-browser token in `localStorage`, then use that identity to:
- restore player identity after refresh/reconnect,
- preserve creator ownership across reconnects,
- restrict room control actions to the creator,
- support richer round settings and in-game question history,
- add custom word-list play and room URL copy.

Chosen defaults:
- creator = **first player who joins the room**
- creator identity is restored by the same stable `localStorage` token
- creator-only actions = **all control actions**
- spy-count distribution UI = **Uniform** or **Geometric**, with geometric using a fixed built-in lower-count bias
- custom word mode = creator pastes a newline-separated list in room settings
- replaying/restarting with custom words should **re-sample a fresh subset**

## Key implementation changes

### 1) Persistent identity + reconnect
- Replace the current cookie-only reconnect approach with a browser-generated random auth token stored in `localStorage`.
- On room join, client sends `{ gameCode, authToken, previousName? }`; server binds players to token, not just name.
- Extend `Player` state with a stable identity key and creator flag ownership lookup.
- On refresh/reconnect:
  - if a disconnected player with the same token exists, reattach the socket to that player,
  - preserve name, creator role, current role, and disconnected/connected state,
  - keep existing “return to room on disconnect” flow, but make it reconnect the same identity instead of relying on cookies.
- Keep room creator tied to the first joined token; no automatic transfer unless explicitly added later.

### 2) Creator-only room controls
- Add creator metadata to room state so UI can render creator badges and creator-only controls.
- Restrict these socket actions server-side to the creator only:
  - start game
  - end game
  - pause/resume timer
  - remove player
  - all room settings changes
  - custom word-list edits
- Non-creator attempts should be ignored or rejected with a lightweight socket event the UI can surface.

### 3) Room settings: spy count range + distribution + custom words
- Extend `Game.settings` with:
  - `spyCountMin`
  - `spyCountMax`
  - `spyCountDistribution` = `uniform | geometric`
  - custom word mode fields, e.g. `customWordsEnabled`, `customWordsText`, `customSubsetSize`
- Add creator-only lobby controls for:
  - min/max spy count range (validated to `1 <= min <= max < playerCount`)
  - distribution select: Uniform / Geometric
  - custom word mode textarea for newline-separated words
  - subset size control for custom word mode
- Server start-game flow:
  - compute spy count from the configured range and distribution,
  - assign that many spies,
  - for normal packs, keep current location/role behavior except with multiple spies,
  - for custom words mode:
    - parse and clean the pasted list,
    - randomly trim the full list to a subset for this round/game,
    - choose one word from that subset,
    - spies do not see the chosen word,
    - non-spies see only the chosen word,
    - do **not** show roles in this mode,
    - use the sampled subset as the in-game reference list,
    - resample the subset again on each new round/start.

### 4) In-game question chooser + shared history
- Add a shared round history model on the server, reset when a new round starts.
- Add question events/state for:
  - asker chooses target player
  - asker submits two candidate question texts
  - target chooses one of the two
  - target enters an answer
  - server appends the resolved exchange to history
- UI behavior:
  - any player can open the question helper,
  - asker selects target + enters two options,
  - target sees both and chooses one,
  - target submits answer,
  - everyone sees a shared chronological history log of chosen question + answer pairs.
- Keep this as a helper/logging system only; do not enforce turn order beyond the existing “first player” display.

### 5) Copy room URL
- Update the room/access-code UI to include a “Copy room URL” button.
- Build URL from `window.location.origin + "/" + code` so it works on HTTP and HTTPS.
- Prefer `navigator.clipboard.writeText`; fall back to hidden-input + `document.execCommand("copy")` for plain HTTP/intranet environments.

## Public/interface changes

- **Socket join payload** gains `authToken`; reconnect logic should use token-first matching.
- **Game state payload** returned via `gameChange` gains fields for:
  - creator identity/permissions (at least `me.isCreator`, optionally per-player creator flag)
  - extended settings (`spyCountMin`, `spyCountMax`, `spyCountDistribution`, custom-word settings)
  - round history
  - pending question prompt state if one is active
- **New/updated socket events**:
  - updated: `joinGame`
  - creator-only settings setters for spy range/distribution/custom words
  - question workflow events (submit prompt, choose prompt, submit answer)
  - optional unauthorized/error event for denied admin actions

## Test plan

- Identity/reconnect:
  - new browser gets token and joins normally
  - refresh restores same player identity and name
  - creator refresh keeps creator powers
  - in-game reconnect preserves spy/non-spy assignment
- Creator-only controls:
  - creator can start/end/pause/remove/change settings
  - non-creator cannot perform any restricted action
  - UI hides/disables restricted controls for non-creators
- Spy count range:
  - uniform distribution produces values across configured range
  - geometric distribution favors lower counts in the same range
  - invalid ranges are rejected server-side
  - multiple spies are assigned distinctly and consistently
- Custom word mode:
  - pasted list is cleaned and validated
  - subset is randomly sampled from the full list
  - chosen word is shown only to non-spies
  - role display is suppressed in this mode
  - replay/new round re-samples subset
- Question helper/history:
  - asker can submit two options and target
  - only target can choose the option and submit the answer
  - chosen question + answer appear in shared history in order
  - history resets on new round
- Copy URL:
  - works on HTTP via fallback path
  - copies full room URL for the current room

## Assumptions

- “Refreshing the page will re-use user identity” means identity is browser-local, not account-based.
- Creator ownership is room-scoped and persists only while that token’s player record exists in the room.
- Custom word mode is an alternative to normal location-pack play, not a mix of both in one round.
- Shared question history is visible to all players, including spies, as requested.
- No turn-enforcement system is added beyond the helper/history flow and existing first-player indicator.
