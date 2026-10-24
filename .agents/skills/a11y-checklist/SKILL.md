---
name: a11y-checklist
description: Accessibility floor every story page and chat view must meet
---

# Accessibility Checklist

Verify each item on every new or changed page:

1. Exactly one `h1`; headings in order with no level skips.
2. Skip-to-content link present and focusable.
3. `lang` matches the content language.
4. Images have `alt` (empty only if decorative) plus dimensions or aspect
   ratio to prevent layout shift.
5. Body text contrast at least 4.5:1; meaning never carried by color alone.
6. Visible focus states; tabs, reply buttons, links, the input bar and the
   lightbox all keyboard-reachable (`Escape` closes the lightbox).
7. Form fields labeled with real `<label>`, native `required`/`type=`
   validation, errors announced as text.
8. Tap targets at least 44px on narrow viewports.
9. The message log is a polite live region (`role="log"`,
   `aria-live="polite"`) and new messages never move focus.
