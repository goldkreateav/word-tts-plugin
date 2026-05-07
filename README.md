# Озвучивание текста в Word (Office.js)

Надстройка Word (Office.js), которая озвучивает выделенный текст через внешний TTS API.

## Возможности

- Озвучивание выделения в Word
- Почти “реалтайм”: разбиение текста на фрагменты + предзагрузка
- Управление: озвучить, пауза, продолжить, стоп
- Настройки: URL API, ключ, голос, скорость, пауза, громкость, размер фрагмента, формат
- Рантайм-конфиг: `config/default.json`

## Установка

1. Install dependencies:
   - `npm install`
2. Build:
   - `npm run build`
3. Start local dev server:
   - `npm start`
4. Подключите `manifest.xml` в Word (Microsoft 365 Add-ins / Shared Folder).

## Установщик для Windows (EXE)

Сборка небольшого установщика, который регистрирует надстройку для настольного Word через developer registry key Office:

- Build: `npm run x`
- Download bundle (recommended): `release/WordTTS-Install.zip`
- Run: extract the zip, then run `WordTTS-Install.exe`

Удаление регистрации:

- `npm run x:uninstall`

## Контракт TTS API

В `settings.apiUrl` укажите базовый URL API (рекомендуем заканчивать на `/v1/`), например `http://localhost:8000/v1/`.

Надстройка отправляет `POST` JSON на `settings.apiUrl + /synthesize`:

```json
{
  "text": "chunk text",
  "voice": "default",
  "rate": 1,
  "format": "mp3"
}
```

Поддерживаемые ответы:

- Binary audio (`audio/*`)
- JSON with `audioBase64`
- JSON with `audioUrl`

## Примечания

- Кнопка на ленте открывает панель в режиме автостарта (`taskpane.html?autostart=1`).
- Если текст не выделен, надстройка покажет ошибку в статусе.
