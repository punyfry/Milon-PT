# Milon-PT

A personal, minimalist workout log with an AI coach, Milon, who stays quiet until you ask for help. The main goal is to log workouts quickly.

Stack: SvelteKit 2 (Svelte 5) on Vercel, data as JSON files in Vercel Blob, Google sign-in via Auth.js, and the Claude API called from the server.

The app's UI and the AI coach are in Swedish; code and developer docs are in English (see `CLAUDE.md`).

## Principles

- The landing page assumes you are there to log a workout: one tap on a workout card starts it.
- The coach is silent during a workout and only answers when you tap "Hjälp".
- Exercises are objects of their own with their own ID and log. Workouts only reference exercise IDs.
- An ongoing workout lives in the browser (localStorage) until the server has confirmed the save.
- Data is per user under `users/<userId>/`. Only the signed-in user can reach their files, and no blob URLs leave the server.

## Structure

| File | What |
| --- | --- |
| `src/auth.ts` | Auth.js: Google provider (explicit `GOOGLE_OAUTH_*`), allowlist in `signIn`, `userId` = Google's `sub` |
| `src/hooks.server.ts` | Chains security headers, Auth.js and the sign-in guard |
| `src/lib/server/security/` | `guard.ts` (sign-in + allowlist on every request except `/login` and `/auth/*`) and `headers.ts` (security headers). The CSP lives in `svelte.config.js` |
| `src/lib/server/allowlist.ts` | Reads `ALLOWED_EMAILS`. An empty list lets nobody in |
| `src/lib/server/storage/` | The `UserStorage` interface: Vercel Blob (private), local files in `.data/` in dev, and in-memory in tests. Paths are validated in `paths.ts` |
| `src/lib/model/` | The data model: types, validation and id helpers. Shared by server and client |
| `src/lib/server/data/` | Read/write exercises, workout templates (versioned), saved sessions and the profile. `save-session.ts` saves a finished workout and is safe to retry without duplicates |
| `src/lib/server/import/craft.ts` | The Craft import: validate → plan against existing data → write |
| `src/lib/server/ai/` | Claude client, model selection, per-model parameters and the daily limit (`usage.ts`) |
| `src/lib/server/builder/` | The workout builder: system prompt, the `propose_exercise`/`set_workout` tools and the conversation loop |
| `src/lib/server/helper/` | The in-session helper: system prompt and `swap_exercise` |
| `src/lib/session/` | The ongoing workout in the browser: prefill, −/+, timer, localStorage and the queue for workouts saved offline (`outbox.ts`) |
| `src/lib/history/stats.ts` | History: best set, estimated 1RM, records, weekly summary and milestones, computed from the logs |
| `src/lib/markdown.ts` | Simple markdown for the builder's replies, rendered without `{@html}` |
| `src/service-worker.ts` | Offline support: caches the app's files and visited pages |
| `src/routes/` | `/` workout cards, `/pass/[slug]` active workout (one exercise at a time) and finish, `/skapa` the builder, `/historik` and `/historik/ovning/[id]`, `/konto`, `/api/*` |
| `src/lib/components/` | Shared components: `SetRow` (a set in the active workout), `Sheet` (bottom sheet for choices and confirmations), `TabBar` (main menu), `Icon`, `HelpPanel`, `LineChart`, `Markdown` |
| `src/lib/theme.ts` | Theme choice (system, dark, light), stored in localStorage and applied before first paint by `static/theme-init.js` |
| `static/fonts/` | Self-hosted Bricolage Grotesque and DM Mono (latin subset, SIL Open Font License) so they work offline |
| `assets/logo/` | The logo (`logo.svg`, an M that is also a dumbbell, drawn in `currentColor`) and `logo-preview.html`, a standalone preview at different sizes |
| `scripts/` | `import.ts` (import script) and `make_icons.py` (PWA icons and favicon, drawn from the logo) |
| `.claude/` | Agent workflow: the `deliver` skill and the subagents Gregory (review) and Nissa (testing) |

Use storage from a route like this:

```ts
import { storageFor } from '$lib/server/storage';

const storage = storageFor(locals); // scoped to the signed-in user
const profile = await storage.readJson<Profile>('profile.json');
await storage.writeJson('profile.json', data, { ifMatch: profile?.version });
```

