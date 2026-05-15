#!/bin/sh
set -e

if [ ! -f /certs/localhost.crt ] || [ ! -f /certs/localhost.key ]; then
  echo "[word-tts] ERROR: /certs/localhost.crt or localhost.key missing." >&2
  echo "[word-tts] Run on the host (same user as compose, not root): npm run certs:install" >&2
  echo "[word-tts] If using sudo, set OFFICE_ADDIN_DEV_CERTS_HOST_DIR in .env to your home certs path." >&2
  exit 1
fi

if [ -n "$TTS_API_BASE_URL" ]; then
  node <<'EOF'
const fs = require("fs");
const path = "config/default.json";
const config = JSON.parse(fs.readFileSync(path, "utf8"));
config.TTS_API_BASE_URL = process.env.TTS_API_BASE_URL;
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
EOF
fi

exec npm run start
