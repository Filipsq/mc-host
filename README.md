# MC Host

Web panel for free and paid Minecraft server hosting (Java and Bedrock).

Users can sign up, create a free Java or Bedrock server, start and stop it, and use a live console.
The web panel (Next.js, this folder) asks the node agent (`agent/`, Go) on each game host to run
one Docker container per server. Billing, sleep-when-empty and hostname routing come next.

## Run locally

Requires Node 22+, Go 1.24+ and Docker.

```bash
docker compose up -d          # Postgres on localhost:5432
cp .env.example .env          # then set AUTH_SECRET (npx auth secret)
npm install
npx prisma migrate dev        # create tables
(cd agent && AGENT_TOKEN=<same as .env> go run .)   # node agent on :8081, needs Docker
npm run dev                   # http://localhost:3000
```

## Layout

- `prisma/schema.prisma` — users and servers (edition, plan, status, memory)
- `src/auth.ts` — Auth.js with email + password (bcrypt)
- `src/app/actions.ts` — sign-up, log-in, log-out server actions
- `src/app/dashboard` — server list, create-server page, and each server's page with controls and console
- `src/lib/agent.ts` — client for the node agent; `src/lib/servers.ts` — ports, ownership, live status
- `agent/` — the node agent (see its README)
- `src/middleware.ts` — redirects signed-out users away from `/dashboard`
- `src/i18n` — languages (Polish default, English) and currencies (PLN default, EUR, USD, GBP), stored in cookies and switched from the top-right picker
- `src/lib/plans.ts` — plan limits and monthly prices per currency

## Adding a language

Copy `src/i18n/messages/en.ts` to a new file, translate it, register it in `src/i18n/messages.ts`, and add its code to `locales` in `src/i18n/config.ts`. TypeScript fails the build if a key is missing.
