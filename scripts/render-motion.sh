#!/bin/sh
# Restarts the no-reload server on :3778 so it serves the current source, then renders: scripts/render-motion.sh out.mp4 [seconds]
cd "$(dirname "$0")/.." || exit 1
pkill -f "motion.vite.config.ts" 2>/dev/null
node node_modules/vite/bin/vite.js --config motion.vite.config.ts >/dev/null 2>&1 &
VITE=$!
until curl -s -o /dev/null http://localhost:3778/motion.html; do sleep 0.5; done
node scripts/render-motion.mjs "$@"
kill $VITE
