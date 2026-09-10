#!/usr/bin/env bash
# What is in R2, and how much of the free tier is left.
#
# The user asked to be told this every time R2 is touched, in a build or a test.
# R2 is the one meter on this project with a card behind it, and Cloudflare's own
# alert arrives as an email that gets lost — so the number has to be easy enough
# to print that there is no excuse for not printing it.
#
# Free tier: 10 GB stored, 1M Class A ops/month, 10M Class B ops/month, no egress
# charge (docs/07-RESEARCH.md §2.1).
set -uo pipefail
cd "$(dirname "$0")/../worker"

BUCKET="${1:-stash-images}"
LIMIT_GB=10

info=$(npx wrangler r2 bucket info "$BUCKET" 2>/dev/null | tr -d '\r')
size_line=$(echo "$info" | grep -i 'bucket_size:' | sed 's/.*bucket_size: *//')
count=$(echo "$info" | grep -i 'object_count:' | sed 's/.*object_count: *//' | tr -d ' ')

if [ -z "$size_line" ]; then
  echo "  could not read $BUCKET — is wrangler logged in?"
  exit 1
fi

python3 - "$size_line" "$count" "$LIMIT_GB" <<'PY'
import sys, re
raw, count, limit_gb = sys.argv[1], sys.argv[2] or '0', float(sys.argv[3])

m = re.match(r'([\d.]+)\s*([KMGT]?)i?B', raw.strip(), re.I)
value, unit = (float(m.group(1)), m.group(2).upper()) if m else (0.0, '')
scale = {'': 1, 'K': 1e3, 'M': 1e6, 'G': 1e9, 'T': 1e12}[unit]
used = value * scale
limit = limit_gb * 1e9

pct = used / limit * 100
left = limit - used
# 200 KB is the working figure for a product image in 01-PRD.md R7.
room = int(left / 200_000)

bar_len = 40
filled = max(1, int(pct / 100 * bar_len)) if used else 0
bar = '#' * filled + '.' * (bar_len - filled)

print(f"  R2  {raw.strip()} of {limit_gb:.0f} GB   ({pct:.4f}%)   {count} objects")
print(f"      [{bar}]")
print(f"      {left/1e9:.2f} GB left — room for roughly {room:,} more images at 200 KB")
if pct >= 10:
    print(f"      NOTE: past 10% of the free tier. Worth a look at what is stored.")
PY
