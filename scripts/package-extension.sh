#!/usr/bin/env bash
# Build dist/purrtect-extension.zip for judges (attach it to the GitHub release).
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/sync.sh
mkdir -p dist
rm -f dist/purrtect-extension.zip
(cd extension && zip -qr ../dist/purrtect-extension.zip . -x '*.DS_Store')
echo "dist/purrtect-extension.zip ($(du -h dist/purrtect-extension.zip | cut -f1))"
