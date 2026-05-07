import { PlaybackQueue } from "../audio/playbackQueue";
import { loadSettings, saveSettings } from "../settings/store";
import { splitIntoChunks } from "../tts/chunker";
import { TtsClient } from "../tts/ttsClient";
import { TtsRequest, TtsSettings } from "../types";
import { getSelectedText } from "../word/selectionReader";
import { loadRuntimeConfig } from "./config";

type PlaybackState = "idle" | "playing" | "paused";

interface UiRefs {
  startBtn: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  resumeBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  status: HTMLElement;
  progress: HTMLElement;
  apiUrl: HTMLInputElement;
  apiKey: HTMLInputElement;
  voice: HTMLSelectElement;
  rate: HTMLInputElement;
  pauseMs: HTMLInputElement;
  volume: HTMLInputElement;
  maxChunkLength: HTMLInputElement;
  audioFormat: HTMLInputElement;
}

class TaskpaneApp {
  private readonly ui: UiRefs;
  private state: PlaybackState = "idle";
  private settings!: TtsSettings;
  private playbackQueue: PlaybackQueue | null = null;
  private activeController: AbortController | null = null;

  constructor(ui: UiRefs) {
    this.ui = ui;
  }

  async init(): Promise<void> {
    const config = await loadRuntimeConfig();
    this.settings = await loadSettings(config);
    this.fillSettingsForm();
    this.bindEvents();
    this.setStatus("Ready.");
    await this.refreshVoices();

    const autoStart = new URLSearchParams(window.location.search).get("autostart");
    if (autoStart === "1") {
      void this.startReading();
    }
  }

  private bindEvents(): void {
    this.ui.startBtn.addEventListener("click", () => void this.startReading());
    this.ui.pauseBtn.addEventListener("click", () => this.pause());
    this.ui.resumeBtn.addEventListener("click", () => this.resume());
    this.ui.stopBtn.addEventListener("click", () => this.stop());

    const onInput = () => void this.persistSettings();

    this.ui.apiUrl.addEventListener("change", () => void this.onApiConnectionChanged());
    this.ui.apiKey.addEventListener("change", () => void this.onApiConnectionChanged());
    this.ui.voice.addEventListener("change", () => void this.persistSettings());
    this.ui.rate.addEventListener("change", onInput);
    this.ui.pauseMs.addEventListener("change", onInput);
    this.ui.volume.addEventListener("change", onInput);
    this.ui.maxChunkLength.addEventListener("change", onInput);
    this.ui.audioFormat.addEventListener("change", onInput);
  }

  private fillSettingsForm(): void {
    this.ui.apiUrl.value = this.settings.apiUrl;
    this.ui.apiKey.value = this.settings.apiKey;
    // options loaded async; keep current value until refreshVoices() runs
    if (this.ui.voice.value !== this.settings.voice) {
      this.ui.voice.value = this.settings.voice;
    }
    this.ui.rate.value = String(this.settings.rate);
    this.ui.pauseMs.value = String(this.settings.pauseMs);
    this.ui.volume.value = String(this.settings.volume);
    this.ui.maxChunkLength.value = String(this.settings.maxChunkLength);
    this.ui.audioFormat.value = this.settings.audioFormat;
  }

  private readSettingsFromForm(): TtsSettings {
    return {
      apiUrl: this.ui.apiUrl.value.trim(),
      apiKey: this.ui.apiKey.value.trim(),
      voice: this.ui.voice.value.trim() || "default",
      rate: Number(this.ui.rate.value) || 1,
      pauseMs: Math.max(0, Number(this.ui.pauseMs.value) || 0),
      volume: Math.min(1, Math.max(0, Number(this.ui.volume.value) || 1)),
      maxChunkLength: Math.max(80, Number(this.ui.maxChunkLength.value) || 320),
      audioFormat: this.ui.audioFormat.value.trim() || "mp3"
    };
  }

  private async persistSettings(): Promise<void> {
    this.settings = this.readSettingsFromForm();
    await saveSettings(this.settings);
    this.playbackQueue?.setVolume(this.settings.volume);
  }

  private async onApiConnectionChanged(): Promise<void> {
    await this.persistSettings();
    await this.refreshVoices();
  }

  private voicesUrlFromApiUrl(apiUrl: string): string | null {
    try {
      const u = new URL(apiUrl);
      u.pathname = "/v1/voices";
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch {
      return null;
    }
  }

  private setVoiceOptions(voiceIds: string[]): void {
    const current = this.settings.voice || "default";
    const unique = Array.from(new Set(["default", ...voiceIds.filter(Boolean)]));

    this.ui.voice.innerHTML = "";
    for (const id of unique) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      this.ui.voice.appendChild(opt);
    }

    this.ui.voice.value = unique.includes(current) ? current : "default";
    this.settings.voice = this.ui.voice.value;
  }