Within one request `storageFor` returns the same storage. In GET requests, identical reads and listings share one call (each caller gets its own copy); any write drops what is shared. Every request gets a `Server-Timing` header (total and storage time), and requests that use storage log one `[timing]` line with the route pattern and call counts, so slow views can be traced in the Vercel logs.

## Getting started locally

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the values (see below).
3. `npm run dev` and open http://localhost:5173

Without `BLOB_READ_WRITE_TOKEN` the dev server stores data in local files under `.data/` (gitignored). Production requires the token.

### Environment variables

| Variable | Contents |
| --- | --- |
| `AUTH_SECRET` | Secret for the Auth.js session cookie (`npx auth secret`) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ID. Passed explicitly to the Google provider (Auth.js otherwise looks for `AUTH_GOOGLE_ID`) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth secret, passed the same way |
| `ALLOWED_EMAILS` | Comma-separated list of e-mail addresses allowed to sign in |
| `BLOB_READ_WRITE_TOKEN` | Created when the Blob store is connected to the Vercel project |
| `ANTHROPIC_API_KEY` | Claude API key. Without it the builder and helper answer 503 |
| `MODEL_BUILDER` | Model for the builder (default `claude-sonnet-5-5`) |
| `MODEL_HELPER` | Model for the helper (default `claude-haiku-4-5`) |
| `AI_DAILY_LIMIT` | Max Claude API calls per user and day, builder and helper combined (default 200, `0` disables). One builder turn can make several calls |

### Google OAuth client

In Google Cloud Console → APIs & Services → Credentials → *Create credentials* → *OAuth client ID* (type *Web application*):

- **Authorized JavaScript origins:** `http://localhost:5173` and your Vercel domain, e.g. `https://milon-pt.vercel.app`
- **Authorized redirect URIs:** `http://localhost:5173/auth/callback/google` and `https://milon-pt.vercel.app/auth/callback/google`

If the OAuth consent screen is in *Testing* mode, your e-mail must also be added as a test user. Preview deployments get new URLs, so test sign-in on the production domain.

### Vercel Blob

Create a Blob store in the Vercel project (Storage → Create → Blob) with **private** access and connect it to the project. This creates `BLOB_READ_WRITE_TOKEN`. Pull it locally with `vercel env pull .env.local` or copy it into `.env`.

The store is in Stockholm, and the functions are pinned to the same region (`regions: ['arn1']` in `svelte.config.js`), since each page load makes many storage calls. Change both together.

## Data model

Four file types per user, plus conversations and counters. Sets live on the exercise, a workout is a template pointing at exercise IDs, and a saved session is a light record tying them together.

| File | Contents |
| --- | --- |
| `profile.json` | Goals, rules, weekly goal and kcal estimates per workout type |
| `exercises/<exerciseId>.json` | Exercise with name, type, instruction, `archived` and the full log (newest first) |
| `workouts/<slug>.v<N>.json` | Workout template. Every change creates the next version; older ones are kept and can be restored |
| `sessions/<sessionId>.json` | A completed workout: template and version, start and end, deviations, kcal |
| `builder/<id>.json` | Builder conversations |
| `usage/<YYYY-MM-DD>.json` | Number of AI calls that day (pruned after 30 days) |

```json
{
  "id": "ex_marklyft",
  "name": "Marklyft",
  "type": "weight",
  "instruction": "Stång över mellanfoten, rak rygg, tryck golvet ifrån dig.",
  "archived": false,
  "log": [{ "sessionId": "s_20261006", "date": "2026-10-06", "sets": [{ "weight": 40, "reps": 8 }], "note": "Marginal kvar" }]
}
```

- `type`: `weight` (weight × reps), `bodyweight` (reps) or `time` (seconds). Sets per type: `{ weight, reps }`, `{ reps }` or `{ seconds }`.
- Older files may have a `loadClass` (weight steps). It is no longer used and is dropped when the exercise is read.
- Session ids are `s_YYYYMMDD` (Swedish time), with `_2`, `_3` … for several workouts the same day.
- The ongoing workout is in localStorage under `milonpt.activeSession`; workouts waiting for the network under `milonpt.pendingSaves`.

