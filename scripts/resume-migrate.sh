#!/bin/bash
CURSOR_FILE="D:/code/k-vault/.migrate-cursor"
KEY="k-vault-migrate-2026"
BASE="https://k-vault.648558021.workers.dev/api/migrate"

# Resume from saved cursor if exists
cursor=""
if [ -f "$CURSOR_FILE" ]; then
  cursor=$(cat "$CURSOR_FILE")
  echo "Resuming from saved cursor"
fi

for i in $(seq 1 300); do
  url="${BASE}?key=${KEY}"
  if [ -n "$cursor" ]; then url="${url}&cursor=${cursor}"; fi
  result=$(curl -s --max-time 120 "$url" 2>&1)
  
  d1cnt=$(echo "$result" | grep -o '"d1Count":[0-9]*' | head -1 | cut -d: -f2)
  complete=$(echo "$result" | grep -o '"listComplete":true')
  nextCursor=$(echo "$result" | grep -o '"nextCursor":"[^"]*"' | cut -d'"' -f4)
  
  echo "$(date '+%H:%M:%S') P$i d1=$d1cnt"
  
  if [ -n "$complete" ]; then
    echo "MIGRATION COMPLETE! d1=$d1cnt"
    rm -f "$CURSOR_FILE"
    exit 0
  fi
  
  if [ -z "$nextCursor" ]; then
    echo "No cursor returned, possible error: $result"
    exit 1
  fi
  
  # Save cursor for resume
  cursor="$nextCursor"
  echo "$cursor" > "$CURSOR_FILE"
  
  sleep 0.3
done
echo "Reached 300 pages, run again to continue"
