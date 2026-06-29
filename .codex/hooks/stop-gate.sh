#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FLAG="$ROOT/.codex/evolution/review-needed.flag"

if [[ -f "$FLAG" ]]; then
  echo "[codex 钩子] 停止前仍需完成审查：$FLAG"
  exit 1
fi

exit 0
