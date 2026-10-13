# MCHosting

Web panel for free and paid Minecraft server hosting (Java and Bedrock).

Users can sign up, create a Java or Bedrock server on the free plan or a paid plan, start and stop
it, and use a live console. Java servers get an address like `ekipa.mchost.pl`. Free servers sleep
when nobody is playing; Java ones wake up when a player joins.

The web panel (Next.js, this folder) asks the node agent (`agent/`, Go) on each game host to run
one Docker container per server. The agent also routes Java players by the address they typed.

## Payments

Paid plans are prepaid for 7, 30, 60 or 90 days (60 days 5% off, 90 days 10% off) through Stripe Checkout (card, BLIK, Przelewy24), not
auto-renewing subscriptions, since BLIK and Przelewy24 can't charge automatically. The flow:

1. The panel creates a `Payment` and a Checkout Session (`src/lib/billing.ts`).
2. Stripe calls `/api/stripe/webhook`; on success the plan and `paidUntil` are updated and the
   agent creates or rebuilds the container. Changing plans converts leftover days by price.
3. `/api/cron/billing` (run every few minutes with `CRON_SECRET`) suspends servers whose paid
   period ended, removes unpaid servers after a day, and retries failed provisioning.

For local testing use Stripe test keys and `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Deploy

See [deploy/README.md](deploy/README.md): one Ubuntu server, one setup script.

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
- `src/lib/agent.ts` — client for the node agent; `src/lib/servers.ts` — ports, addresses, ownership, live status
- `src/lib/billing.ts`, `src/app/api/stripe`, `src/app/api/cron` — payments and the billing job
- `agent/` — the node agent (see its README)
- `src/middleware.ts` — redirects signed-out users away from `/dashboard`
- `src/i18n` — languages (Polish default, English) and currencies (PLN default, EUR, USD, GBP), stored in cookies and switched from the top-right picker
- `src/lib/plans.ts` — plan limits and monthly prices per currency
- `src/lib/games.ts` — ready games offered when creating a Java server (a server kind plus starting plugins and the RAM it needs); `src/lib/plugins.ts` — well-known plugins by Modrinth ID and the one-click plugin sets; `src/lib/modpacks.ts` — curated mod packs with the RAM each needs; `src/lib/ram.ts` — the home page RAM calculator
- `src/lib/support.ts`, `src/app/api/support`, `src/app/dashboard/support`, `src/app/admin/support` — the Help chat: each user has one conversation with the admins; open chats poll for new messages, and whoever isn't looking gets an email about the first unread one
- `src/lib/brand.ts` — the site name (MCHosting); `src/app/globals.css` — the dark theme and all styles
- `public/art/` — the block artwork, drawn by `scripts/gen-art.mjs` (run `node scripts/gen-art.mjs` after editing it)

## Adding a language

Copy `src/i18n/messages/en.ts` to a new file, translate it, register it in `src/i18n/messages.ts`, and add its code to `locales` in `src/i18n/config.ts`. TypeScript fails the build if a key is missing.
