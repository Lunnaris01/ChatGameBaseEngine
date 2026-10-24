# Engine improvements and roadmap

## Executive summary

This update turns the starter from a collection of story files and a single
runtime into a safer, testable, local-first authoring product. It fixes a real
conversation-restart race, gives authors a browser-based validate/edit/preview
loop, protects player saves with portable backups, and makes production builds
installable and available offline after caching. The work stays inside the
project's core promise: no backend, accounts, analytics, tracking, or remote
assets.

## Improvements delivered

### 1. Conversation playback is cancellable and restart-safe

The original chat runner could keep advancing after a restart because the old
and new async runners shared a generation. A restart during typing could post an
old message into the fresh transcript or shift the new queue. `RunGate` now
invalidates stale work on thread changes and restarts, and pending delays are
cleared instead of leaving background timers. Choice, quiz, and typed-reply
interactions are explicitly cancelled so they do not leave orphaned promises.
Restart now asks first and describes exactly what is reset.

**Value:** prevents duplicated, skipped, or mixed story state at a destructive
control that players can reach at any time.

### 2. Saves are portable, validated, and scoped

Storage access is centralized in `src/engine/storage.ts`. Clearing game progress
no longer clears unrelated origin storage, and Story Studio previews use an
isolated namespace so they cannot overwrite a player's real saves. Settings can
export a versioned local JSON backup and import it only after validation and a
confirmation. Imports reject unsupported keys, malformed thread data, invalid
save slots, and oversized files; replacement attempts include a best-effort
rollback.

**Value:** reduces the risk of accidental data loss while preserving the
offline, device-only privacy model.

### 3. Story validation catches more than malformed JSON

The shared parser now validates sound configuration and local ambience files,
rejects ineffective `waitSeconds`/`inChat` combinations, requires a remembered
value gate to use exactly one comparison, warns about missing milestone and
memory writers, and warns when a story has no ending marker. Sound discovery is
recursive in both Vite and the CLI, eliminating the previous mismatch where a
deeply nested sound could pass the CLI but be absent from the app. The checker
also warns about images larger than 1.5 MB.

**Value:** catches silent authoring mistakes before playtesting and keeps the
browser preview and command-line validator aligned.

### 4. Story Studio shortens the author feedback loop

`/studio.html` loads either the bundled sample or a local story folder. Authors
can edit JSON and `theme.css`, see live schema errors and warnings, inspect a
nested route outline across chats and Places, download the edited file, and open
a phone preview using local assets. Preview progress is namespaced separately.
The browser does not upload files or write into a selected directory.

**Value:** reduces the amount of manual command-line inspection and makes the
existing JSON format more approachable without introducing a server or a
second source of truth.

### 5. Mai is a five-chapter romance and engine test fixture

Mai's five chapters tell a clear romance ministory: a returned map, a first
Teahouse date, a riverside walk, an honest question, and a final invitation.
The Tutorial unlocks Mai, keeping the cast to exactly two characters. The
Teahouse and Riverside Garden provide four in-person scenes with memory, photos,
sound, speakers, and chained `unlock-place` behavior. Local illustrations and
generated notification/ambience WAVs keep the story self-contained. Choices and
alternative endings still exercise stats, gates, quizzes, content toggles, and
cross-chat features without making the romance depend on hidden technical lore.

**Value:** authors and maintainers have a concrete, playable reference for the
engine rather than a format guide alone.

### 6. Accessibility and small-screen behavior improved

The game shell is now a semantic `<main>` with real view headings. Reply and
quiz choices announce their availability; the photo viewer traps keyboard
focus, handles Escape and arrow keys, and restores focus; destructive restart
and backup replacement use native dialogs. Small print now follows the 13px
design floor, and focus styles cover textareas and selects used by Story Studio.

**Value:** improves keyboard and assistive-technology use while keeping controls
touch-sized on phones.

### 7. Story identity and interface language are data-driven

`story.json` now supports `lang` and validated UI-string overrides in addition
to title and description. The game and How to play page use the configured title
and language, Settings reflects the story title, and the production PWA manifest
is generated with that identity. Frequently used navigation, Settings,
dialogue-state, gallery, profile, and How to play strings can be overridden
without changing engine files.

**Value:** prevents generic title drift and gives authors a safe foundation for
localizing the core interface.

### 8. Production builds are installable and offline-capable

The build now emits an installable web manifest, a local icon, a same-origin
service worker, and a generated precache manifest covering the built game. The
worker caches only same-origin GETs and removes outdated project caches. No
third-party files are fetched.

