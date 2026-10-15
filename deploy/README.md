# Going live on one server

Everything runs on one machine: the website, the database, and the agent that starts each
Minecraft server in Docker. See the "Hosting setup" section of the plan for why.

## 1. Buy the domain and the server

1. **Domain:** buy `mchosting.pl` from any registrar (OVH sells .pl domains too, so everything can sit
   in one account).
2. **Server:** start small with a **Hetzner CAX21** (4 Arm cores, 8 GB RAM, 80 GB disk, about
   €11 a month plus VAT, billed by the hour, cancel any time). OVH's VPS-2 would also do, but it was
   sold out everywhere in October 2026.
   1. Sign up at <https://console.hetzner.com> (Hetzner may ask for ID or a card check first).
   2. Make a project, then **Add server** with: location **Nuremberg** or **Falkenstein**, image
      **Ubuntu 24.04**, type **Shared vCPU → Arm64 (Ampere) → CAX21**, networking **Public IPv4**
      and **IPv6** both on. Skip the SSH key, volumes, firewalls and backups.
   3. When it's ready, Hetzner emails you its **IP address** and a **root password**.

   Any other machine with Ubuntu 24.04 and at least 8 GB works the same way. Once players fill it,
   move to a bigger one, taking worlds, accounts and addresses along. Until then the site never
   sells more than the server can hold (see "Server memory" below).
3. **DNS:** in the registrar's DNS settings for the domain (OVH: Web Cloud → Domain names →
   mchosting.pl → DNS zone), add two records pointing at the server's IP:

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` (the domain itself) | server IP |
   | A | `*` (wildcard, for `ekipa.mchosting.pl` addresses) | server IP |

   Remove any other A records for `@` or `www` that the registrar added by default. DNS changes can
   take from a few minutes to a few hours to work everywhere.

## 2. Install

1. **Make a GitHub token** (the repository is private, so the server needs one to download it):
   GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token. Under "Repository access" pick only `Filipsq/mc-host`, and under
   "Permissions" set **Contents** to **Read-only**. Copy the token.
2. **Log in to the server:** on Windows open PowerShell, on a Mac open Terminal, and type
   `ssh root@SERVER_IP` with the password from Hetzner's email (it asks you to choose a new one
   the first time). On a server that gives you a user like `ubuntu` instead, log in as that user
   and type `sudo -i` to become root.
3. **Run:**

   ```bash
   git clone https://github.com/Filipsq/mc-host
   cd mc-host/deploy
   ./setup.sh
   ```

   `git clone` asks for a username (`Filipsq`) and a password: paste the token from step 1.
   `setup.sh` asks for the domain: type `mchosting.pl`.

It installs Docker, opens only the needed ports (SSH, 80, 443, 25565, 30000–30999/UDP for
Bedrock and crossplay, and 30000–30999/TCP for Terraria), generates passwords into `deploy/.env`, and starts everything. The first build takes a
few minutes. The site is then live at `https://mchosting.pl`; HTTPS is set up automatically as soon
as the DNS records from step 1 work.

Free servers work straight away. Paid plans show "payments unavailable" until the Stripe keys are
added below.

## 3. Payments

1. In the Stripe Dashboard, turn on **Card, BLIK and Przelewy24** under Settings → Payment methods.
2. Under Developers → Webhooks, add the endpoint `https://mchosting.pl/api/stripe/webhook` with the
   events `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed` and `checkout.session.expired`.
3. Put the secret key and the webhook signing secret into `deploy/.env`, then run
   `docker compose up -d` in `deploy/` again.

Use test keys (`sk_test_…`) first and pay with Stripe's test cards and test BLIK codes.

Also turn on **Successful payments** under Settings → Customer emails, so every buyer gets a receipt by
email. Polish consumer law expects a confirmation of the purchase on a "durable medium", and the receipt
covers that until the site sends its own emails.

## Emails

The site sends password reset links by email through [Brevo](https://www.brevo.com) (free for up to
300 emails a day, data kept in the EU). Until it's set up, no emails go out and reset links only
appear in `docker compose logs web`.

