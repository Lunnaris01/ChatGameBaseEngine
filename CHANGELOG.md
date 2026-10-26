# Story changelog

## 2026-10-26 — Rework to fantasy story game

- Replaced dating-sim sample content with a fantasy starter: Tutorial character creation, Adventurer's Guild receptionist, and a forest gathering job with a goblin encounter.
- Added Trust/Friendship connection stats and character combat stats (Health, Defense, Strength, Agility, Intelligence, Cunning) with types and main stat.
- Added player character, inventory, thought/narrator bubbles, text-based combat, autosave and death recovery.

Story-level changes to the cast, chats and narrative — the human-readable
"what happened" log. Newest first. Raw change history stays in git; this is the
narrative view. See `AGENTS.md` ("Tracking") for how to keep it current.

## 2026-10-24 — Add optional date pricing to the sample

- The Teahouse's new date scenes cost `$40` on first entry; revisiting a scene
  is free. The player starts with `$100`, and the new memory game provides a
  repeatable way to earn money without changing Mai's story route.

## 2026-10-24 — Rewrite Mai as a five-chapter romance

- Turned Mai's route into a five-chapter romance ministory, from returning a map
  through a first date and a final invitation.
- Kept the Tutorial as the only other character and let its first choice unlock
  Mai and the first Teahouse scene.
- Added Teahouse and Riverside Garden scene chains for in-person dialogue,
  shared memories, photos, sounds, and `unlock-place` behavior.
- Added local map, plant, and garden illustrations and updated the story bible.
