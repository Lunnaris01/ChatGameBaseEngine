# Upgrade an existing story project

This guide is for bringing a story written for an earlier version of the
engine into the current engine. **At this point, the story format has not had a
backwards-incompatible change.** If your existing story already uses the
engine's story-file layout, you can reuse its characters, chapters, locations,
images, and sounds as they are; no story rewrite or conversion script is
needed.

The upgrade is mainly a content move: use the current engine, then put your
existing story content under its `src/story/` folder. Keep the current engine
and app files intact.

## 1. Start with the current engine

Use a clean copy of the current engine, or update your existing engine project
without replacing the current runtime, app entry points, root configuration,
or build files with older copies. Keep a separate backup of your old project
until the new one has passed validation and you have tested it in a browser.

Install dependencies from the current project root:

```bash
bun install
```

## 2. Copy your story into `src/story/`

Copy the **contents** of your old story folder into the current
`src/story/`, keeping the directory structure and filenames. The current
engine discovers story files from these paths automatically; you do not need
to register characters, locations, or assets in an engine file.

```text
src/story/
├── story.json                  # optional game title, description, language, UI text
├── theme.css                   # optional theme
├── characters/
│   └── alex/
│       ├── alex.json           # profile; folder and profile ID match
│       ├── chapter1.json
│       └── chapter2.json
├── locations/                  # optional in-person scenes
│   └── teahouse.json
└── assets/
    ├── portraits/alex.svg
    ├── alex/chapter1/photo.webp
    └── sounds/
        ├── sounds.json         # optional sound mapping
        └── evening.wav
```

If your previous project already has this layout, copy its `story.json`,
`theme.css`, `characters/`, `locations/`, and `assets/` into the matching
current paths. You can also replace the starter's sample story content with
yours. Keep or replace the files **inside** `src/story/`; do not copy an old
engine over the current `src/engine/`.

### What gets discovered

- A character lives in `src/story/characters/<id>/`. Its profile must be named
  `<id>.json`, alongside chapter files such as `chapter1.json`.
- Each optional place is a JSON file directly inside
  `src/story/locations/`; its filename (without `.json`) is the place ID.
- Images belong anywhere inside `src/story/assets/`. References in story JSON
  are paths relative to `assets/`, normally without the filename extension.
  For example, `alex/chapter1/photo` refers to
  `assets/alex/chapter1/photo.webp`.
- Sound files belong inside `src/story/assets/sounds/`. If the story configures
  sound events, bring along `assets/sounds/sounds.json` as well as the audio
  files it names.
- `story.json` and `theme.css` are optional. If you do not have them, the
  engine's default game details and theme are used.

Keep IDs, capitalization, subfolders, and filenames consistent with the paths
referenced by your JSON. If your old project used a different folder layout,
move files into the paths above and update only the affected asset or ID
references.

## 3. Validate the imported story

From the current project root, run:

```bash
bun run story:check
```

This checks the story files in `src/story/` using the same parser used by the
game and Story Studio. Fix any reported errors, and review warnings such as
missing or unusually large assets. Then run the full project checks and build:

```bash
bun run check
bun run build
```

The current `STORY_GUIDE.md` describes the supported story fields and step
types. Consult it if validation points to a format detail you are unsure
about. The guide is the reference for the current engine; do not remove a
field just because it is unfamiliar without checking its meaning first.

## 4. Play through it and open Story Studio

Start the app and open the game and Story Studio locally:

```bash
bun run dev
```

- Play a representative route, including important branches and unlocks.
- Check that character profiles, chapter order, places, galleries, and media
  appear as expected, and that referenced images and sounds load.
- Open `http://localhost:8080/studio.html`, load the story folder, and run its
  validation and preview as an additional check.
- Test on a phone-width viewport and check the browser console for errors.

Story Studio edits are local to the browser session: download edited files and
put them back at their matching paths in `src/story/`.

## What this upgrade does not move

This process migrates **story content**, not a previous engine installation or
its generated `dist/` output. Do not copy `node_modules/`, build output, or the
old runtime over the current one. Player progress and preferences are stored
locally in the browser, not in the story folder; back them up separately in the
game if you need to preserve them. After the migration, make a fresh production
build so the current engine bundles and discovers your copied content.

If a future engine version changes the story format incompatibly, this guide
will be updated with specific conversion instructions. No such conversion is
currently required for stories written for the earlier engine format.
