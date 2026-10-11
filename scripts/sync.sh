#!/usr/bin/env bash
# Copy the shared rules, UI, locales and mascots into the extension and the web checker.
# Run after editing shared/rules.json or anything in extension/ui, _locales or mascots.
set -euo pipefail
cd "$(dirname "$0")/.."

cp shared/rules.json extension/rules.json
cp shared/rules.json web/rules.json
cp extension/rules.js web/rules.js
mkdir -p web/ui
cp extension/ui/core.js extension/ui/verdict-card.js extension/ui/recovery-panel.js extension/ui/ui.css web/ui/
rm -rf web/_locales web/mascots
cp -R extension/_locales web/_locales
cp -R extension/mascots web/mascots
echo "synced shared files into extension/ and web/"
