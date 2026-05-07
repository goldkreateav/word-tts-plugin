import { RuntimeConfig, TtsSettings } from "../types";

const STORAGE_KEY = "word-tts-settings";

const defaultSettingsFromConfig = (config: RuntimeConfig): TtsSettings => ({
  apiUrl: config.TTS_API_BASE_URL,
  apiKey: "",
  voice: config.DEFAULT_VOICE || "default",
  rate: config.DEFAULT_RATE || 1,
  pauseMs: 120,
  volume: 1,
  audioFormat: config.AUDIO_FORMAT || "mp3",
  maxChunkLength: config.MAX_CHUNK_LENGTH || 320
});

const hasOfficeRuntimeStorage = (): boolean =>
  typeof OfficeRuntime !== "undefined" && !!OfficeRuntime.storage;

export async function loadSettings(config: RuntimeConfig): Promise<TtsSettings> {
  const defaults = defaultSettingsFromConfig(config);

  try {
    let raw: string | null = null;

    if (hasOfficeRuntimeStorage()) {
      raw = (await OfficeRuntime.storage.getItem(STORAGE_KEY)) as string | null;
    } else {
      raw = localStorage.getItem(STORAGE_KEY);
    }

    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<TtsSettings>;
    return {
      ...defaults,
      ...parsed
    };
  } catch {
    return defaults;
  }
}

export async function saveSettings(settings: TtsSettings): Promise<void> {
  const serialized = JSON.stringify(settings);

  if (hasOfficeRuntimeStorage()) {
    await OfficeRuntime.storage.setItem(STORAGE_KEY, serialized);
    return;
  }

  localStorage.setItem(STORAGE_KEY, serialized);
}
