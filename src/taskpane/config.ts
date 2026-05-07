import { RuntimeConfig } from "../types";

const fallback: RuntimeConfig = {
  TTS_API_BASE_URL: "",
  DEFAULT_VOICE: "default",
  DEFAULT_RATE: 1,
  AUDIO_FORMAT: "mp3",
  REQUEST_TIMEOUT_MS: 30000,
  MAX_RETRIES: 2,
  MAX_CHUNK_LENGTH: 320
};

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch("./config/default.json", { cache: "no-cache" });
    if (!response.ok) {
      return fallback;
    }
    const parsed = (await response.json()) as Partial<RuntimeConfig>;
    return {
      ...fallback,
      ...parsed
    };
  } catch {
    return fallback;
  }
}