1. Create a Brevo account and wait for it to be approved for sending.
2. Under Senders, Domains & Dedicated IPs → Domains, add `mchosting.pl`. Brevo shows a few DNS records
   (a `brevo-code` TXT, DKIM and DMARC). Add them in the domain's DNS zone at OVH, then click
   Authenticate in Brevo. Without this, emails land in spam or bounce.
3. Under SMTP & API → API keys, generate a key and put it in `deploy/.env` as `BREVO_API_KEY=…`.
4. Run `./setup.sh` again.

Emails come from `no-reply@mchosting.pl`; set `MAIL_FROM` in `deploy/.env` to use another address on
the same domain. The API goes over HTTPS, so Hetzner's block on outgoing mail ports doesn't matter.

## Phone app and notifications

The site installs as an app: on Android, Chrome offers "Install app" (or the button on the panel's
"MCHosting app for your phone" card); on an iPhone, Safari → Share → Add to Home Screen. It opens the
server list full screen, without the browser bar.

Users who turn on notifications on that card get them on the device when a plan is paid, ends in 3
days, is suspended or is about to be deleted, when the help chat gets a reply and when a referral
pays out. Admins get one when a user writes in the help chat. An iPhone only gets them in the app
added to the home screen (iOS 16.4 or newer). `setup.sh` makes the key pair the notifications are
signed with (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` in `deploy/.env`); keep them unchanged, since new
keys cut off every phone that turned notifications on.

## AI server creator

On the home page and the new server page, players can describe the server they want and Claude (by
Anthropic) picks the game, mod pack, plan, plugins and game settings; they check the filled-in form and
create it as usual. Until it's set up, the AI boxes are hidden.

1. Create an account at [console.anthropic.com](https://console.anthropic.com), add credit under
   Billing (prepaid; $10 goes a long way) and, if you like, a monthly spend limit there too.
2. Under API keys, create a key and put it in `deploy/.env` as `ANTHROPIC_API_KEY=…`.
3. Run `./setup.sh` again.

`AI_MODEL` picks the model: `claude-opus-5-5` (the default, best picks, roughly $0.02 a use) or
`claude-haiku-5-5` (about 40 times cheaper). Each player may use it `AI_DAILY_LIMIT` times a day and
the whole site `AI_MONTHLY_LIMIT` times a month; the admin overview shows this month's use and an
estimated cost.

## CurseForge mod packs

With a CurseForge API key the home page shows CurseForge's 10 most popular mod packs that run on our
plans, and players can start a server from one in a click or paste a CurseForge link under "Inna
paczka". The server's image downloads and installs the pack on its first start. Packs with a mod
whose author forbids downloads outside CurseForge can't be installed that way, so they aren't
offered. Until a key is set, all of this is hidden.

1. Apply for a key at [console.curseforge.com](https://console.curseforge.com). Say what it's for:
   listing popular packs on the site and installing them on customers' servers. The list is kept
   only in memory and refreshed every hour.
2. Put it in `deploy/.env` in single quotes, because CurseForge keys contain `$`:
   `CF_API_KEY='$2a$10$…'`.
3. Run `./setup.sh` again.

## When a plan runs out

Paid plans don't renew by themselves. Three days before the end, the owner gets a reminder by email.
When the period ends, the server is stopped and suspended (its memory is free for others) and the
owner is told. The world is kept for 14 days; three days before it goes the owner gets one last
email, and then the billing job deletes the server with its world and backups. Its payments stay in
the admin panel. A server isn't deleted while its owner is in the middle of paying, and paying (or
adding free days in the admin panel) before then brings it back as it was.

## Terms and privacy

The terms (`/regulamin`), privacy policy (`/polityka-prywatnosci`) and contact page (`/kontakt`) show
highlighted blanks until the owner's details are filled in `src/lib/company.ts`: name or company,
address, NIP (if any), contact email and the date the terms take effect. Have them checked by a lawyer
before taking real payments.

## Server memory

`setup.sh` works out how much memory the Minecraft servers may share and writes it to `deploy/.env`
as `MEMORY_LIMIT_MB` (on an 8 GB server that's about 5 GB). It also writes `MEMORY_OVERBOOK=2`:
paid plans are sold up to 2 times that memory (about 10 GB on an 8 GB server), as most hosts do.
That works because a stopped server uses no memory, and a running Java server starts small and only
grows as far as its players need, up to its plan. Once it's all sold, the site shows paid plans as
sold out.

On an 8 GB server that means, for example, three Starters or one Standard and one Starter. A single
server can't get more than the machine really has, so Pro (10 GB) shows as sold out until you move
to a bigger machine.

Free servers only use memory while someone plays. One starts only when the running servers' plans
still fit in the overbooked limit and the machine really has its memory free with 1 GB to spare;
otherwise it waits ("all free slots are taken, try again in a few minutes") until another falls
asleep. Paid servers always start.

The bet is that not every server uses all of its memory at the same moment. If they ever do, the
system stops the biggest one and Docker starts it again. The admin panel shows the machine's real
RAM use; when it stays high, lower `MEMORY_OVERBOOK` or move to a bigger machine. `MEMORY_OVERBOOK=1`
turns overbooking off: paid servers then keep their memory even when switched off, so their owners
can always start them.

To change either, edit `deploy/.env` and run `docker compose up -d` in `deploy/`. Servers made
before an update pick up the smaller starting memory the next time their settings are saved.

## Backups

Paid servers are backed up once a day (Starter keeps the last one, Standard 7, Pro 14), and owners
can download, restore or make one in their server's panel. The backups sit in the `mchost-backups`
Docker volume on the same disk, so they cover griefing and mistakes, not losing the machine itself.
For that, turn on Hetzner's own backups for the server (Backups tab in the Hetzner console, 20% of
the server's price).

`du -sh /var/lib/docker/volumes/mchost-backups` shows how much space they take.

## Files and plugins

Owners can browse, upload (up to 1 GB a file), edit, unzip and delete their server's files in the
panel. The agent reaches them in `/var/lib/docker/volumes`, which `docker-compose.yml` mounts into
it. Uploads stop when less than 4 GB of disk would be left (`MIN_FREE_DISK_MB`).

Each plan also has its own disk space (Free 2 GB, Starter 10 GB, Standard 20 GB, Pro 40 GB, set in
`src/lib/plans.ts`; backups don't count). Uploads that would go over it are refused. The agent
measures every server every 10 minutes, and a server whose world grows more than 10% past its limit
is stopped until its owner deletes files or moves to a bigger plan. The admin panel shows each
server's disk use and lists the ones over their limit. `df -h /` shows the machine's disk as a whole.

Plugins are picked from Modrinth in the panel and downloaded by the server itself when it starts.

## Admin panel

Sign up on the site with your own email, then make that account an admin:

```bash
cd ~/mc-host/deploy && ./admin.sh you@example.com
```

An **Admin panel** button then appears under My servers (or go to `/admin`). It shows the machine's
memory, disk and CPU load, every server, user and payment, and what needs attention (crashed servers,
plans ending soon, suspended servers). From a server's admin page you can open its normal panel
(console, files, settings, as if you were the owner), add free days to a paid plan, or delete it.
`./admin.sh --remove you@example.com` takes admin away again. Nobody can become an admin from the
site itself.

## Updating

```bash
cd mc-host && git pull && cd deploy && ./setup.sh
```

## Useful commands (run in `deploy/`)

| | |
| --- | --- |
| `docker compose logs -f web` | Website logs |
| `docker compose logs -f agent` | Agent and router logs (who joined, which servers slept or woke) |
| `docker compose ps` | What's running |
| `./admin.sh you@example.com` | Make an account an admin (see Admin panel) |
| `docker ps --filter label=mchost.server` | The Minecraft server containers |
| `docker stats --no-stream` | How much memory each container uses right now |
