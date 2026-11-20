# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, …) and humans working on
this repository. Read this first.

## Branch workflow (always follow)

`main` is what we demo and ship. `dev` is where finished work is collected and checked
before it reaches `main`.

**Small or big?**
- **Small** (a text fix, a colour, a one-file bug fix that stands on its own): commit it
  directly on `dev`, after running the checks in "Before you push", and push `dev`.
- **Big** (a new page or feature, a new calculation, a schema change, anything across
  several files, anything you may want to drop): use its own branch, steps 1–3 below.
- Not sure? Treat it as big.

1. **Start every big piece of work from `dev`:**
   ```bash
   git checkout dev && git pull
   git checkout -b <type>/<short-name>      # e.g. feature/bunker-offers, fix/inbox-link, chore/docs
   ```
2. **Work and test on that branch** (see "Before you push" below). Commit there.
3. **When it's tested, merge it into `dev` and push `dev`:**
   ```bash
   git checkout dev && git pull
   git merge --no-ff <your-branch>
   git push origin dev
   ```
   CI runs on every push to `dev`. Then delete the feature branch.
4. **Only when `dev` is OK** (CI green and the app checked by hand) **merge `dev` into `main`:**
   ```bash
   git checkout main && git pull
   git merge --ff-only dev        # main only ever moves forward to a tested dev
   git push origin main
   ```

Rules for agents:
- Never commit directly to `main`. Commit directly to `dev` only for small changes (see
  "Small or big?" above); everything else goes on a branch made from `dev`.
- Never push to `main`, and never merge `dev` into `main`, without the user's explicit
  go-ahead in the conversation. Pushing a tested branch into `dev` is fine when the user
  asked for the work to be pushed.
- Never force-push `dev` or `main`.
- One branch per piece of work. Never merge one feature branch into another. If you need
  someone else's work, wait until it is in `dev`, then bring it in with `git merge dev`.
- Before anything goes to `main`, review the changes on `dev` for bugs, so `main` only
  gets reviewed, tested code.
- Once a branch is merged into `dev`, delete it locally and on GitHub
  (`git branch -d <branch>` and `git push origin --delete <branch>`).
- Don't commit local-only files: `.env`, `.claude/launch.json`, scratch scripts.

## Project in one paragraph

Tidewise is a maritime operations assistant. Emails from port agents and fuel suppliers
are read by an LLM (or an offline regex "mock" provider), matched to an underway voyage,
and turned into recommendations a human approves on the Actions page: slow-steaming
for berth delays (`packages/shared/src/jit.ts`), and whether a bunker (fuel) offer is
worth the detour (`packages/shared/src/bunker.ts`). The pipeline is
Email → PortEvent → Recommendation. See README.md (Greek) / README.en.md (English).

## Layout

- `packages/shared`: pure calculations (JIT, bunker, geometry), shared types, zod schemas.
  No I/O. Every calculation is unit-tested.
- `apps/api`: Express + Prisma (Postgres). LLM providers in `src/llm` (mock, openai,
  anthropic), email processing in `src/services/emailProcessing.ts`, extraction eval in
  `eval/`.
- `apps/web`: React + Vite UI.

## Before you push

Run what CI runs, from the repo root:

```bash
npm run build --workspace packages/shared   # api and web import the built shared package
npm run lint                                # typecheck api + web
npm test                                    # shared + api unit tests
npm run eval                                # extraction eval with the mock provider; must stay 18/18
```

If you changed the UI, also run the app and look at it.

## Gotchas

- **Rebuild shared** (`npm run build --workspace packages/shared`) after changing anything
  in `packages/shared`, or the api and web will use the old version.
- **Prisma CLI and `.env`:** `.env` lives in the repo root, but the Prisma CLI only reads
  `apps/api/.env`. From `apps/api`, pass the URL inline:
  ```bash
  DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" npx prisma migrate dev --name <change>
  ```
  The same pattern works for `migrate reset --force` (wipes the local DB and reseeds the
  demo). The seed skips voyages and emails if voyages already exist.
- **Schema changes** always come with a migration in `apps/api/prisma/migrations`.
- **Two timelines:** the globe animates at `SIM_SPEED`× real time, but recommendations use
  the real operational timeline (remaining = speed × time to planned ETA). Keep new
  calculations on the real timeline.
- **Sea routes:** searoute-js is fine for whole voyages but wrong over short distances
  (tens of nm). For detours use the straight-line + land check in
  `apps/api/src/services/land.ts`.
- **Eval:** adding an eval email in `apps/api/eval/emails/` changes the expected total;
  update the gate in `.github/workflows/ci.yml` too.
- **LLM keys** stay in `.env` only. Default `LLM_PROVIDER=mock` needs no key, and CI uses it.

## Writing style for docs and UI text

Plain, short sentences. Show the numbers a decision is based on, and keep assumptions
visible next to the figures that depend on them.
