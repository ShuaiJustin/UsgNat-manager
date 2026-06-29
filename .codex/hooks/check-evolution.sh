#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SIGNALS="$ROOT/.codex/evolution/signals.jsonl"

if [[ -s "$SIGNALS" ]]; then
  count="$(wc -l < "$SIGNALS" | tr -d ' ')"
  echo "[codex 钩子] 待处理进化信号：$count。请使用 evolution-engine 审阅。"
fi
