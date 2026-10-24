# ChatGameBaseEngine

WhatsApp-style game engine for storytelling games.

A phone-width, messenger-style story game built with Bun, Vite, Tailwind CSS v4,
and strict TypeScript. The runtime is reusable; each game's content is JSON and
local assets under `src/story/`. Progress stays in browser storage. There is no
backend, account system, analytics, tracking, or remote asset dependency.

## Run and validate

```bash
bun install
bun run dev
bun run check       # typecheck + story validation + tests
bun run build       # production build + offline precache manifest
bun run preview
```

Open `http://localhost:8080/` to play. Story authors can open
`http://localhost:8080/studio.html` to load a folder, edit JSON or the theme,
inspect a route outline, validate, download a file, and preview it in an
isolated phone tab. The browser cannot write files back into the source folder.

## Write only a story

Read [`STORY_GUIDE.md`](STORY_GUIDE.md) for the complete content format and
examples. In short:

1. Edit `src/story/story.json` for title, description, language, and UI labels.
2. Add `characters/<id>/<id>.json` for a profile and `chapterN.json` for each
   chapter.
3. Put local artwork and sound under `src/story/assets/`.
4. Add optional Places under `src/story/locations/` and choose a palette in
   `src/story/theme.css`.
5. Run `bun run check`, open Story Studio or the game, and play important paths.

The bundled Tutorial is a reusable guide and unlocks Mai's five-chapter romance
ministory. Tutorial and Mai are the only character definitions. The Teahouse
and Riverside Garden include in-person scenes with unlockable follow-ups.

When replacing Mai, also update or remove the Tutorial's `unlock` step so it
targets the first character in your story.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/engine/` | Runtime, discovery, format parser, storage, localization, and UI |
| `src/story/` | Character and place content, local art/audio, metadata, palette |
| `src/public/` | PWA manifest, icon, and same-origin service worker |
| `src/studio.html` | Local story editing, validation, route outline, and preview |
| `STORY_GUIDE.md` | Story-only development guide with examples for all features |
| `scripts/check-story.ts` | CLI story validation and content diagnostics |
| `scripts/precache.ts` | Builds the production offline asset list |
| `tests/` | Parser, storage, localization, pacing, and runner-gate tests |
| `.github/workflows/check.yml` | CI typecheck, story check, tests, and build |
| `dist/` | Generated production output; never edit by hand |

## Local persistence and optional native wrapper

Six in-browser save slots are available in Settings. Players can export/import
a validated local JSON backup. Clearing browser site data removes saves if they
have not been backed up. The production build includes a same-origin PWA shell
and can work offline after it is cached.

Capacitor dependencies and a placeholder `capacitor.config.ts` remain for a
future native wrapper. Platform-specific Android/iOS projects are not included;
change the placeholder app ID and name before creating a native build.
