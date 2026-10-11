# MC Host

Web panel for free and paid Minecraft server hosting (Java and Bedrock).

This is the phase 1 skeleton: sign-up, log-in and an empty server dashboard, backed by Postgres.
Server creation, the node agent and billing come next.

## Run locally

Requires Node 22+ and Docker (for Postgres).

```bash
docker compose up -d          # Postgres on localhost:5432
cp .env.example .env          # then set AUTH_SECRET (npx auth secret)
npm install
npx prisma migrate dev        # create tables
npm run dev                   # http://localhost:3000
```

## Layout

- `prisma/schema.prisma` — users and servers (edition, plan, status, memory)
- `src/auth.ts` — Auth.js with email + password (bcrypt)
- `src/app/actions.ts` — sign-up, log-in, log-out server actions
- `src/app/dashboard` — the signed-in server list
- `src/middleware.ts` — redirects signed-out users away from `/dashboard`
