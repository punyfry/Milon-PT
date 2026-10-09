---
name: deliver
description: The workflow for taking a change in Milon-PT from task to merged PR - code on its own branch, check locally, open a PR, have the subagents gregory and nissa review and test in parallel, fix their findings and merge when everyone is satisfied. Use for features, bug fixes and issues in this repo.
---

# Deliver a change

You are the coder. Review and testing are done by two subagents: Gregory (`gregory`, the reviewer: security, structure, comments, design) and Nissa (`nissa`, the tester: coverage, unit tests, manual tests). Follow `CLAUDE.md` throughout.

## 1. Understand and scope

- Read the task (or issue) and the code it touches. Read `README.md` for the data model and flows.
- **Decisions that belong to the owner** (product behaviour, UX choices, cost) are not yours to guess. Ask if the owner is available; otherwise pick the safest minimal option, state the choice in the PR and open an issue for the question.
- One thing per PR. If you find something unrelated, open an issue instead of widening the PR.

## 2. Code

- New branch from the latest `main`: `git fetch origin main && git checkout -B claude/<short-name> origin/main` (or the branch you were assigned).
- Follow the hard rules and conventions in `CLAUDE.md`, including the language rule: code, comments and tests in English, UI text in Swedish. Search for existing helpers before writing new ones.
- Write tests for new logic in the same change, especially anything security-relevant and edge cases.
- Update `README.md` (and `CLAUDE.md` if the way of working changes) when behaviour, environment variables or structure change.

## 3. Check locally

```sh
npm run check   # 0 errors, 0 warnings
npm test
npm run build
```

Read your own diff critically before committing: what would make CI or the reviewer reject it?

## 4. Commit and open a PR

- Commit messages and PR text in English. No model names in them.
- The PR description covers what and why, decisions you made, and **how to test** (locally and on Vercel).

## 5. Review and test in parallel

Start both subagents in the same message so they run at the same time. Keep the cost in proportion to the change:

- **Gregory runs at low effort** (set in his agent file). Start him with `effort: "medium"` when the change touches storage, security (guard, allowlist, paths, headers), the AI limit, the data model or saving a session or workout.
- **Gregory is skipped** for a change that is only docs, comments, UI text or styling. Read the diff yourself instead.
- **Nissa skips the browser tests** when no page, component or client code changed (a server-only or test-only change). Tell her so; check, tests, coverage and build are enough then.


- `gregory`: give it the branch/PR number and what the change is meant to do, and point it at the risky parts of this particular change.
- `nissa`: give it the branch, the affected functionality and what test data is available.

While they run, wait for CI (the GitHub Actions check **Check, test and build**, CodeQL and Vercel).

## 6. Handle findings

- **blocker** and **should**: fix, add a test that catches the problem, rerun the checks and push.
- **nit**: fix if it is simple and clearly right; otherwise leave it.
- Findings that need the owner's decision: open an issue and mention it in the PR.
- Findings you believe are wrong: verify yourself, and note briefly why you are not changing anything.
- Rerun a subagent only when a fix changed something significant that its own tests don't cover (a new code path, security, a UI flow), and then only that subagent, on the fix commits. A small fix with a test that catches the problem needs no new round: verify it yourself and say so in the PR.
- If a subagent cannot run (e.g. rate limit): do the equivalent check yourself and say so in the report.

## 7. Merge

Merge only when:
- CI is green on the latest commit,
- the reviewer has no open blocker or should findings,
- the tester has passed check, tests, build and the manual tests,
- no owner decision has been guessed without saying so in the PR.

Squash-merge with the PR number in the title, e.g. `History: archived exercises in a group of their own (#16)`, and stop watching the PR.

## 8. Report

Give the owner a short summary (in the language they write in): what was built, what review and testing found and how it was handled, which issues were opened, and anything the owner needs to do (e.g. set an environment variable or test on their phone).
