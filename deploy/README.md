# Going live on one server

Everything runs on one machine: the website, the database, and the agent that starts each
Minecraft server in Docker. See the "Hosting setup" section of the plan for why.

## 1. Buy the domain and the server

1. **Domain:** buy `mchosting.pl` from any registrar (OVH sells .pl domains too, so everything can sit
   in one account).
2. **Server:** order an OVH **Rise-Game-1** in Warsaw (or Limburg) and pick **Ubuntu 24.04** as the
   system. When it's ready, OVH emails you its **IP address**, a **username** (usually `ubuntu`) and
   a password or login link.
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
   `ssh ubuntu@SERVER_IP` (use the username and password from OVH's email). Then type `sudo -i`
   to become the admin user.
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
