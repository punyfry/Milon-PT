# CLAUDE.md

Guidance for AI agents working in this repo. Read README.md for the product, structure, data model and setup; this file covers how to work here.

## What this is

Milon-PT: a single-user (for now) workout log PWA with an AI coach. SvelteKit 2 + Svelte 5 (runes) on Vercel, per-user JSON files in Vercel Blob, Google login via Auth.js with an e-mail allowlist, Claude API called only from the server.

## Commands

```sh
npm run check   # svelte-check, must be 0 errors and 0 warnings
npm test        # vitest
npm run build   # adapter-vercel build
npm run test:coverage
```

CI (`.github/workflows/ci.yml`) runs check, test and build on every PR (the required check), plus a separate `npm audit --omit=dev --audit-level=high` job. Run check, test and build locally before pushing.

## Hard rules

- **Never commit user data or secrets.** `.env*` (except `.env.example`) and `.data/` are gitignored. Real import files from the owner contain personal data: use them only outside the repo and delete local copies (`rm -rf .data`) after testing.
- **Storage goes through `storageFor(locals)`** (`src/lib/server/storage`). Never call `@vercel/blob` directly, never use `access: 'public'`, and never return a blob URL to the client. Paths are validated in `paths.ts`; keep it strict.
- **Every route except `/login` and `/auth/*` requires an allowlisted session** (`src/lib/server/security/guard.ts`). New public paths need a very good reason and a test.
- **AI calls**: only from server routes, after input validation. Check `assertAiCallsLeft(storage)` first and pass `limitedCreateMessage(storage)` so every Claude request counts against the daily limit. Model names come from `MODEL_BUILDER`/`MODEL_HELPER`; parameters per model live in `src/lib/server/ai/models.ts`.
- **Writes are conflict-safe**: use `ifMatch` for updates and `createOnly` for new files; workouts are versioned (`<slug>.v<N>.json`) and never overwritten. Saving a session must stay idempotent (same id + startedAt).
- **Never render model output as HTML.** Use `Markdown.svelte` (builder) or plain text (helper). No `{@html}`.
- Do not put model identifiers in commit messages or PR text.

## Conventions

- **Language:** code, identifiers, comments, tests, log messages, commit messages, PR descriptions and repo docs for developers are in **English**. Only what the user sees or says is in **Swedish**: UI text, error messages shown in the app, and the AI prompts and conversations with Milon. Existing Swedish comments and tests are being translated; write new ones in English and translate the ones you touch.
- Formatting: tabs, single quotes, no trailing commas, print width ~140. Prettier is not installed; match the surrounding code (or run `npx prettier --use-tabs --single-quote --trailing-comma none --print-width 140` on `.ts` files only).
- Svelte 5 runes only (`$state`, `$derived`, `$props`, snippets). No stores unless needed.
- Keep SvelteKit on 2.x: `@auth/sveltekit` does not support SvelteKit 3 yet. Blocked major upgrades are listed as `ignore` rules in `.github/dependabot.yml`; remove a rule when its blocker is gone.
- Strict tool schemas for Claude: don't combine `enum` with a `type` array; use `anyOf` with `{ type: 'null' }`.
- Dates are `YYYY-MM-DD` in Europe/Stockholm (`src/lib/time.ts`); timestamps are ISO with offset. Session ids are `s_YYYYMMDD[_n]`.
- Shared types and validation live in `src/lib/model` and are used by both server and client.

## Tests

- Unit tests sit next to the code (`*.test.ts`). Use `MemoryUserStorage` instead of Blob.
- SvelteKit virtual modules are stubbed for vitest in `src/test/` (`$env/dynamic/private` is a mutable `env` object; `$app/environment` has `dev = false`).
- Endpoint tests (`src/routes/api/api.test.ts`) mock `storageFor` and `createMessage`; never call the real Claude API in tests.
- Security-relevant code (guard, allowlist, paths, Blob storage, AI limit, headers) has tests; keep them green and add cases when changing it.
- Browser-only code (service worker, localStorage, wake lock, Svelte components) is verified manually with Playwright. Chromium is at `/opt/pw-browsers`; log in locally by minting an Auth.js session cookie with `encode` from `@auth/core/jwt` (salt = cookie name `authjs.session-token`) and starting the dev server with `AUTH_SECRET`, `ALLOWED_EMAILS` and dummy `GOOGLE_OAUTH_*` on the command line.

## Workflow

- Use the `deliver` skill (`.claude/skills/deliver/SKILL.md`) for features, fixes and issues: you code, then run the subagents `gregory` and `nissa` (`.claude/agents/`) in parallel, fix their findings and merge when CI and both are satisfied.
- One branch and PR per change; squash-merge with the PR number in the title. Describe how to test in the PR.
- Decisions that belong to the owner (product behaviour, UX choices) go to a GitHub issue instead of being guessed.
