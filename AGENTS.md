# AGENTS.md

## Project

This is a web-first, chat-based story-game engine and authoring starter. It uses
Bun, Vite, Tailwind CSS v4 and strict TypeScript. The app is a phone-width shell
with a chat list, message threads, reply choices, a gallery, character profiles,
optional in-person conversations in Places, and Settings. There is no backend
or account system; game progress and preferences stay in the browser's
`localStorage`.

The export is a clean starting point, not a finished narrative. It includes the
reusable Tutorial, Mai's five-chapter romance test story, and Teahouse/Riverside
scenes. Tutorial unlocks Mai. The author rewrites the sample story and replaces
the art, places and palette for each new game.

## Engine and story content

Keep the boundary between implementation and content clear:

- `src/engine/` contains the reusable runtime, story-file reader and validator,
  types, storage, localization, screens and bundled interface icons. Do not put
  narrative content here.
- `src/story/` contains author-editable content: JSON character profiles and
  chapters, optional location files, local assets, `theme.css`, and `story.json`.
  `STORY_GUIDE.md` documents the JSON format; keep it aligned with
  `src/engine/story.ts` when the format changes. `src/story/README.md` links to
  that guide.
- `src/studio.html` is a local file-based editor/validator and preview. It must
  remain local-only and must not upload story files.
- Story files are discovered automatically. A character is a folder in
  `src/story/characters/` with a matching profile file; a place is a JSON file
  in `src/story/locations/`. There is no registration list.
- Keep saves local. Do not add a server, account, analytics, tracking, or remote
  asset dependency.

The shipped `src/story/characters/tutorial/` is a reusable in-game guide. Keep
it unless the user asks otherwise. Its sample unlock step currently targets Mai;
retarget that content when replacing Mai.

Mai is a sample and engine test fixture; keep her to five chapters unless the
user requests a narrative continuation. Tutorial demonstrates chat unlocking;
Places-only behavior belongs in `src/story/locations/`.

## Tracking

Keep these project notes current and newest-first:

- `docs/story.md` is the narrative reference: premise, cast, places, arcs,
  connections and open plans. Update it when story content changes.
- `CHANGELOG.md` records story-level changes to characters, scenes and
  narrative. It is not a code-change log.
- `DEVLOG.md` records development and project notes.

Add entries when there is something to record; raw source history remains in
git.

## Commands

Run from this directory:

```bash
bun install          # install dependencies
bun run dev          # local preview with hot reload
bun run test         # Bun test suite
bun run check        # typecheck + story validation + tests
bun run story:check  # validate src/story/ only
bun run build        # production build + offline precache manifest
bun run preview      # preview the production build
bun run sound:make   # generate a sample local WAV sound
bun run sound:make -- --ambient # generate a seamless ambience sample
```

## Validation

Before calling a page, engine change, or story change complete:

1. Run `bun run check` and resolve type errors and story-format errors.
2. Run `bun run build` and confirm the generated `dist/` output exists.
3. Check the changed view and Story Studio at a 375px-wide viewport: no horizontal overflow,
   reachable content, and usable touch targets.
4. Check the browser console for errors on changed pages.
5. When story structure changes, play one representative pass through each
   affected chat or branch. Use Mai's five-chapter route for feature smoke tests;
   use broader simulation when a structural change warrants it.

## Code rules

- Use minimal, semantic HTML (`header`, `nav`, `main`, correctly ordered real
  headings). Avoid unnecessary wrappers, unused classes and unused scripts.
- Build mobile-first. The chat shell stays phone-width and centered on wider
  screens; use responsive breakpoints only where they improve the experience.
- Keep TypeScript strict-clean. Avoid `any`; if unavoidable, explain why in a
  nearby comment.
- Every page is a complete document with `lang`, viewport metadata, a unique
  title and description, stylesheet and shared script includes.
- Give images useful `alt` text (or empty alt for decorative images) and
  explicit dimensions. Story art belongs under `src/story/assets/`.
- Use native form types and validation with clear labels.
- Respect the project's accessibility checklist and design-token skill when
  changing pages or the theme.
- Never edit `dist/` by hand. Keep generated output out of source changes.
