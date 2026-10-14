# MCHosting

Web panel for free and paid Minecraft server hosting (Java and Bedrock), plus Terraria.

Users can sign up, create a Java, Bedrock or Terraria server on the free plan or a paid plan, start and stop
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
- `src/app/dashboard` — server list, create-server page, and each server's page with controls, live statistics (`Stats.tsx`: who is online, RAM, CPU, TPS and player charts from the agent's `/metrics`) and console
- `src/lib/agent.ts` — client for the node agent; `src/lib/servers.ts` — ports, addresses, ownership, live status
- `src/lib/billing.ts`, `src/app/api/stripe`, `src/app/api/cron` — payments and the billing job
- `agent/` — the node agent (see its README)
- `src/middleware.ts` — redirects signed-out users away from `/dashboard`
- `src/i18n` — languages (Polish default, English) and currencies (PLN default, EUR, USD, GBP), stored in cookies and switched from the top-right picker
- `src/lib/plans.ts` — plan limits and monthly prices per currency
- `src/lib/games.ts` — ready games offered when creating a Java server (a server kind plus starting plugins and the RAM it needs); `src/lib/plugins.ts` — well-known plugins by Modrinth ID and the one-click plugin sets; `src/lib/modpacks.ts` — curated mod packs with the RAM each needs; `src/lib/ram.ts` — the home page RAM calculator
- `src/lib/curseforge.ts`, `src/components/CurseforgeTop.tsx` — with `CF_API_KEY`, CurseForge's 10 most popular mod packs that run on our plans (on the home page, kept in memory for an hour) and CurseForge links as packs; each pack's manifest is read to count its mods (which sets the RAM it needs) and to skip packs whose mods may not be downloaded outside CurseForge. `src/lib/packChoice.ts` resolves the pack a form picked from either site
- `src/lib/modrinth.ts` — Modrinth search for plugins, mods (filtered by loader and Minecraft version) and mod packs; Fabric, Forge and NeoForge servers ("Własne mody") share the plugins page with mod wording, and the agent installs the chosen projects at start
- `src/lib/access.ts`, `src/app/dashboard/servers/[id]/access` — friends' access: the owner lets people into a server's panel by email and ticks what they may use (console, files, plugins, settings, backups); every page, action and API route checks it with `getServerFor`
- `src/lib/worlds.ts`, `src/app/dashboard/servers/[id]/worlds`, `src/app/api/servers/[id]/worlds` — Worlds: download a world for single-player, upload one from a zip, start a new one with a seed and type, switch which one the server runs, delete old ones
- `src/lib/serverType.ts`, `src/app/dashboard/servers/[id]/type` — changing a Java server's type (Paper, a game mode, own mods, a mod pack) from Settings: it says which plan the new type needs, backs up paid servers, moves the old mods aside and starts a new world, keeping the old one in Worlds
- Non-premium (`Server.onlineMode` false, Paper servers only): a checkbox in the create form and Settings; the agent adds AuthMe so players log in with a password
- `src/lib/referrals.ts`, `src/app/r/[code]`, `src/app/dashboard/invite` — invites: each user's link `/r/<code>` remembers the inviter in a cookie until sign-up; the friend's first payment of 30+ days adds 7 days to their server and gives the inviter 7 days (`User.bonusDays`, with an email) to add to a paid server of their choice
- Crossplay (`Server.crossplay`, Paper servers only, on by default for new ones): Bedrock players join a Java server through Geyser and Floodgate, at the server's Java address with its own port (UDP); the server page shows both addresses. A sleeping free server is only woken by a Java player or the Start button, and the whitelist only covers Java players
- `src/lib/support.ts`, `src/app/api/support`, `src/app/dashboard/support`, `src/app/admin/support` — the Help chat: each user has one conversation with the admins; open chats poll for new messages, and whoever isn't looking gets an email about the first unread one
- `src/lib/terraria.ts`, `TerrariaSettingsForm.tsx` — Terraria servers (`Edition` `TERRARIA`, `kind` `vanilla` or `tshock`): the world's size (`levelType`), difficulty (`difficulty`: classic, expert, master, journey) and seed are picked once in the create form; Settings change only the message and the join password (`Server.serverPassword`). Players join with the host and the server's own port (TCP); there are no plugins, worlds page or whitelist, and a sleeping free server wakes only from the panel
- `src/lib/brand.ts` — the site name (MCHosting); `src/app/globals.css` — the dark theme and all styles
- `public/art/` — the block artwork, drawn by `scripts/gen-art.mjs` (run `node scripts/gen-art.mjs` after editing it)

## Adding a language

Copy `src/i18n/messages/en.ts` to a new file, translate it, register it in `src/i18n/messages.ts`, and add its code to `locales` in `src/i18n/config.ts`. TypeScript fails the build if a key is missing.
