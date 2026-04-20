# 2026-04-21 round flow, cue, and branding update

This repo update adds several player-facing changes:

## Round flow

- per-question response timers now stay disabled at `0`, otherwise they clamp to a minimum of **15 seconds**
- unanswered questions are logged as **unanswered in time**
- suggested askers are chosen randomly among the players who have asked the fewest questions
- suggested targets are chosen randomly among eligible players who have answered the fewest questions
- zero-spy rounds now wait **5 to 25 seconds** before clues are revealed so they do not stand out from spy-offer rounds
- correctly revealed spies can still spend remaining guesses
- if the final spy is revealed and auto-end is enabled, the round enters a dedicated **guess-only phase** before the final reveal

## Local event cues

Event cues are local to each browser/device and are enabled by default.

Available cue groups:

- Question turns
- Accusations & votes
- Spy-role events
- Round lifecycle
- Admin & room notices

Each cue produces a visual toast plus a short local sound when that group is enabled.

## Branding cleanup

- removed legacy creator/donation/old-host branding from the runtime UI
- switched repo links to `NightMachinery/spyfall`
- made the web app manifest use a relative `start_url`
- kept room/share URLs dynamic by using the current browser origin
- replaced stale footer attribution strings in locale files with neutral project text