  private async refreshVoices(): Promise<void> {
    const voicesUrl = this.voicesUrlFromApiUrl(this.settings.apiUrl);
    if (!voicesUrl) {
      this.setVoiceOptions([this.settings.voice || "default"]);
      return;
    }

    try {
      const resp = await fetch(voicesUrl, {
        headers: {
          ...(this.settings.apiKey ? { Authorization: `Bearer ${this.settings.apiKey}` } : {})
        }
      });
      if (!resp.ok) {
        this.setVoiceOptions([this.settings.voice || "default"]);
        return;
      }
      const json = (await resp.json()) as { voices?: Array<{ id: string }> };
      const ids = (json.voices || []).map((v) => v.id).filter(Boolean);
      this.setVoiceOptions(ids);
      await saveSettings(this.settings);
    } catch {
      this.setVoiceOptions([this.settings.voice || "default"]);
    }
  }

  private async startReading(): Promise<void> {
    if (this.state === "playing") {
      return;
    }

    await this.persistSettings();
    if (!this.settings.apiUrl) {
      this.setStatus("Set TTS API URL before starting.");
      return;
    }

    this.stop();
    this.state = "playing";
    this.setControlState();

    this.activeController = new AbortController();
    this.playbackQueue = new PlaybackQueue(this.settings.volume);

    try {
      this.setStatus("Reading Word selection...");
      const selectedText = await getSelectedText();
      if (!selectedText) {
        throw new Error("No text selected. Highlight text in Word and try again.");
      }

      const chunks = splitIntoChunks(
        selectedText,
        this.settings.maxChunkLength,
        this.settings.pauseMs
      );
      if (!chunks.length) {
        throw new Error("Unable to split selected text into chunks.");
      }

      const config = await loadRuntimeConfig();
      const ttsClient = new TtsClient(config, this.settings);
      const inFlight = new Map<number, Promise<Blob>>();
      const prefetch = (index: number): void => {
        if (index >= chunks.length || inFlight.has(index)) {
          return;
        }
        const req: TtsRequest = {
          text: chunks[index].text,
          voice: this.settings.voice,
          rate: this.settings.rate,
          format: this.settings.audioFormat
        };
        inFlight.set(index, ttsClient.synthesize(req, this.activeController?.signal));
      };

      prefetch(0);
      prefetch(1);

      for (let i = 0; i < chunks.length; i += 1) {
        if (this.activeController.signal.aborted) {
          break;
        }
        prefetch(i + 2);
        this.setStatus(`Synthesizing chunk ${i + 1}/${chunks.length}...`);
        const blob = await inFlight.get(i)!;
        this.setProgress(i + 1, chunks.length);
        this.setStatus(`Playing chunk ${i + 1}/${chunks.length}...`);
        await this.playbackQueue.playBlob(blob);
        await this.playbackQueue.wait(chunks[i].pauseAfterMs);
      }

      if (!this.activeController.signal.aborted) {
        this.setStatus("Done.");
      }
    } catch (error) {
      this.setStatus((error as Error).message);
    } finally {
      this.stop();
    }
  }

  private pause(): void {
    if (this.state !== "playing" || !this.playbackQueue) {
      return;
    }
    this.playbackQueue.pause();
    this.state = "paused";
    this.setStatus("Paused.");
    this.setControlState();
  }

  private resume(): void {
    if (this.state !== "paused" || !this.playbackQueue) {
      return;
    }
    this.playbackQueue.resume();
    this.state = "playing";
    this.setStatus("Resumed.");
    this.setControlState();
  }

  private stop(): void {
    this.activeController?.abort();
    this.activeController = null;
    this.playbackQueue?.stop();
    this.playbackQueue = null;
    this.state = "idle";
    this.setControlState();
  }

  private setStatus(text: string): void {
    this.ui.status.textContent = text;
  }

  private setProgress(current: number, total: number): void {
    this.ui.progress.textContent = `Progress: ${current}/${total}`;
  }

  private setControlState(): void {
    this.ui.startBtn.disabled = this.state === "playing";
    this.ui.pauseBtn.disabled = this.state !== "playing";
    this.ui.resumeBtn.disabled = this.state !== "paused";
    this.ui.stopBtn.disabled = this.state === "idle";
  }
}

export function createTaskpaneApp(): TaskpaneApp {
  const get = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`Missing element: ${id}`);
    }
    return el as T;
  };

  const ui: UiRefs = {
    startBtn: get<HTMLButtonElement>("startBtn"),
    pauseBtn: get<HTMLButtonElement>("pauseBtn"),
    resumeBtn: get<HTMLButtonElement>("resumeBtn"),
    stopBtn: get<HTMLButtonElement>("stopBtn"),
    status: get<HTMLElement>("status"),
    progress: get<HTMLElement>("progress"),
    apiUrl: get<HTMLInputElement>("apiUrl"),
    apiKey: get<HTMLInputElement>("apiKey"),
    voice: get<HTMLSelectElement>("voice"),
    rate: get<HTMLInputElement>("rate"),
    pauseMs: get<HTMLInputElement>("pauseMs"),
    volume: get<HTMLInputElement>("volume"),
    maxChunkLength: get<HTMLInputElement>("maxChunkLength"),
    audioFormat: get<HTMLInputElement>("audioFormat")
  };

  return new TaskpaneApp(ui);
}
