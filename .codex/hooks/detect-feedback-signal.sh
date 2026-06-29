#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SIGNALS="$ROOT/.codex/evolution/signals.jsonl"
mkdir -p "$(dirname "$SIGNALS")"

msg="${CODEX_USER_MESSAGE:-${1:-}}"
[[ -n "$msg" ]] || exit 0

if printf '%s' "$msg" | grep -E '不对|不是这样|你没看|错了|漏了|以后要|下次' >/dev/null; then
  escaped="$(printf '%s' "$msg" | python -c "import json,sys; print(json.dumps(sys.stdin.read(), ensure_ascii=False))" 2>/dev/null || printf '\"%s\"' "$msg")"
  printf '{"time":"%s","source":"user","message":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$escaped" >> "$SIGNALS"
fi
