---
name: design-tokens
description: Theme tokens and spacing rhythm for chat-story games
---

# Design Tokens

Define once in `src/story/theme.css` with Tailwind v4 `@theme`, reuse
everywhere (`src/style.css` imports that file). The engine's markup references
these names, so a theme must define them all — the values are chosen fresh per
story:

```css
@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --color-chat-950: #...; /* app background, thread canvas */
  --color-chat-800: #...; /* top bars, incoming bubble, tab bar */
  --color-chat-700: #...; /* borders, inputs */
  --color-out-600: #...;  /* outgoing bubble, primary buttons */
  --color-out-500: #...;  /* outlined buttons */
  --color-tick-400: #...; /* the single accent */
  --color-ink-100: #...;  /* primary text */
  --color-ink-300: #...;  /* secondary text, timestamps */
  --color-gold-500: #...; /* stat bars */
  --color-gold-300: #...; /* stat values */
  --color-parchment-300: #...; /* profile quote */
}
```

Rules:

- Keep the token names; the engine depends on them. Chat surfaces stay
  neutral, one accent carries color. Never invent a new hex per element —
  extend the theme instead.
- Type: thread text `0.9375rem`–`1rem` relaxed leading; screen titles
  `text-lg` bold; small print never below `0.8125rem`.
- Rhythm: bubbles `px-3 py-2` with `space-y-2` in the thread, screens `px-3`/
  `px-4`, bars `py-3`, tab bar `min-h-14` — tap targets never below 44px.
- The phone-width shell caps at 480px; only the how-to page uses
  `max-w-prose`.
