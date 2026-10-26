# Fantasy Rework Plan

Detailed step-by-step plan. Execute in order; verify with `bun run check` after each major step.

## Phase 0 — Housekeeping files (done)
- AGENTS.md updated to fantasy game description.
- README.md and DEVLOG/CHANGELOG will be finalized after implementation.

## Phase 1 — Types and data model
1. Replace `Stat` set: `trust`, `friendship` (range -50..50). STAT_MAX=50, STAT_START defaults 0.
2. Add character combat stats: `Health` (default 50), `Defense`, `Strength`, `Agility`, `Intelligence`, `Cunning` (0..100). Type field: Fighter/Assassin/Archer/Mage. `mainstat` maps type.
3. Add inventory model: 7 equipment slots (leftHand, rightHand, upperArmor, lowerArmor, boots) + gold + potions. Player-specific.
4. Add thought/narrator message support: `from: "thought" | "narrator"` maybe. Add step type `thought`/`narrate` or msg with from.
5. Add enemy type and combat scene types.
6. Add player character storage.

## Phase 2 — Story validator & discovery
1. Update character JSON parsing for new stats, type, mainstat, combat stats, starter connection stats.
2. Add enemy discovery (`locations/*/enemies/*.json` or `locations/enemies/`).
3. Validate enemy schema.
4. Update Place chat visited/cost as needed.

## Phase 3 — Content
1. Remove old Mai/tutorial romance content (already removed).
2. Create Tutorial character + chapter with class/name selection, 7-day training, equipment, thought bubbles.
3. Create Adventurer Guild receptionist character + chapter.
4. Create forest location with inner monologue and goblin encounter.
5. Create goblin spy enemy JSON.
6. Create player character tab.

## Phase 4 — UI/Engine
1. Thought bubbles and narrator centered bubbles in chat.
2. Player character tab and profile.
3. Combat view (text-based) with attack/potion.
4. Autosave function and trigger points.
5. Death handling (load save/restart).
6. Time system starts year 736/737 (cosmetic clock? Could be year in chapter text).

## Phase 5 — Cleanup
1. Remove unused dating-sim leftovers (money? keep gold; memory game? maybe remove or keep as optional). Inspect.
2. Remove dead assets.
3. Update tests.
4. Housekeeping files final.

## Phase 6 — Quality
1. Typecheck, story check, tests, build.
2. 375px review.
