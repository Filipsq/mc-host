# Going live on one server

Everything runs on one machine: the website, the database, and the agent that starts each
Minecraft server in Docker. See the "Hosting setup" section of the plan for why.

## 1. Before you start

- **A server** with Ubuntu 24.04 (recommended: OVH Rise-Game-1, Warsaw or Limburg), and its IP address.
- **A domain** (e.g. `kilofhost.pl`). At the registrar, add two DNS records pointing at the server's IP:

  | Type | Name | Value |
  | --- | --- | --- |
  | A | `@` (the domain itself) | server IP |
  | A | `*` (wildcard, for `ekipa.kilofhost.pl` addresses) | server IP |

## 2. Install

Log in to the server over SSH as root and run:

```bash
git clone https://github.com/Filipsq/mc-host
cd mc-host/deploy
./setup.sh
```

It installs Docker, opens only the needed ports (SSH, 80, 443, 25565, and 30000–30999/UDP for
Bedrock), asks for the domain, generates passwords into `deploy/.env`, and starts everything.
The site is then live at `https://your-domain` (HTTPS is set up automatically).

The repository is private, so `git clone` asks for your GitHub username and a
[personal access token](https://github.com/settings/tokens) as the password.

## 3. Payments

1. In the Stripe Dashboard, turn on **Card, BLIK and Przelewy24** under Settings → Payment methods.
2. Under Developers → Webhooks, add the endpoint `https://your-domain/api/stripe/webhook` with the
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
