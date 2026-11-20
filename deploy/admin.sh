#!/usr/bin/env bash
# Makes an account an admin of the site, or with --remove takes that back. Run on the server, in deploy/:
#   ./admin.sh you@example.com
#   ./admin.sh --remove you@example.com
#   ./admin.sh --reset-2fa you@example.com   (lost phone: the next visit to /admin sets the app up again)
# The account must exist: sign up on the site first.
set -euo pipefail
cd "$(dirname "$0")"

admin=true
if [ "${1:-}" = "--reset-2fa" ]; then
  email="${2:-}"
  [ -n "$email" ] || { echo "Usage: ./admin.sh --reset-2fa email" >&2; exit 1; }
  found=$(docker compose exec -T db psql -U mchost -d mchost -qtA -v email="$email" <<'SQL'
update "User" set "totpSecret" = null, "totpEnabledAt" = null, "totpLastStep" = null where email = lower(:'email') returning email;
SQL
)
  [ -n "$found" ] || { echo "There's no account with the email $email." >&2; exit 1; }
  echo "Two-step verification of $found is off. Sign in and open /admin to set up the app again."
  exit 0
fi
if [ "${1:-}" = "--remove" ]; then
  admin=false
  shift
fi
email="${1:-}"
if [ -z "$email" ]; then
  echo "Usage: ./admin.sh [--remove | --reset-2fa] email" >&2
  exit 1
fi

# psql fills in :'email' as a quoted string, so the address can't change the query.
found=$(docker compose exec -T db psql -U mchost -d mchost -qtA -v email="$email" -v admin="$admin" <<'SQL'
update "User" set admin = :admin where email = lower(:'email') returning email;
SQL
)

if [ -z "$found" ]; then
  echo "There's no account with the email $email. Sign up on the site first." >&2
  exit 1
fi
if [ "$admin" = true ]; then
  echo "$found is now an admin: the Admin panel button is under My servers, or go to /admin."
  echo "The first visit to /admin sets up two-step verification with an authenticator app."
else
  echo "$found is no longer an admin."
fi
