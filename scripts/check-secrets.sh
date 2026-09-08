#!/usr/bin/env bash
# Fails if anything git would commit contains a secret.
# Run before every commit and before every push:  npm run check:secrets
set -uo pipefail
cd "$(dirname "$0")/.."

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; OFF=$'\033[0m'
fail=0
note() { printf '  %s%s%s %s\n' "$2" "$1" "$OFF" "$3"; }
ok()   { note "PASS" "$GRN" "$1"; }
bad()  { note "FAIL" "$RED" "$1"; fail=1; }
warn() { note "WARN" "$YEL" "$1"; }

# Files git actually tracks or would add. node_modules and ignored paths are excluded
# by construction, so this checks exactly what could reach a remote.
tracked() { git ls-files --cached --others --exclude-standard 2>/dev/null; }

echo
echo "1. Secret files are ignored"
for f in .credentials.local.md worker/.dev.vars .env; do
  if [ -e "$f" ]; then
    if git check-ignore -q "$f"; then ok "$f is ignored"
    else bad "$f EXISTS AND IS NOT IGNORED"; fi
  fi
done
if tracked | grep -qE '(^|/)(\.env$|\.dev\.vars$|\.credentials)'; then
  bad "a secret file is in git's file list"
else
  ok "no secret file appears in git's file list"
fi

echo
echo "2. The device token does not appear in any committable file"
TOKEN=""
[ -f worker/.dev.vars ] && TOKEN=$(grep -oP 'DEVICE_TOKEN=\K.*' worker/.dev.vars 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  warn "no local token found — nothing to scan for"
else
  HITS=$(tracked | xargs -r grep -l -F -- "$TOKEN" 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    bad "TOKEN FOUND IN:"; echo "$HITS" | sed 's/^/         /'
  else
    ok "token value appears in no committable file"
  fi
fi

echo
echo "3. No hardcoded secrets in source"
# An assignment of a long opaque string to a secret-ish name.
PAT='(DEVICE_TOKEN|API_KEY|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|AUTH_TOKEN)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_\-]{16,}'
HITS=$(tracked | grep -E '\.(ts|tsx|js|jsx|json|toml|sh|yml|yaml)$' | xargs -r grep -InE "$PAT" 2>/dev/null || true)
if [ -n "$HITS" ]; then bad "possible hardcoded secret:"; echo "$HITS" | sed 's/^/         /'
else ok "no hardcoded secret assignments"; fi

echo
echo "4. No private keys or cloud credentials committed"
HITS=$(tracked | xargs -r grep -lE 'BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY|AKIA[0-9A-Z]{16}' 2>/dev/null || true)
if [ -n "$HITS" ]; then bad "key material found:"; echo "$HITS" | sed 's/^/         /'
else ok "no private keys or AWS keys"; fi

echo
echo "5. wrangler.toml carries no secret"
if grep -qiE '^[[:space:]]*(DEVICE_TOKEN|.*_(SECRET|KEY|PASSWORD))[[:space:]]*=' worker/wrangler.toml 2>/dev/null; then
  bad "wrangler.toml contains what looks like a secret"
else
  ok "wrangler.toml has no secret (secrets go via 'wrangler secret put')"
fi

echo
echo "6. Example files hold no real value"
for f in worker/.dev.vars.example web/.env.example; do
  [ -f "$f" ] || continue
  if grep -qE '=[[:space:]]*[A-Za-z0-9_\-]{16,}[[:space:]]*$' "$f"; then bad "$f looks like it has a real value"
  else ok "$f is a blank template"; fi
done

echo
if [ "$fail" -eq 0 ]; then
  printf '%sSAB THEEK — kuch bhi leak nahi ho raha.%s\n\n' "$GRN" "$OFF"
else
  printf '%sRUKO — upar FAIL wali line theek karo, tab tak commit ya push mat karna.%s\n\n' "$RED" "$OFF"
fi
exit "$fail"
