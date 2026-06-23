#!/bin/bash
cursor=""
total=0
for i in $(seq 1 250); do
  url="https://k-vault.648558021.workers.dev/api/migrate?key=k-vault-migrate-2026"
  if [ -n "$cursor" ]; then url="${url}&cursor=${cursor}"; fi
  result=$(curl -s --max-time 120 "$url" 2>&1)
  inserted=$(echo "$result" | grep -o '"inserted":[0-9]*' | head -1 | cut -d: -f2)
  d1cnt=$(echo "$result" | grep -o '"d1Count":[0-9]*' | head -1 | cut -d: -f2)
  complete=$(echo "$result" | grep -o '"listComplete":true')
  cursor=$(echo "$result" | grep -o '"nextCursor":"[^"]*"' | cut -d'"' -f4)
  total=$((total + inserted))
  echo "$(date '+%H:%M:%S') P$i: +$inserted d1=$d1cnt"
  if [ -n "$complete" ]; then echo "MIGRATION COMPLETE at d1=$d1cnt"; break; fi
  if [ -z "$cursor" ]; then echo "No cursor, stopping"; break; fi
  sleep 0.5
done
