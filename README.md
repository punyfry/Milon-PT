# Milon-PT

A personal, minimalist workout log with an AI coach, Milon, who stays quiet until you ask for help. The main goal is to log workouts quickly.

Stack: SvelteKit 2 (Svelte 5) on Vercel, data as JSON files in Vercel Blob, Google sign-in via Auth.js, and the Claude API called from the server.

The app's UI and the AI coach are in Swedish; code and developer docs are in English (see `CLAUDE.md`).

## Principles

- The landing page assumes you are there to log a workout: one tap on a workout card starts it.
- The coach is silent during a workout and only answers when you tap "Hjälp".
- Milon is optional. With him turned off (Konto) you build workouts and write in exercises yourself, and no Claude calls are made.
- Exercises are objects of their own with their own ID and log. Workouts only reference exercise IDs.
- An ongoing workout lives in the browser (localStorage) until the server has confirmed the save.
- Data is per user under `users/<userId>/`. Only the signed-in user can reach their files, and no blob URLs leave the server.

## Structure

| File | What |
| --- | --- |
| `src/auth.ts` | Auth.js: Google provider (explicit `GOOGLE_OAUTH_*`), allowlist in `signIn`, `userId` = Google's `sub` |
| `src/hooks.server.ts` | Chains security headers, Auth.js and the sign-in guard |
| `src/lib/server/security/` | `guard.ts` (sign-in + allowlist on every request except `/login` and `/auth/*`), `headers.ts` (security headers) and `session.ts` (session lifetime). The CSP lives in `svelte.config.js` |
| `src/lib/server/allowlist.ts` | Reads `ALLOWED_EMAILS`. An empty list lets nobody in |
| `src/lib/server/storage/` | The `UserStorage` interface: Vercel Blob (private), local files in `.data/` in dev, and in-memory in tests. Paths are validated in `paths.ts` |
| `src/lib/model/` | The data model: types, validation and id helpers. Shared by server and client |
| `src/lib/server/data/` | Read/write exercises, workout templates (versioned), saved sessions and the profile. `save-session.ts` saves a finished workout and is safe to retry without duplicates; `manual-workout.ts` saves a workout built by hand; `account.ts` deletes all of a user's files |
| `src/lib/server/import/craft.ts` | The Craft import: validate → plan against existing data → write |
| `src/lib/server/ai/` | Claude client, model selection, per-model parameters and the daily limit (`usage.ts`) |
| `src/lib/server/builder/` | The workout builder: system prompt, the `propose_exercise`/`set_workout` tools and the conversation loop |
| `src/lib/server/helper/` | The in-session helper: system prompt, `swap_exercise` and the signed history (`history.ts`) |
| `src/lib/session/` | The ongoing workout in the browser: prefill, −/+, timer, localStorage and the queue for workouts saved offline (`outbox.ts`) |
| `src/lib/history/stats.ts` | History: best set, estimated 1RM, records, weekly summary and milestones, computed from the logs |
| `src/lib/markdown.ts` | Simple markdown for the builder's replies, rendered without `{@html}` |
| `src/service-worker.ts` | Offline support: caches the app's files and visited pages |
| `src/routes/` | `/` workout cards, `/pass/[slug]` active workout (one exercise at a time) and finish, `/skapa` the builder, `/skapa/manuell` building by hand, `/historik` and `/historik/ovning/[id]`, `/konto`, `/api/*` |
| `src/lib/components/` | Shared components: `SetRow` (a set in the active workout), `CheckRow` (a warm-up or stretch set, ticked off), `Sheet` (bottom sheet for choices and confirmations), `ExerciseFields` (name, type and instruction of an exercise written in), `VersionsSheet` (a workout's versions), `TabBar` (main menu), `Icon`, `HelpPanel`, `LineChart`, `Markdown`, `MilonAvatar` (Milon's face, blinking while he thinks) and `MilonMessage` (a chat message with Milon as sender) |
| `src/lib/theme.ts` | Theme choice (system, dark, light), stored in localStorage and applied before first paint by `static/theme-init.js` |
| `static/intro/` | The intro's three drawings (`scen-1.png` to `scen-3.png`, black lines on transparent, shown inverted on black). Placeholders cut from the owner's sketch until the final ones are drawn; keep Milon in the same place in all three, and move `.face`, `.body` and `.hand` (the waving hand's box in `scen-3.png`) in `src/routes/valkommen/+page.svelte` if his face or hand moves |
| `static/fonts/` | Self-hosted Bricolage Grotesque, DM Mono and Newsreader (the intro's narrator) (latin subset, SIL Open Font License) so they work offline |
| `assets/logo/` | The logo (`logo.svg`, an M that is also a dumbbell, drawn in `currentColor`) and `logo-preview.html`, a standalone preview at different sizes |
| `assets/avatar/` | Milon's avatar (`milon.svg`), the logo-to-Milon animation (`logo-to-milon.svg`/`.gif`) and a preview; see `assets/avatar/README.md` |
| `e2e/` | Playwright UI tests, their fixtures (signed-in test user, seeding) and the dev server plugin behind seeding; see [UI tests](#ui-tests) |
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

### UI tests

`npm run test:e2e` runs the Playwright tests in `e2e/` against the dev server (port 5179, started and stopped by Playwright; a running one is reused locally). No `.env` is needed; the test server's own variables (below) override the one you have:

- **Storage** is in memory: `E2E_MEMORY_STORAGE=1` makes `storageFor` use a shared `MemoryUserStorage` (`src/lib/server/storage/e2e.ts`). It only works in `vite dev` and is read from the process environment, not `.env`, so a build can never use it and a stray line in `.env` doesn't either.
- **Sign-in**: each test gets a user of its own (new id, empty storage) through a minted Auth.js session cookie (`e2e/fixtures.ts`), so tests run in parallel without sharing data.
- **Data**: `user.seed({ 'profile.json': … })` writes files and `user.files()` reads them back, through `/__e2e/files`, which only the dev server with the flag has (`e2e/vite-plugin.ts`). `e2e/data.ts` builds profiles, exercises and workouts.
- **Milon** is unavailable on that server (no API key). Tests named `*.milon.spec.ts` run in their own project against a second dev server (port 5180) with a dummy key and `ANTHROPIC_BASE_URL` pointing at a fake Claude API on that server (`/__e2e/claude`, in `e2e/vite-plugin.ts`). It answers with a fixed text (`FAKE_CLAUDE_REPLY`), or with an API error when the request contains `#fel`. No test ever reaches the real Claude API. The app logs the fake errors with a stack trace (`Helper:` / `Workout builder:`), so they show in the test output; that is expected.
- Server errors and lost network are simulated with `page.route` (see `e2e/workout.spec.ts`).
- Open pages with `open(page, path)`, which waits until the page is hydrated; on the dev server a click before that does nothing.

The first run needs a browser: `npx playwright install chromium`. With another Chromium already installed, point to it with `PW_CHROMIUM_PATH` (e.g. `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`). `npx playwright show-report` shows the latest report with traces of failed tests. CI runs the tests in the **UI tests** job and uploads the report when they fail.

### Environment variables

| Variable | Contents |
| --- | --- |
| `AUTH_SECRET` | Secret for the Auth.js session cookie (`npx auth secret`) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ID. Passed explicitly to the Google provider (Auth.js otherwise looks for `AUTH_GOOGLE_ID`) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth secret, passed the same way |
| `ALLOWED_EMAILS` | Comma-separated list of e-mail addresses allowed to sign in |
| `IMPORT_EMAILS` | Comma-separated list of the addresses that see the Craft import on Konto (and may call `/api/import`). Empty hides it for everyone |
| `BLOB_READ_WRITE_TOKEN` | Created when the Blob store is connected to the Vercel project |
| `ANTHROPIC_API_KEY` | Claude API key. Without it the builder and helper answer 503 |
| `MODEL_BUILDER` | Model for the builder (default `claude-sonnet-5-5`) |
| `MODEL_HELPER` | Model for the helper (default `claude-haiku-4-5`) |
| `AI_DAILY_LIMIT` | Max Claude API calls per user and day, builder and helper combined (default 50, `0` disables). One builder turn can make several calls |
| `AI_STARTER_CALLS` | Starter pot: extra calls for a new user's first 14 days, used once the day's limit is reached (default 100, `0` turns it off) |

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
| `profile.json` | Milon on or off (`coach`), when the intro was done (`onboardedAt`), goals, rules, other context for Milon (`coachContext`, where the questionnaire keeps its `Tränar:` and `Erfarenhet:` lines), weekly goal and kcal estimates per workout type |
| `exercises/<exerciseId>.json` | Exercise with name, type, instruction, `note` (optional), `deleted` (only when deleted) and the full log (newest first) |
| `workouts/<slug>.v<N>.json` | Workout template. Every change creates the next version; older ones are kept and can be restored |
| `sessions/<sessionId>.json` | A completed workout: template and version, start and end, deviations, kcal |
| `builder/<id>.json` | Builder conversations |
| `usage/<YYYY-MM-DD>.json` | Number of AI calls that day (`count`) and the tokens used per served model (`tokens.<model>`: `calls`, `input`, `output`, `cacheWrite`, `cacheRead`), recorded to see what Milon costs per user before the limit is based on cost (#98). Pruned after 30 days |
| `usage/starter.json` | The starter pot: the date of the first AI call and how many of its calls are used. Lasts 14 days from that date |

```json
{
  "id": "ex_marklyft",
  "name": "Marklyft",
  "type": "weight",
  "instruction": "Stång över mellanfoten, rak rygg, tryck golvet ifrån dig.",
  "log": [{ "sessionId": "s_20261006", "startedAt": "2026-10-06T17:10:00+02:00", "date": "2026-10-06", "sets": [{ "weight": 40, "reps": 8 }], "note": "Marginal kvar" }]
}
```

- `type`: `weight` (weight × reps), `bodyweight` (reps) or `time` (seconds). Sets per type: `{ weight, reps }`, `{ reps }` or `{ seconds }`.
- **Warm-up and stretch** (#100): an exercise in a workout template can have `phase: "warmup"` or `"cooldown"` (stretch); missing means the main part, so older templates need no migration. Saving a template puts the warm-up first and the stretch last. A done warm-up or stretch exercise is logged as usual with the same `phase` on its log entry, so the history shows it; skipped ones leave nothing behind, and the session record doesn't say which parts were skipped. The stats (`src/lib/history/stats.ts`) leave entries with a `phase` out of records, estimated 1RM, the chart, volume, the week and the milestones; reading the phase from the entry itself means an exercise used as warm-up in one workout and as a main exercise in another counts correctly, and the stats need no workout versions. The kcal suggestion is unchanged.
- Older files may have a `loadClass` (weight steps). It is no longer used and is dropped when the exercise is read.
- Session ids are `s_YYYYMMDD` (Swedish time), with `_2`, `_3` … for several workouts the same day.
- A log entry's `startedAt` is the start of the session that saved it. Saving writes the logs before the session record, so entries without a record come from a save that failed halfway: a retry with the same start reuses their id, and other sessions don't take it.
- The ongoing workout is in localStorage under `milonpt.activeSession`, with the account it belongs to under `milonpt.activeSessionOwner` (another account on the device never sees it); workouts waiting for the network under `milonpt.pendingSaves`. Signing out under Konto empties both for that account (another account's data on the device and the theme stay) and asks first if a workout is in progress or waiting to be sent; the service worker drops the cached pages when the login page is shown.

Volume: `weight` = sum of weight × reps, `bodyweight` = sum of reps, `time` = sum of seconds. Estimated 1RM: weight × (1 + reps / 30). Records count for the best set (1RM, reps or time) and, for weight exercises, the heaviest weight; the first session never counts as a record. Warm-up and stretch entries never count.

## Screens

The look (tokens, type, layout) is described in [DESIGN.md](DESIGN.md). A fixed main menu (Start, Bibliotek, Skapa, Konto) sits at the bottom of every screen except the active workout and sign-in.

0. **Intro** (`/valkommen`): a new user (no `onboardedAt`, no exercises or workouts) is sent here from the start page. Always dark, like a short film: the drawings (inverted to white lines) fill the top and zoom in slowly, and Milon's story runs as subtitles, one line per tap (a tap while a line is typed shows all of it). The narrator is set in Newsreader, Milon in the app font and the accent. Milon steps forward and waves, then the camera zooms in on his face and he asks whether you want him along, as dialogue options; his reply ends with "Bygg mitt första pass" or "Jag vill kolla mer på appen först". Without an API key it ends on his hello instead, with the same two options. The step is in the URL (`?steg=`), so back and reload keep the place; the back arrow works throughout and "Hoppa över" jumps to the question. Making the choice or leaving the last view saves `onboardedAt` (and the choice). It can be watched again from Konto. Reduced motion shows text and pictures at once.
1. **Start:** a greeting with the first name, this week's sessions against the weekly goal (counted like the library: saved sessions plus days with only imported log entries), a card for a workout in progress, and the latest version of each workout as a card showing its first exercises, most recently trained first. One tap starts the workout; if another workout is in progress you choose between continuing it and discarding it.
2. **Overview:** tapping a workout opens an overview before it starts: a compact list with each exercise's target, last time's note and a collapsible instruction (shown only when the exercise has one), "Byt" and a small Milon icon to ask about that exercise. Last time's weights and reps are left out here; they show per set during the workout. A workout with a warm-up or stretch is split into "Uppvärmning", "Pass" and "Stretch", and the count at the top is for the main part. One "Fråga Milon om passet" asks the helper about the whole workout (the request has no `exerciseId`). **Byt** swaps an exercise for this workout only, from a searchable list of your own exercises (same type first), by writing in a new exercise (name, type, instruction) or by asking Milon for variants or new exercises. A written-in exercise gets a temporary id (`new_…`) and lives in the session's `newExercises` until the workout is saved; then it is created (or an active exercise with the same name and type is reused), so this works offline and a retried save creates no duplicates. It is created only if it has a done set or is saved into the workout. The overview is an active session with `preparing: true`, saved to localStorage on the first swap, so only looking at a workout leaves nothing behind and a preparation survives closing the app. "Ångra byten" drops the preparation. A preparation without swaps follows the latest version of the workout. "Starta passet" (sticky at the bottom) starts the clock and sets the session id from that day. Opening another workout does not touch a preparation; the first swap or start there replaces it. Swapping back to the plan drops the preparation. A workout in progress is protected as before. The server refuses to save a session that has not started.
3. **Active workout:** one exercise at a time. Move with the Next button (highlighted when every set is done), by swiping sideways or by tapping the progress segments. Sets are prefilled from the latest log entry, otherwise from the template's target, and last time's value is shown per set. Weight is typed, reps and seconds use −/+. A change to a set carries over to the later sets that are not done, have no running timer and still had the same value as the changed set had before, so a planned pyramid or drop is left alone. Every set stays editable until the workout is finished; a removed set can be undone. Every change is written to localStorage, including the exercise shown, so a paused workout resumes where it was. Timed exercises have a timer in the set row that counts down, beeps at zero and fills in the time; it stores the end time (`timerEndsAt`) so it stays correct if the screen locks, and the screen is kept awake (Wake Lock). Stopping early saves the elapsed time; starting the timer again counts down from the planned time (`plannedSeconds`), unless the time was changed by hand. A new set copies the planned time, and the next workout prefills a timed set below the target with the target (a swapped-in exercise keeps its own logged times); discarding a restarted timer leaves a done set done. While a timer runs, changing set or exercise, leaving or finishing first asks whether to keep the time, discard it or keep the timer going. Leaving the page another way (the back button, a link, reloading or closing the tab) cancels the timer without saving its time; a locked screen keeps it running. This relies on the browser firing `pagehide`: if Android kills the app in the background, the timer is found expired on the next start. If it ran out at most three minutes earlier it fills in the planned time (the app may only have been closed while the screen was locked); otherwise the time is dropped and the set left as it was. **Byt** opens the same swap list as the overview; **Anteckning** adds a note for the exercise today (kept in the active session, saved with its log entry if it has done sets, shown as "Förra gången" next time; a swap before any set is done moves it to the new exercise); "Fråga Milon" opens the helper in a sheet; swapping an exercise becomes a deviation in the session, not a change to the template. The close button asks whether to pause (keep it on the phone) or discard.
   **Warm-up and stretch** (#100) come before and after the main part, with shorter progress segments and "Uppvärmning 1 av 2" / "Stretch 1 av 3" as the heading. Their sets are filled in from the target (not last time) and ticked off with "Klar" (`CheckRow`), with a timer for timed exercises and no −/+ (a weight exercise swapped in keeps the normal set rows). "Hoppa över uppvärmningen" goes to the main part and "Hoppa över stretchen" to the summary; what isn't done is simply not logged. A swap keeps the exercise in its part, and a warm-up or stretch exercise is only swapped for one with time or reps (the picker, Milon's `swap_exercise` and a swap saved as a new version all follow the same rule, `fitsPhase`). "Last time" (prefill, "Förra gången") is the newest entry from a main part, so a main exercise isn't prefilled from a warm-up. Milon's helper sees warm-up and stretch marked in today's sets and the history.
4. **Finish:** summary with time, done sets, new records and each exercise's sets (done sets and records count the main part only; a warm-up or stretch exercise is tagged, and one not done says "Inte gjord"); tap an exercise to go back and change it. If there are deviations you are asked whether to save them as a new version of the workout. kcal is suggested (the profile's value for the workout, otherwise the workout type's range) and can be adjusted. "Avsluta pass" writes the exercise logs and the session record. It needs a done set in the main part, or both a warm-up and a stretch done (`countsAsWorkout`): only a warm-up or only a stretch counts as an abandoned workout, can't be saved (the server refuses it too) and can only be discarded; a workout with no main part (e.g. a pure stretch workout) needs any done set; localStorage is cleared only after the server confirms. "Släng passet" is last, with confirmation.
5. **Create workout:** chat with the builder and a collapsible list of the exercises being discussed at the top. Approved exercises are saved (existing ones are reused), and "Spara pass" creates `v1` or the next version. Older versions are listed in a sheet and can be restored as a new version; a restore is refused if one of its exercises has changed type since, as its target would no longer fit. On a phone, Enter adds a new line and the send button sends.
   **Questionnaire** (#102, new workouts only): "Hjälp mig beskriva passet" (and the intro's "Bygg mitt första pass med Milon") opens one question per view: focus, time, intensity, warm-up and stretch, where and with what, experience, injuries, anything else. Every question can be skipped and has "Annat…" with free text; the step is in the URL (`?steg=`) and the answers in sessionStorage, so back and a reload keep them. "Klart" puts the answers together into a Swedish message in the browser (`src/lib/builder/questionnaire.ts`, no AI call) and places it in the input field to edit and send as usual. Where/with what, experience and injuries offer "Spara i profilen": the first two are kept as `Tränar:` and `Erfarenhet:` lines in `coachContext` (replaced on the next save, and preselected next time), injuries become a rule; nothing is saved without that choice, and what Milon already knows is left out of the message.
   **By hand** (`/skapa/manuell`, where `/skapa` leads when Milon is off or not configured, and linked from the builder otherwise): name the workout, add exercises from your own or write in new ones, set sets and target (reps or seconds), reorder and remove. The optional "Uppvärmning" and "Stretch" sections around "Övningar" have their own add buttons; they only take timed or bodyweight exercises, and an exercise moves within its own section. "Spara pass" goes through `POST /api/workouts` and creates `v1` or the next version with a generated change note; nothing is saved if nothing changed. New exercises are created on save, reusing an active one with the same name and type.
6. **Library (Bibliotek, `/historik`):** week (days with today outlined, sessions vs. weekly goal, volume per type), milestones (Pull-up and Handstand, with progression exercises until the goal exercise is logged), every exercise in one alphabetical list with search, each with its type and when it was last trained ("inte tränad än" if never), **Ny övning** to add an exercise on its own without putting it in a workout (name, type, instruction and a note of your own, e.g. why it looked interesting; the note is shown on the exercise page, and Milon sees it in the builder's and the helper's exercise catalog, cut to 200 characters, and in full for the exercise a question is about, so it can suggest another variant if something hurt or was too easy), and per exercise the workouts whose latest version uses it (linked), a chart and the latest sessions as rows. **Ändra** on an exercise changes its name, type (only while no sets are logged and no workout uses it, since sets and targets depend on the type), instruction and note. **Ta bort övning** deletes it, unless the latest version of a workout uses it. A deleted exercise keeps its file and log (`deleted: true`): it disappears from every list and picker, but its sets stay in the week's numbers and in the sessions where they were done, and restoring an old workout version that uses it brings it back (refused if a new exercise has taken its name, as is a restore where an exercise has changed type since; the versions sheet then offers to restore without those exercises), as does saving a session's swaps as a new version built on such a version (which uses the new exercise instead if one has taken the name). A new exercise with the same name is a new one. There is no archiving; `archived` in older files is ignored, so those exercises are active.
   **Session view** (`/historik/pass/[id]`, from the week's session list or a date in an exercise's history): start, end, length, kcal and each exercise's sets. **Redigera** corrects the start time (the start date is fixed, it is part of the session id), the end date and time, kcal, the sets (change, add, remove) and each exercise's note, and can remove an exercise from the session. **Ta bort pass** deletes the session and its sets; workout versions it created stay. Edits go through `PUT`/`DELETE /api/sessions/[id]` with the record's version, write the log entries first and the record last, and answer 409 if the session changed since the page was loaded. A changed start keeps the saved value in `originalStartedAt`, so a queued retry of the original save is still recognised as already saved (and then writes no log entries).
7. **Account:** weekly goal, Milon on or off (shown when the API key is set), theme (system, dark, light), the Craft import (only for `IMPORT_EMAILS`), the intro again, sign-out and **Radera konto**. Deleting the account asks first, then deletes every file under `users/<userId>/` (profile, exercises, workouts, sessions, builder conversations) except the AI counters and the starter pot (`usage/`), which hold only counts and are kept so the limits can't be reset that way; it then empties the browser's copy and signs out. The address stays on the allowlist, so signing in again starts from scratch with the intro; remove it from `ALLOWED_EMAILS` to take away access too.

## The AI coach

Two separate calls with their own system prompts, both using tools so the app never parses JSON out of prose. The prompts (in Swedish) are in `src/lib/server/builder/prompt.ts` and `src/lib/server/helper/prompt.ts`.

- **The builder** (`/skapa`, Sonnet): discusses exercises with the catalog, goals and the workout being edited as context. For a new workout he always asks about a warm-up and a stretch (no is fine), picks stretches for the muscles the workout trained, and gives each exercise a `phase` in `propose_exercise` and `set_workout`; weight exercises are refused in a warm-up or stretch. Replies are rendered with simple markdown. A conversation takes at most 40 messages from the user (`MAX_TURNS`): the page counts down the last five, then disables Skicka and offers a new conversation. "Spara pass" (sent with `save: true`) gets three more (`SAVE_TURNS`), so a full conversation can still save its workout; past that the endpoint answers 409 before anything is counted or sent.
- **The helper** ("Hjälp" button during a workout, Haiku): more instruction or swapping an exercise, with the workout, today's sets and the exercise's five latest log entries as context. Replies in plain text. The server keeps no helper conversation: each answer returns the latest six questions and answers with an HMAC signature (keyed by `AUTH_SECRET`, bound to the user and the workout), and the client sends both back with the next question. A history without a valid signature is dropped, so a client can't put words in Milon's mouth.
- **Scope** (`SCOPE_RULES` in the builder prompt, used by both): Milon talks about training, including warm-up, stretching, mobility, yoga and general recovery, and declines other topics in one sentence. On pain, injuries or discomfort he only says he can't give advice about it, and makes no diagnoses (a note that something hurt may still lead to another variant, without advice about the pain). No advice on medication, doping, extreme diets or rapid weight loss. The user's goals, rules, names and notes are context, not instructions, and implausible numbers are questioned rather than built on. Goals and rules are cut to the profile limits (`MAX_GOALS`, `MAX_RULE`, `MAX_RULES`) in the prompt, and the import rejects longer ones.
- **Turned off** (`coach: false` in `profile.json`, missing means on): the "Fråga Milon" buttons are hidden, `/skapa` leads to building by hand, and `/api/builder` and `/api/helper` answer 403 before anything is counted or sent.
- Cost: roughly SEK 4–5 a month for Haiku and SEK 12–20 for Sonnet at about 12 workouts. Besides `AI_DAILY_LIMIT`, set a monthly limit for the API key in the Anthropic Console. A Claude subscription does not cover API calls.

## Craft import

Only offered to the addresses in `IMPORT_EMAILS`, since the format is the owner's own export.

**Easiest:** sign in, go to **Konto → Importera från Craft** and pick the JSON file. The app first shows what would be saved and only saves when you press **Importera**. See `scripts/import-example.json` for the format. Besides exercises and workouts, the file can contain:

- `profile`: `goals` (text or list), `rules`, `kcalEstimates` (`strength`/`hiit` with `min`/`max`) and `weeklySessionGoal`. Existing values are never overwritten; rules are appended.
- `note` on log entries. (`archived` on exercises is accepted from older files but ignored.)
- `sessions`: completed workouts `{ date, workout, kcalEstimate? }`. They become session records at 12:00 Swedish time, and log entries from the same day are linked to them.

From the command line (requires `BLOB_READ_WRITE_TOKEN`, or `--local` for `.data/`). Your user ID is shown on `/konto`.

```sh
npm run import -- my-export.json --user <user-id>          # dry run: shows the plan
npm run import -- my-export.json --user <user-id> --apply  # writes
```

- The whole file is validated first and every error is listed with its path. Nothing is written if anything is wrong.
- Exercise names are matched against existing exercises (case and whitespace don't matter). Existing names and instructions are never overwritten. A deleted exercise is matched too (an active one with the same name wins); it comes back if an imported workout uses it, otherwise it stays deleted.
- The same file can be imported again without duplicates.

## Add to home screen (PWA)

- **Android (Chrome):** menu ⋮ → Install app.
- **iPhone (Safari):** Share → Add to Home Screen (untested, see #17).

Visited pages are available offline; otherwise an offline page is shown. A workout saved without a network is queued and sent when the network is back. The builder and helper need a network. Icons are drawn with `python3 scripts/make_icons.py static/icons` (requires Pillow).

## Security

- Google sign-in and an allowlist checked on every request. An empty list lets nobody in.
- Sessions end after 7 days without use; every request renews the cookie, so using the app keeps you signed in. However much it is used, a session ends 30 days after signing in with Google (`src/lib/server/security/session.ts`).
- Blob files are always written with `access: 'private'`, and paths are validated so one user can never reach another's files.
- Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, HSTS etc. on pages and API responses from the server (not on static files or redirects to the sign-in page).
- A daily limit on Claude API calls per user (`AI_DAILY_LIMIT`), plus a starter pot for a new user's first 14 days (`AI_STARTER_CALLS`), taken from once the day's limit is reached. Every call counts, and the limit is checked before anything is sent. The counters and the pot are kept when an account is deleted, so starting over doesn't reset them.
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
- More users: the data model is already per `userId`. What's missing is payment, per-user quotas, open sign-up instead of an allowlist, data export and a privacy policy.
