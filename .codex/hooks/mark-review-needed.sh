#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$ROOT/.codex/evolution"

if git -C "$ROOT" status --short 2>/dev/null | grep -E '^[ AMDRC?].*\.(js|jsx|ts|tsx|py|go|rs|java|cs|php|rb|swift|kt|css|scss|html|vue|svelte)$' >/dev/null; then
  printf '需要审查：代码变更于 %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ROOT/.codex/evolution/review-needed.flag"
fi