Volume: `weight` = sum of weight × reps, `bodyweight` = sum of reps, `time` = sum of seconds. Estimated 1RM: weight × (1 + reps / 30). Records count for the best set (1RM, reps or time) and, for weight exercises, the heaviest weight; the first session never counts as a record.

## Screens

The look (tokens, type, layout) is described in [DESIGN.md](DESIGN.md). A fixed main menu (Start, Historik, Skapa, Konto) sits at the bottom of every screen except the active workout and sign-in.

1. **Start:** a greeting with the first name, this week's sessions against the weekly goal (counted like History: saved sessions plus days with only imported log entries), a card for a workout in progress, and the latest version of each workout as a card showing its first exercises, most recently trained first. One tap starts the workout; if another workout is in progress you choose between continuing it and discarding it.
2. **Overview:** tapping a workout opens an overview before it starts: each exercise with its target, last time's sets and note, and the instruction. **Byt** swaps an exercise for this workout only, from a searchable list of your own exercises (same type first) or by asking Milon for variants or new exercises. The overview is an active session with `preparing: true`, saved to localStorage on the first swap, so only looking at a workout leaves nothing behind and a preparation survives closing the app. "Ångra byten" drops the preparation. A preparation without swaps follows the latest version of the workout. "Starta passet" (sticky at the bottom) starts the clock and sets the session id from that day. Opening another workout does not touch a preparation; the first swap or start there replaces it. Swapping back to the plan drops the preparation. A workout in progress is protected as before. The server refuses to save a session that has not started.
3. **Active workout:** one exercise at a time. Move with the Next button (highlighted when every set is done), by swiping sideways or by tapping the progress segments. Sets are prefilled from the latest log entry, otherwise from the template's target, and last time's value is shown per set. Weight is typed, reps and seconds use −/+. Every set stays editable until the workout is finished; a removed set can be undone. Every change is written to localStorage, including the exercise shown, so a paused workout resumes where it was. Timed exercises have a timer in the set row that counts down, beeps at zero and fills in the time; it stores the end time (`timerEndsAt`) so it stays correct if the screen locks, and the screen is kept awake (Wake Lock). Stopping early saves the elapsed time; starting the timer again counts down from the planned time (`plannedSeconds`), unless the time was changed by hand. A new set copies the planned time, and the next workout prefills a timed set below the target with the target (a swapped-in exercise keeps its own logged times); discarding a restarted timer leaves a done set done. While a timer runs, changing set or exercise, leaving or finishing first asks whether to keep the time, discard it or keep the timer going. **Byt** opens the same swap list as the overview; "Fråga Milon" opens the helper in a sheet; swapping an exercise becomes a deviation in the session, not a change to the template. The close button asks whether to pause (keep it on the phone) or discard.
4. **Finish:** summary with time, done sets, new records and each exercise's sets; tap an exercise to go back and change it. If there are deviations you are asked whether to save them as a new version of the workout. kcal is suggested (the profile's value for the workout, otherwise the workout type's range) and can be adjusted. "Avsluta pass" writes the exercise logs and the session record; localStorage is cleared only after the server confirms. "Släng passet" is last, with confirmation.
5. **Create workout:** chat with the builder and a collapsible list of the exercises being discussed at the top. Approved exercises are saved (existing ones are reused), and "Spara pass" creates `v1` or the next version. Older versions are listed in a sheet and can be restored as a new version. On a phone, Enter adds a new line and the send button sends.
6. **History:** week (days with today outlined, sessions vs. weekly goal, volume per type), milestones (Pull-up and Handstand, with progression exercises until the goal exercise is logged), exercises grouped by workout with search and archived ones last, and per exercise a chart and the latest sessions as rows.
   **Session view** (`/historik/pass/[id]`, from the week's session list or a date in an exercise's history): start, end, length, kcal and each exercise's sets. **Redigera** corrects the start time (the start date is fixed, it is part of the session id), the end date and time, kcal and the sets (change, add, remove), and can remove an exercise from the session. **Ta bort pass** deletes the session and its sets; workout versions it created stay. Edits go through `PUT`/`DELETE /api/sessions/[id]` with the record's version, write the log entries first and the record last, and answer 409 if the session changed since the page was loaded. A changed start keeps the saved value in `originalStartedAt`, so a queued retry of the original save is still recognised as already saved (and then writes no log entries).
