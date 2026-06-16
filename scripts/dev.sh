#!/bin/bash
# Start Express server in background
PORT=4137 npx tsx server/index.ts &
SERVER_PID=$!

# Start Vite dev server
VITE_PORT=5173 npx vite

# Cleanup on exit
trap "kill $SERVER_PID 2>/dev/null" EXIT
