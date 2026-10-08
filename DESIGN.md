# Design: Milon-PT

Dark, modern and slightly edgy minimalism, with a light theme as an alternative. Minimal does not mean flat: calm and clear without clutter, but with character from typography, contrast and a single accent color. Mobile first, with 390–412 px as the reference width.

## Principles

- One accent color that only marks what is happening *now*: the active set, done sets, PRs, primary actions and progress. Everything else is neutral.
- Depth comes from barely visible differences in surface tones and hairlines, not from shadows, gradients or glass.
- Typography does the work: large, clear numbers (monospace) against a calm grotesque for text.
- Large touch targets (at least 44 × 44 px). The app is used with sweaty fingers between sets.
- Focus: only the active set is large and prominent. Done and upcoming sets are muted.

## Design tokens

CSS variables in `src/routes/+layout.svelte`. The theme follows the phone by default and can be chosen under Konto (`data-theme` on `<html>`, stored in localStorage and applied before first paint by `static/theme-init.js`).

### Colors

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg` | `#0A0A0B` | `#F3F2EE` | Screen background |
| `--surface` | `#17171A` | `#FAFAF8` | Cards, sheets |
| `--surface-2` | `#26262A` | `#E2DFD7` | Buttons, fields |
| `--active-set` | `#1F1F22` | `#E2DFD7` | Active set card (darker than buttons in dark, so its grey text reads better) |
| `--step` | `#37373C` | `#CFCBC1` | −/+ buttons in the active set |
| `--seg` | `#26262A` | `#D6D3CA` | Inactive progress segments |
| `--text` | `#F2F2F0` | `#18181A` | Body text, numbers of done sets |
| `--heading` | `#C8C8CD` | `#3C3C40` | Large headings (deliberately greyer than `--text`) |
| `--muted` | `#8E8E94` | `#605F59` | Labels, secondary lines, last session's values |
| `--soft` | `#BDBDC2` | `#4A4946` | Secondary text, e.g. the "Nästa" line |
| `--dim` | `#818188` | `#6E6D66` | Prefilled values of upcoming sets |
| `--line` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.09)` | Hairlines |
| `--ring` | `rgba(255,255,255,.22)` | `rgba(0,0,0,.28)` | Empty circle for a set not done, border of the user's own chat bubbles |
| `--accent` | `#5EEAD4` | `#0D6B63` | The only accent color, both as fill and as text |
| `--on-accent` | `#0A0F0C` | `#FFFFFF` | Text and icons on the accent |

The light theme uses a darker mint so the same color works everywhere: as a fill, as text and in charts. Error messages use a muted red (`--danger`); destructive buttons have no color of their own and are protected by placement and confirmation instead.

Contrast: all text at least 4.5:1 against its surface. Surfaces step up visibly in both themes: `--surface-2` is about 1.19:1 or more against both `--bg` and `--surface`, so buttons and fields stand out on cards and sheets. Mint `#0D6B63` is 5.7:1 on the light background and 4.8:1 on `--surface-2`; white text on it is 6.4:1.

### Typography

- **Headings and text:** Bricolage Grotesque (400–600).
- **Numbers and time:** DM Mono (400, 500). All weights, reps, set numbers and times.
- The fonts are self-hosted in `static/fonts/` (latin subset, SIL Open Font License) so they work offline.
- No uppercase labels. Labels are sentence case.

| Element | Font | Size / weight | Notes |
|---|---|---|---|
| Exercise heading | Bricolage | 34–48 px / 600, line-height 1.05 | `--heading` |
| Page heading ("Hej Sofie", "Din träning") | Bricolage | 40 px / 600 | `--heading` |
| Overline ("Övning 2 av 5") | Bricolage | 13 px / 500 | `--muted` |
| Table headers (Set, Förra, Kg, Reps) | Bricolage | 12 px / 500 | `--muted` |
| Done sets: kg and reps | DM Mono | 20 px / 500 | `--text` |
| Set number and "Förra" column | DM Mono | 13 px / 400 | `--muted` |
| Active set: kg and reps | DM Mono | 34 px / 500 | letter-spacing `-0.04em`, `--accent` |
| Upcoming sets (prefilled) | DM Mono | 20 px / 400 | `--dim` |
| Button text | Bricolage | 14–15 px / 500 | |