**Value:** makes a bundled story more reliable when the player is offline and
supports installation without adding a backend.

### 9. Tests and CI protect the format and utilities

`bun run check` now performs strict TypeScript checking, CLI story validation,
and Bun tests. Tests cover the Mai chapter and Place step inventories, remembered
conditions, missing milestone/wait validation, storage isolation, backup
validation, localization, and runner-generation cancellation. A GitHub Actions
workflow runs checks and a production build on pushes and pull requests.

**Value:** moves regressions from manual discovery into repeatable checks. The
current suite contains 22 passing tests.

### 10. Runtime responsibilities have clearer boundaries

Independent cross-cutting behavior is now in focused modules: `run-gate.ts`,
`storage.ts`, `backup.ts`, `i18n.ts`, and `pwa.ts`. The large app function still
coordinates view state and the story runner, but storage rules, translation
fallbacks, cancellation tokens, backups, and offline registration are isolated
and testable rather than duplicated inline.

**Value:** lowers the cost of changing high-risk behavior without a large
rewriting of the established DOM-driven runtime.

### 11. Story-only documentation is complete and discoverable

`STORY_GUIDE.md` documents profiles, every step type, gates, stat branches,
memory, profile reveals, quizzes, photo/gallery behavior, sounds, Places,
endings, themes, UI translations, saves, backups, validation, and the Mai test
route. `src/story/README.md` and the root README now point authors to one source
of truth.

**Value:** lets a writer learn the content format without reading TypeScript.

### 12. Message timing now scales with message length

`src/engine/pacing.ts` supplies a bounded default typing duration based on
visible character count and a default reply pause based on word count. The rule
is applied to incoming text, scripted player lines, choice replies, quiz answers,
and photo captions. Existing story-authored `typing` and `pause` overrides still
take precedence, are speed-scaled as before, and now validate as 0–60,000 ms.
Calculated defaults are clamped so short messages remain readable and long ones
cannot stall the story indefinitely; an author can still explicitly ask for a
longer pause within the validated limit.

**Value:** prevents rapid bursts of long scripted player messages while avoiding
the same fixed wait for every short reply.

## Verification snapshot

- `bun run check`: strict TypeScript, story validation, and 22 tests pass.
- `bun run build`: Vite production build and offline precache generation pass.
- The dev server returns the game and Story Studio at 375px; headless Chrome
  loads the Studio, validates the bundled story, and renders the route outline.
- The shipped sample validates as exactly two character definitions (Tutorial
  and Mai), five Mai chapters, and four scenes across two locations.

## Future outlook

The following items are proposals, not work completed in this update. Scores
rate importance/value from 1 (low) to 10 (high).

### Further improvements

| Rank | Improvement | Value | Why next |
| ---: | --- | ---: | --- |
| 1 | Add a bounded route simulator that explores combinations of choices, stat branches, memories, and cross-chat unlocks. | 10/10 | The current linter checks references and structural paths, but exhaustive route coverage remains the strongest way to catch soft locks. |
| 2 | Add a larger browser/accessibility test matrix for keyboard, screen readers, reduced motion, and multiple mobile viewport heights. | 9/10 | The current checks include a headless smoke pass, but manual assistive-technology coverage should be formalized. |
| 3 | Migrate long transcripts and large saves to IndexedDB while preserving versioned local JSON backups. | 8/10 | Local storage is simple and portable, but large image-heavy stories can approach browser quota limits. |
| 4 | Add build-time asset dimensions, duplicate-name, and audio-duration diagnostics. | 7/10 | The current size warning catches large images; deeper media diagnostics would make phone delivery more predictable. |

### Features worth adding

| Rank | Feature | Value | Player/author benefit |
| ---: | --- | ---: | --- |
| 1 | Visual node editor for choices, conditions, and endings, with JSON export as the source of truth. | 10/10 | Makes complex branching easier to understand and author. |
| 2 | Deterministic “play this route” test plans that save a named sequence of replies and expected milestones. | 9/10 | Reproduces bugs and verifies narrative branches quickly. |
| 3 | Local thumbnail/format generation for story art, with author approval before replacing files. | 8/10 | Improves initial download and gallery performance on phones. |
| 4 | Complete locale packs, including plural rules, date formatting, and right-to-left layout support. | 8/10 | Extends the new language metadata and UI overrides into full localization. |
| 5 | A release/export wizard that packages the selected story, validates references, and produces a ready-to-host offline bundle. | 8/10 | Gives writers a repeatable handoff from source files to a playable release. |