7. **Account:** weekly goal, theme (system, dark, light), the Craft import and sign-out.

## The AI coach

Two separate calls with their own system prompts, both using tools so the app never parses JSON out of prose. The prompts (in Swedish) are in `src/lib/server/builder/prompt.ts` and `src/lib/server/helper/prompt.ts`.

- **The builder** (`/skapa`, Sonnet): discusses exercises with the catalog, goals and the workout being edited as context. Replies are rendered with simple markdown.
- **The helper** ("Hjälp" button during a workout, Haiku): more instruction or swapping an exercise, with the workout, today's sets and the exercise's five latest log entries as context. Replies in plain text.
- Cost: roughly SEK 4–5 a month for Haiku and SEK 12–20 for Sonnet at about 12 workouts. Besides `AI_DAILY_LIMIT`, set a monthly limit for the API key in the Anthropic Console. A Claude subscription does not cover API calls.

## Craft import

**Easiest:** sign in, go to **Konto → Importera från Craft** and pick the JSON file. The app first shows what would be saved and only saves when you press **Importera**. See `scripts/import-example.json` for the format. Besides exercises and workouts, the file can contain:

- `profile`: `goals` (text or list), `rules`, `kcalEstimates` (`strength`/`hiit` with `min`/`max`) and `weeklySessionGoal`. Existing values are never overwritten; rules are appended.
- `note` on log entries and `archived` on exercises.
- `sessions`: completed workouts `{ date, workout, kcalEstimate? }`. They become session records at 12:00 Swedish time, and log entries from the same day are linked to them.

From the command line (requires `BLOB_READ_WRITE_TOKEN`, or `--local` for `.data/`). Your user ID is shown on `/konto`.

```sh
npm run import -- my-export.json --user <user-id>          # dry run: shows the plan
npm run import -- my-export.json --user <user-id> --apply  # writes
```

- The whole file is validated first and every error is listed with its path. Nothing is written if anything is wrong.
- Exercise names are matched against existing exercises (case and whitespace don't matter). Existing names and instructions are never overwritten.
- The same file can be imported again without duplicates.

## Add to home screen (PWA)

- **Android (Chrome):** menu ⋮ → Install app.
- **iPhone (Safari):** Share → Add to Home Screen (untested, see #17).

Visited pages are available offline; otherwise an offline page is shown. A workout saved without a network is queued and sent when the network is back. The builder and helper need a network. Icons are drawn with `python3 scripts/make_icons.py static/icons` (requires Pillow).

## Security

- Google sign-in and an allowlist checked on every request. An empty list lets nobody in.
- Blob files are always written with `access: 'private'`, and paths are validated so one user can never reach another's files.
- Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, HSTS etc. on pages and API responses from the server (not on static files or redirects to the sign-in page).
- A daily limit on Claude API calls per user (`AI_DAILY_LIMIT`). Every call counts, and the limit is checked before anything is sent.
- `.env*` is gitignored. Real user data does not belong in the repo.

## Quality and CI

| Command | What |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run check` | Type check (svelte-check) |
| `npm test` | Unit tests (vitest) |
| `npm run test:coverage` | Tests with a coverage report |
| `npm run build` | Production build (adapter-vercel) |
| `npm run import` | The import script, see above |

GitHub Actions (`.github/workflows/ci.yml`) runs type check, tests and build on every PR and push to `main`, plus a separate `npm audit --omit=dev --audit-level=high` job. The audit job is deliberately not required for merge, so a new vulnerability in a dependency doesn't block unrelated PRs; fix it in its own PR. CodeQL also runs, and Dependabot opens dependency PRs weekly.

**Protect `main`** (once, in GitHub): Settings → Branches → *Add branch ruleset* (or *Add rule*) for `main` → enable *Require a pull request before merging* and *Require status checks to pass*, and select the check **Check, test and build**. Also enable *Block force pushes*.

## Out of scope and ideas

- iPhone support for the installed app (#17)
- Full offline support (builder and helper without a network)
- Rest timer between sets
- RPE per set and bodyweight with added load (weight vest)
- External exercise database
- More users: the data model is already per `userId`. What's missing is payment, per-user quotas and open sign-up instead of an allowlist.
