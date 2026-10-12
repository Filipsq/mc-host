#!/usr/bin/env bash
# Makes an account an admin of the site, or with --remove takes that back. Run on the server, in deploy/:
#   ./admin.sh you@example.com
#   ./admin.sh --remove you@example.com
# The account must exist: sign up on the site first.
set -euo pipefail
cd "$(dirname "$0")"

admin=true
if [ "${1:-}" = "--remove" ]; then
  admin=false
  shift
fi
email="${1:-}"
if [ -z "$email" ]; then
  echo "Usage: ./admin.sh [--remove] email" >&2
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
else
  echo "$found is no longer an admin."
fi
