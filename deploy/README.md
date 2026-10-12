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

It installs Docker, opens only the needed ports (SSH, 80, 443, 25565, and 30000–30999/UDP for
Bedrock), generates passwords into `deploy/.env`, and starts everything. The first build takes a
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

## Terms and privacy

The terms (`/regulamin`), privacy policy (`/polityka-prywatnosci`) and contact page (`/kontakt`) show
highlighted blanks until the owner's details are filled in `src/lib/company.ts`: name or company,
address, NIP (if any), contact email and the date the terms take effect. Have them checked by a lawyer
before taking real payments.

## Server memory

`setup.sh` works out how much memory the Minecraft servers may share and writes it to `deploy/.env`
as `MEMORY_LIMIT_MB` (on an 8 GB server that's about 5 GB). Paid servers keep their memory even when
switched off, so their owners can always start them; once it's all sold, the site shows paid plans
as sold out. Free servers only use memory while someone plays, and when there's no room a free
server waits ("all free slots are taken, try again in a few minutes") until another falls asleep.

On an 8 GB server that means, for example, one Starter plus one free server at a time, or two free
servers. Standard (6 GB) and Pro (10 GB) need more than those 5 GB, so they show as sold out
until you move to a bigger machine.

To change the limit, edit `MEMORY_LIMIT_MB` in `deploy/.env` and run `docker compose up -d` in
`deploy/`. Setting it above what the machine has means betting that not every server uses all of
its memory at once.

## Backups

Paid servers are backed up once a day (Starter keeps the last one, Standard 7, Pro 14), and owners
can download, restore or make one in their server's panel. The backups sit in the `mchost-backups`
Docker volume on the same disk, so they cover griefing and mistakes, not losing the machine itself.
For that, turn on Hetzner's own backups for the server (Backups tab in the Hetzner console, 20% of
the server's price).

`du -sh /var/lib/docker/volumes/mchost-backups` shows how much space they take.

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
| `docker ps --filter label=mchost.server` | The Minecraft server containers |
| `docker stats --no-stream` | How much memory each container uses right now |
