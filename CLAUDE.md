# MCHosting (mc-host)

Free and paid Minecraft server hosting (Java and Bedrock) for the Polish market, live at
https://mchosting.pl. README.md has the full layout; this file is what an agent needs to work here.

## Stack

- **Web panel** (repo root): Next.js 15 App Router, React 19, TypeScript, Auth.js v5 (email +
  password), Prisma 6 on Postgres, Stripe Checkout (prepaid, not subscriptions), zod, lucide-react.
  Plain CSS in `src/app/globals.css` (dark theme, CSS variables on `:root`); no Tailwind.
- **Node agent** (`agent/`): Go 1.24, standard library only. Runs one Docker container per
  Minecraft server, routes Java players by hostname on :25565, sleeps idle free servers, backups.
- **Deploy** (`deploy/`): one Ubuntu machine (Hetzner CAX21, Arm64) running everything with Docker
  Compose and Caddy. Production updates with
  `cd ~/mc-host && git pull && cd deploy && ./setup.sh`, so `main` must always build and
  `deploy/setup.sh` must stay idempotent and non-breaking.

## Commands

```bash
npm run lint              # eslint (next/core-web-vitals + next/typescript)
npx tsc --noEmit          # typecheck; also catches missing translation keys
npm run build             # full Next.js build (what the Dockerfile runs)
npx prisma generate       # after editing prisma/schema.prisma
npx prisma migrate dev --name <what_changed>   # needs Postgres (docker compose up -d)
(cd agent && go vet ./... && go test ./...)    # agent tests
```

In cloud sessions `.claude/hooks/session-start.sh` installs npm packages, generates the Prisma
client and installs Python Playwright, so lint, typecheck and tests work straight away. There is no
Postgres or Docker daemon there, so pages that hit the database or the agent can't be exercised
end to end; run lint, `tsc` and the Go tests before pushing.

## Conventions

- **Every user-facing string is translated.** Add the key to both `src/i18n/messages/pl.ts`
  (Polish, the default and main language) and `src/i18n/messages/en.ts`. Server components get
  strings with `getMessages()` from `src/i18n/server.ts`. Write natural Polish, not a literal
  translation.
- Prices live in `src/lib/plans.ts` per currency (PLN default, EUR, USD, GBP); plan limits too.
- Schema changes need a new migration folder in `prisma/migrations/` (production runs
  `prisma migrate deploy` on start). Never edit an applied migration.
- The panel talks to the agent only through `src/lib/agent.ts`; keep the agent API in
  `agent/README.md` in sync when changing it.
- Legal pages (`/regulamin`, `/polityka-prywatnosci`, `/kontakt`) read the owner's details from
  `src/lib/company.ts`.
- Secrets and settings come from env vars; document new ones in `.env.example` and, if production
  needs them, in `deploy/setup.sh` / `deploy/README.md`.
- Commit messages: one plain sentence in the imperative describing what users get
  (e.g. "Add daily world backups with download and restore").
- Docs are written for a non-expert owner: plain language, concrete steps.

## UI work

Use the `frontend-design` skill for new pages or redesigns, but keep to the existing visual
identity: the dark block theme, the green accent (`--accent`), Jersey 10 for display type and
Inter for body, and the tokens already on `:root` in `globals.css`. Check every page at phone width.
Use the `webapp-testing` skill (Python Playwright) to screenshot pages and verify changes in a
browser.

## Skills in this repo

- `.claude/skills/frontend-design` — Anthropic's skill for distinctive, intentional UI design.
- `.claude/skills/webapp-testing` — Anthropic's Playwright toolkit for testing the running site.
- `.claude/skills/skill-creator` — Anthropic's skill for writing and evaluating new skills.

These are copied from https://github.com/anthropics/skills (Apache 2.0, see each `LICENSE.txt`).

`.claude/settings.json` also enables the **Superpowers** plugin (github.com/obra/superpowers, MIT):
brainstorming before building, written plans, test-driven development, systematic debugging and
verification before calling work done. For bigger features, start with its brainstorming skill.
