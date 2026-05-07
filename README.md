# Word TTS Reader (Office.js)

Word Office Add-in that reads selected text using an external TTS API.

## Features

- Read current Word selection
- Near real-time playback with text chunking + prefetch
- Play, pause, resume, and stop controls
- Settings: API URL, API key, voice, speed, pause, volume, chunk size, format
- Runtime config file: `config/default.json`

## Setup

1. Install dependencies:
   - `npm install`
2. Build:
   - `npm run build`
3. Start local dev server:
   - `npm start`
4. Sideload `manifest.xml` into Word (Microsoft 365 Add-ins / Shared Folder method).

## One-click Windows installer (EXE)

Build a small installer exe that registers the add-in for desktop Word via the Office developer registry key:

- Build: `npm run x`
- Run: `release/WordTTS-Install.exe`

To remove the registration:

- `npm run x:uninstall`

## TTS API contract

The add-in sends `POST` JSON to `settings.apiUrl`:

```json
{
  "text": "chunk text",
  "voice": "default",
  "rate": 1,
  "format": "mp3"
}
```

Accepted responses:

- Binary audio (`audio/*`)
- JSON with `audioBase64`
- JSON with `audioUrl`

## Notes

- Ribbon button opens taskpane in auto-start mode (`taskpane.html?autostart=1`).
- If no text is selected, the add-in shows an error in status.
