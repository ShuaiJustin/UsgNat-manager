# Version Update Guide

## What It Updates

The release helper updates:

1. `package.json`
2. The version label shown in `src/renderer/pages/Settings/index.tsx`

## Recommended Usage

```bash
npm run version:update 1.0.8
```

Interactive mode is also supported:

```bash
npm run version:update
```

## Direct Script Usage

```bash
node scripts/release/update-version.js 1.0.8
node scripts/release/update-version.js
```

## Version Format

Supported formats:

- `1.0.8`
- `v1.0.8`

The script will normalize the value to `1.0.8`.

## Suggested Release Flow

```bash
npm run version:update 1.0.8
npm run build
npm run package:win
```

Generated installers are written under `release/`.

## File Locations

- Script: `scripts/release/update-version.js`
- Guide: `docs/guides/release/version-update.md`
