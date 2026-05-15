#!/bin/sh
set -e

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
