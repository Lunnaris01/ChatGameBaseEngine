# Devlog

Development notes for the game. Newest first.

## 2026-10-24 — Let players choose a seen Home wallpaper

- Moved the default Home wallpaper into story assets at
  `assets/system/default_background.png`, added `assets/misc/` for generic
  story art, and route referenced `misc/` images to the General Gallery.
- Added a Gallery lightbox Background action for revealed/seen images, a
  Settings reset to the system default, and local/backup persistence for the
  wallpaper preference. Unrevealed placeholders cannot be selected.
- Browser-tested selection, reset, and story-image availability at 375px. The
  supplied default PNG triggers the validator's advisory to optimize images
  larger than 1.5 MB; it remains unchanged.
- `bun run check` passes with 27 tests; the production build and offline precache
  succeed.

## 2026-10-24 — Add a phone-style Home launcher

- Added a local Pexels wallpaper and Home app grid for Chats, Places, Gallery,
  Games, Characters and Settings. The wallpaper is bundled locally with source
  attribution and no runtime image-host request.
- Kept only Chats, Places, Gallery and Settings in the bottom quickbar; app
  headers return to Home, while chat and location threads keep their own back
  behavior and hide the quickbar.
- Browser smoke-tested app navigation, the four-item quickbar and 375px layout;
  no runtime exceptions occurred.

## 2026-10-24 — Add a local wallet and first minigame

- Added a `$100` player wallet, saved with local progress, manual save slots and
  portable backups; deleting progress returns it to the starting balance.
- Added optional whole-dollar location costs, charged once on a new scene entry
  and never on revisits; the sample Teahouse date scenes cost `$40`.
- Added a replayable four-card/two-pair memory game in a new Games tab. Each win
  earns `$20`; documented and tested wallet, pricing and match rules.
- `bun run check` passes with 26 tests and production build succeeds. A 375px
  browser smoke test confirmed the four-card reward, saved/restored wallet,
  Teahouse first-entry charge and free revisit, with no console exceptions.

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
