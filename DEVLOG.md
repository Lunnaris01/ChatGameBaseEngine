# Devlog

Development notes for the game. Newest first.

## 2026-10-24 — Length-aware message pacing

- Added bounded, message-length-derived typing and pause defaults for character
  messages, scripted player messages, choices, quiz answers, and photo captions.
- Preserved explicit story timing overrides and applied the existing speed
  multipliers to both defaults and overrides.
- Added pacing and override validation tests; baseline commit: `9dbd606`.

## 2026-10-24 — Engine quality and author workflow

- Installed project dependencies and added a Bun test suite plus CI checks.
- Fixed async runner cancellation on navigation/restart; added restart
  confirmation and keyboard/screen-reader improvements.
- Added validated local save backup/restore, a file-based Story Studio with
  route outline and isolated preview, and story-level UI/language metadata.
- Added recursive sound discovery, sound-config validation, image-size warnings,
  and an installable same-origin offline cache.
- Wrote `STORY_GUIDE.md` and `Improvements.md` for story authors and project
  planning.
- Rewrote Mai's sample as a five-chapter romance, expanded the locations to a
  Teahouse/Riverside scene chain, and set Vite's dev-server default to port 8080.
- Final verification: `bun run check` passes with 22 tests, production build and
  offline precache succeed, and headless Chrome confirms the 375px game/Studio,
  restart cancellation, unlock flows, and offline reopen.
