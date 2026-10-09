# Milon avatar

Milon is the AI coach. His avatar is an abstract face built from the logo's parts: the two outer plates are the eyes and the logo's V is the mouth. Everything is drawn in `currentColor`, so it takes `--accent`.

| File | Use |
|---|---|
| `milon.svg` | The avatar. Each path has a class: `eye eye-l`, `eye eye-r`, `mouth`. |
| `logo-to-milon.svg` | The logo turning into Milon, a blink, and back. SMIL, 5 s loop, no CSS or JS needed. For the intro. |
| `logo-to-milon.gif` | The same animation as a GIF (256 px, mint on `#0A0A0B`), for use outside the app. |
| `milon-blink.gif` | Milon alone, blinking once every 3 s (256 px, mint on `#0A0A0B`), for use outside the app. |
| `avatar-preview.html` | Standalone preview: intro size, chat size (28 px) in a circle and on its own, light and dark. |

## In the app

- **Chats** (the builder and the exercise swap): 28 px in a circle with `--surface-2` as background, the face at about 80 % of the circle.
- **Thinking:** both eyes blink together while Milon is working. Inline the SVG (an `<img>` gets neither `currentColor` nor the classes) and add the class `blink` to the `<svg>`:

```css
.eye { transform-box: fill-box; transform-origin: center; }
.blink .eye { animation: blink 1.6s ease-in-out infinite; }
@keyframes blink { 0%, 70%, 100% { transform: scaleY(1); } 80% { transform: scaleY(0.15); } }
@media (prefers-reduced-motion: reduce) { .blink .eye { animation: none; } }
```

- **Intro:** inline `logo-to-milon.svg` the same way so it takes the accent color. SMIL respects no `prefers-reduced-motion` setting on its own; show `milon.svg` instead when the user has asked for reduced motion.

The logo geometry is in `assets/logo/logo.svg`; `logo-to-milon.svg` starts and ends on it.
