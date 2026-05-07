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
- Download bundle (recommended): `release/WordTTS-Install.zip`
- Run: extract the zip, then run `WordTTS-Install.exe`

To remove the registration:

- `npm run x:uninstall`

## TTS API contract

Set `settings.apiUrl` to the API base URL (recommended: ending with `/v1/`), for example `http://localhost:8000/v1/`.

The add-in sends `POST` JSON to `settings.apiUrl + /synthesize`:

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
