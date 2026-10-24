# Design notes

Reusable design guidance for the chat-story engine. Each new game should make
its own visual choices; keep the shared messenger structure and do not inherit
another game's palette, artwork or narrative identity.

## Product shape

- The main experience is a phone-width chat shell, centered on wider screens.
- The shared runtime supports a contact list, threaded chat, reply choices,
  character profiles, a photo gallery, optional Places conversations and
  Settings.
- The how-to page is a separate, readable prose column.
- Story content is local JSON and local assets. Saves and preferences stay on
  the device.
- Story Studio reads local files in the browser, validates the same format as
  the CLI, and opens a preview with isolated progress. It must never upload
  content or write into a selected folder without explicit user action.
- Production builds include a same-origin offline cache. It must not cache or
  fetch third-party assets.

## Theme tokens

The engine markup expects these Tailwind v4 theme tokens in
`src/story/theme.css`, imported by `src/style.css`:

| Token | Use |
| --- | --- |
| `--color-chat-950` | App background and chat canvas |
| `--color-chat-800` | Headers, incoming bubbles and tab bar |
| `--color-chat-700` | Borders, controls and input surfaces |
| `--color-out-600` | Player bubbles and primary actions |
| `--color-out-500` | Outlined actions |
| `--color-tick-400` | Active state, links and focus |
| `--color-ink-100` | Primary text |
| `--color-ink-300` | Secondary text and timestamps |
| `--color-gold-500` | Stat bars |
| `--color-gold-300` | Stat values |
| `--color-parchment-300` | Profile quote text |
| `--text-xs` | Small print, set to at least `0.8125rem` |

Keep token names stable because the engine's utility classes depend on them.
Choose a palette for the current game and verify text contrast rather than
adding one-off colors throughout the markup.

## Responsive layout and interface patterns

- Design the base layout for a 375px viewport. The shell is capped at 480px;
  the how-to page uses a prose-width column.
- Keep chat messages readable, distinct by sender and easy to scan. Reply
  choices sit near the thread; the input appears only when the story requests
  typed input.
- Keep tab labels visible alongside icons. Use text labels, not color alone, to
  convey active, locked, unread or completed states.
- Give the gallery clear folder headings and make the photo viewer usable by
  touch, keyboard and assistive technology.
- Keep profile facts and stats grouped under visible headings. Avoid hiding the
  meaning of a control in decoration alone.
- Settings should explain that saves are local and destructive actions have no
  undo. Keep confirmations close to the action.
- Modal viewers and confirmations must trap focus and return it to the opener;
  dynamically inserted reply choices should be announced.

## Accessibility

- Use one `h1` per page and maintain heading order.
- Provide a focusable skip link on the main app shell, visible focus indicators,
  and keyboard access to navigation, choices, forms and dialogs.
- Make tap targets at least 44px on narrow screens.
- Keep body-text contrast at or above 4.5:1 and never communicate meaning with
  color alone.
- Label form fields with real labels; announce status and errors as text.
- The message thread is a polite live log. New messages must not steal focus.
- Supply meaningful image alt text and dimensions; mark decorative images
  appropriately.
- Respect `prefers-reduced-motion`.

## Shell contract

`src/index.html` provides the view containers and IDs consumed by
`src/engine/app.ts`. Before changing or removing those IDs, update the engine
and verify all affected views. Keep the app shell and how-to page as complete
HTML documents with matching metadata and script/style references.

## Review

Check the app at mobile width for horizontal overflow, reachable content,
working keyboard navigation and usable controls. Check the browser console and
verify the story in a representative playthrough after structural changes.
