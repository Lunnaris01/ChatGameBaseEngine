# Story bible

The narrative reference for this starter's sample romance. The Tutorial remains
the reusable player guide; in this sample it unlocks Mai and her first date.

## Premise

- **Working title:** A Map to Somewhere
- **One-sentence premise:** A map Mai drew to calm her nerves becomes the route
  for five chapters of messages, tea, and a slowly growing romance.
- **Setting / timeframe:** Friday evening through the next Saturday, in a
  neighborhood teahouse and riverside garden.
- **Genre and tone:** Cozy, gentle romance; clear choices and a patient pace.

## Cast

| ID | Name | Status | Role and arc |
| --- | --- | --- | --- |
| `tutorial` | Tutorial | Reusable guide | Explains the phone and engine basics. |
| `mai` | Mai | Five-chapter ministory | Unlocked by the Tutorial; develops from a returned map into a first date and a hopeful romance. The chapters also demonstrate the chat engine. |

## Places

| ID | Place | Host | Scenes / status |
| --- | --- | --- | --- |
| `teahouse` | The Little Teahouse | Mai | First date and an After hours follow-up. The follow-up unlocks the Riverside Garden. |
| `riverside` | The Riverside Garden | Mai | First walk and sunset path; each scene unlocks the next. |

## Arcs and plot threads

### Mai and the map

- **Setup:** The Tutorial introduces Mai and unlocks her chat. Mai asks the
  player to return a hand-drawn map.
- **Key beats:** A first message and a chosen meeting plan; a Teahouse first
  date; a riverside walk; a vulnerable conversation; and a final invitation.
- **Possible outcomes:** Call it a first date, pause with the promise of more,
  or continue in the Riverside Garden.
- **Planned continuation:** None required; the five chapters form a complete
  ministory, with the garden scenes available as optional in-person moments.

## Connections and shared state

Mai can append a gentle reminder to the Tutorial chat. The Teahouse stores the
chosen seat locally and shares the date milestone with Mai's chat. Completing
After hours unlocks the Riverside Garden's first walk; that scene unlocks the
sunset path.

## Identity

- **Title and description:** `A Map to Somewhere`, set in `src/story/story.json`.
- **Visual direction and palette:** Warm, illustrated, and easy to read; authors
  can replace the starter palette for their own game.
- **Artwork plan:** Local SVG art in `src/story/assets/mai/` for the map, plant,
  and riverside path.
- **Language:** English sample content.

## Open questions and plans

- The ministory is a feature showcase, not a long-form romance.
- Replace Mai's art and story when adapting this starter for a real game.
