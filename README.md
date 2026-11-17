# Maritime Ops Assistant

Smart Maritime Operations Assistant — Netcompany Hackathon Athens 2026 (challenge #2).

Work in progress. See the phases below; this README is filled in fully once the
build is complete.

## Setup

```bash
git clone <repo-url>
cd maritime-assistant-v2
cp .env.example .env   # optional: add ANTHROPIC_API_KEY or OPENAI_API_KEY
docker compose up --build
```

Then open http://localhost:8080.

## Monorepo layout

```
apps/
  web/      React + Vite + TypeScript frontend
  api/      Node + Express + TypeScript + Prisma backend
packages/
  shared/   Shared TS types, zod schemas, geo + JIT domain functions
```