### Shape and spacing

- Page margin 20 px.
- Buttons: radius 14 px (rounded rectangles, not pills), at least 44 px tall (48 px for main buttons).
- Active set: radius 6 px. PR tag: radius 8 px. Progress segments: radius 2 px. Sheets: radius 24 px at the top.
- 1 px hairlines in `--line`. No shadows.

## Active workout: one exercise at a time

1. **Top bar (56 px):** close button on the left (pause or discard), workout name and elapsed time in the middle, "Avsluta" on the right (opens the summary).
2. **Progress:** one segment per exercise. Done in `--accent`, current in `--text`, upcoming in `--seg`. The segments can be tapped.
3. **Exercise block:** overline, heading, target and last time. The "Instruktion" and "Fråga Milon" buttons. Last session's note.
4. **Set list:** columns `28px 64px 1fr 1fr 44px` (Set, Förra, Kg, Reps, done). Reps-only and timed exercises have one value column.
   - Active set: card in `--active-set`, with no hairline directly above it. Weight is typed, reps use −/+, time uses −5/+5 and Starta/Stopp. "Ta bort set" sits far from the done button and can be undone.
   - Done set: values in `--text`, check in `--accent`, PR tag for a new record.
   - Upcoming set: prefilled values in `--dim`, empty ring.
   - Every set can be tapped and changed until the workout is finished.
5. **"Lägg till set"** at full width, and the **"Nästa" line** with the upcoming exercises.
6. **Action bar at the bottom:** previous exercise and "Nästa: …", which turns accent when every set is done. On the last exercise: "Sammanfattning".
7. **Swipe** sideways to change exercise (`touch-action: pan-y` on the area, otherwise Chrome on Android takes over the gesture).

No rest timer.

## Interaction

- Marking a set done: a short vibration and the next set becomes active. When every set in the exercise is done it vibrates twice.
- While a timer runs, changing exercise or set, leaving or finishing first asks: stop and save, discard the time, or keep the timer going.
- New record: a short glow on the PR tag. No big animations, and none at all with reduced motion.
- Everything tappable has a pressed state and a visible focus ring.

## Other screens

- **Start:** greeting with first name and date, this week's sessions against the weekly goal, a card for a workout in progress, workout cards with their first exercises.
- **Workout overview** (before "Starta passet"): a list with hairlines, per exercise the name ("Inbytt"/"Ny" tag), target, last time's note and an "Instruktion" toggle when there is one; on the right "Byt" and a small Milon icon (icon only, with an aria-label). One "Fråga Milon om passet" below the list. No weights or reps here.
- **History:** week card (today outlined in the accent, volume per type without a heading), milestones, exercises grouped by workout with search.
- **Exercise:** chart and the latest sessions as rows (date, best value, sets, note, volume).
- **Create workout:** collapsible exercise list at the top, chat, composer that never covers the last message. The user's own messages are grey with a `--ring` border. Versions in a sheet.
- **Account:** weekly goal, theme, import, sign-out.
- The main menu (Start, Historik, Skapa, Konto) is fixed at the bottom except during a workout.

## Accessibility

- At least 44 × 44 px touch targets for every button and done marker.
- Real `button` elements with `aria-label` on icon buttons ("Klarmarkera set 3", "Minska reps").
- Color never carries meaning alone: done/active/upcoming also differ in size, weight and icon.

## Avoid

Gradients, glassmorphism, shadows on cards, rounded pastel cards, emoji as icons, uppercase labels and more than one accent color.
