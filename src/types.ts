export interface RuntimeConfig {
  TTS_API_BASE_URL: string;
  DEFAULT_VOICE: string;
  DEFAULT_RATE: number;
  AUDIO_FORMAT: string;
  REQUEST_TIMEOUT_MS: number;
  MAX_RETRIES: number;
  MAX_CHUNK_LENGTH: number;
  DEBUG: boolean;
}

export interface TtsSettings {
  apiUrl: string;
  apiKey: string;
  voice: string;
  rate: number;
  pauseMs: number;
  volume: number;
  audioFormat: string;
  maxChunkLength: number;
}

export interface TextChunk {
  index: number;
  text: string;
  pauseAfterMs: number;
}

export interface TtsRequest {
  text: string;
  voice: string;
  rate: number;
  format: string;
}

export interface AlignmentWord {
  word: string;
  startSec: number;
  endSec: number;
}

export interface TtsAlignment {
  words: AlignmentWord[];
}

export interface TtsSynthesisResult {
  audio: Blob;
  alignment?: TtsAlignment;
}
