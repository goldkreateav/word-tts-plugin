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
  textPreview: HTMLElement;
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

  private previewWordCount = 0;
  private currentPreviewWordIndex = -1;

  private selectionContentControlId: number | null = null;
  private selectionWords: string[] = [];
  private selectionWordOccurrenceIndex: number[] = [];
  private lastHighlightedWordIndex: number | null = null;

  constructor(ui: UiRefs) {
    this.ui = ui;
  }

  async init(): Promise<void> {
    const config = await loadRuntimeConfig();
    this.settings = await loadSettings(config);
    this.fillSettingsForm();
    this.bindEvents();
    this.setStatus("Готово.");
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
      apiUrl: this.normalizeApiBaseUrl(this.ui.apiUrl.value),
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

  private normalizeApiBaseUrl(input: string): string {
    const raw = (input || "").trim();
    if (!raw) return "";

    try {
      const u = new URL(raw);

      // Backward compatibility: previously users entered /v1/synthesize.
      if (u.pathname.endsWith("/synthesize")) {
        u.pathname = u.pathname.replace(/\/synthesize$/, "/");
      }

      // Prefer base URL ending in /v1/ (user might type /v1 without trailing slash).
      if (!u.pathname.endsWith("/")) {
        u.pathname += "/";
      }

      u.search = "";
      u.hash = "";
      return u.toString();
    } catch {
      return raw;
    }
  }

  private voicesUrlFromApiUrl(apiUrl: string): string | null {
    try {
      const base = new URL(this.normalizeApiBaseUrl(apiUrl));
      return new URL("./voices", base).toString();
    } catch {
      return null;
    }
  }

  private setVoiceOptions(voices: Array<{ id: string; name?: string }>): void {
    const current = this.settings.voice || "default";
    const seen = new Set<string>();
    const normalized: Array<{ id: string; name: string }> = [];

    const push = (id: string, name?: string) => {
      const v = (id || "").trim();
      if (!v) return;
      if (seen.has(v)) return;
      seen.add(v);
      normalized.push({ id: v, name: (name || v).trim() || v });
    };

    push("default", "По умолчанию");
    for (const v of voices) {
      push(v.id, v.name);
    }

    this.ui.voice.innerHTML = "";
    for (const v of normalized) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.name;
      this.ui.voice.appendChild(opt);
    }

    this.ui.voice.value = normalized.some((v) => v.id === current) ? current : "default";
    this.settings.voice = this.ui.voice.value;
  }

  private async refreshVoices(): Promise<void> {
    const voicesUrl = this.voicesUrlFromApiUrl(this.settings.apiUrl);
    if (!voicesUrl) {
      this.setVoiceOptions([{ id: this.settings.voice || "default" }]);
      return;
    }

    try {
      const resp = await fetch(voicesUrl, {
        headers: {
          ...(this.settings.apiKey ? { Authorization: `Bearer ${this.settings.apiKey}` } : {})
        }
      });
      if (!resp.ok) {
        this.setVoiceOptions([{ id: this.settings.voice || "default" }]);
        return;
      }
      const json = (await resp.json()) as { voices?: Array<{ id: string; name?: string }> };
      this.setVoiceOptions((json.voices || []).filter((v) => !!v?.id));
      await saveSettings(this.settings);
    } catch {
      this.setVoiceOptions([{ id: this.settings.voice || "default" }]);
    }
  }

  private async startReading(): Promise<void> {
    if (this.state === "playing") {
      return;
    }

    await this.persistSettings();
    if (!this.settings.apiUrl) {
      this.setStatus("Укажите URL TTS API перед запуском.");
      return;
    }

    this.stop();
    this.state = "playing";
    this.setControlState();

    this.activeController = new AbortController();
    this.playbackQueue = new PlaybackQueue(this.settings.volume);

    try {
      this.setStatus("Читаю выделенный текст в Word...");
      const selectedText = await getSelectedText();
      if (!selectedText) {
        throw new Error("Текст не выделен. Выделите фрагмент в Word и попробуйте ещё раз.");
      }

      await this.prepareSelectionHighlight(selectedText);
      this.renderPreview(selectedText);

      const chunks = splitIntoChunks(
        selectedText,
        this.settings.maxChunkLength,
        this.settings.pauseMs
      );
      if (!chunks.length) {
        throw new Error("Не удалось разбить текст на фрагменты.");
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

      let globalWordBase = 0;
      for (let i = 0; i < chunks.length; i += 1) {
        if (this.activeController.signal.aborted) {
          break;
        }
        prefetch(i + 2);
        this.setStatus(`Синтез: фрагмент ${i + 1}/${chunks.length}...`);
        const blob = await inFlight.get(i)!;
        this.setProgress(i + 1, chunks.length);
        this.setStatus(`Воспроизведение: фрагмент ${i + 1}/${chunks.length}...`);

        const chunkWords = this.tokenizeWords(chunks[i].text);
        const chunkWordCount = chunkWords.length;
        let lastLocalIndex = -1;

        await this.playbackQueue.playBlobWithProgress(blob, (currentTimeSec, durationSec) => {
          if (this.state !== "playing") return;
          if (chunkWordCount <= 0) return;
          if (!Number.isFinite(durationSec) || durationSec <= 0) return;

          const p = Math.min(0.999, Math.max(0, currentTimeSec / durationSec));
          const localIndex = Math.min(chunkWordCount - 1, Math.floor(p * chunkWordCount));
          if (localIndex === lastLocalIndex) return;
          lastLocalIndex = localIndex;

          const globalIndex = globalWordBase + localIndex;
          void this.highlightWord(globalIndex);
          this.setPreviewCurrentWord(globalIndex);
        });

        globalWordBase += chunkWordCount;
        await this.playbackQueue.wait(chunks[i].pauseAfterMs);
      }

      if (!this.activeController.signal.aborted) {
        this.setStatus("Готово.");
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
    this.setStatus("Пауза.");
    this.setControlState();
  }

  private resume(): void {
    if (this.state !== "paused" || !this.playbackQueue) {
      return;
    }
    this.playbackQueue.resume();
    this.state = "playing";
    this.setStatus("Продолжение.");
    this.setControlState();
  }

  private stop(): void {
    this.activeController?.abort();
    this.activeController = null;
    this.playbackQueue?.stop();
    this.playbackQueue = null;
    this.state = "idle";
    this.setControlState();

    void this.clearSelectionHighlight();
    this.clearPreview();
  }

  private setStatus(text: string): void {
    this.ui.status.textContent = text;
  }

  private setProgress(current: number, total: number): void {
    this.ui.progress.textContent = `Прогресс: ${current}/${total}`;
  }

  private setControlState(): void {
    this.ui.startBtn.disabled = this.state === "playing";
    this.ui.pauseBtn.disabled = this.state !== "playing";
    this.ui.resumeBtn.disabled = this.state !== "paused";
    this.ui.stopBtn.disabled = this.state === "idle";
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private tokenizeWords(text: string): string[] {
    const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu);
    return (tokens ?? []).filter(Boolean);
  }

  private renderPreview(text: string): void {
    const wordRegex = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu;
    let html = "";
    let wordIndex = 0;
    let lastIndex = 0;

    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = wordRegex.exec(text)) !== null) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      html += this.escapeHtml(text.slice(lastIndex, start));
      html += `<span class="wordToken" data-word-index="${wordIndex}">${this.escapeHtml(
        m[0]
      )}</span>`;
      wordIndex += 1;
      lastIndex = end;
    }
    html += this.escapeHtml(text.slice(lastIndex));

    this.previewWordCount = wordIndex;
    this.currentPreviewWordIndex = -1;
    this.ui.textPreview.innerHTML = html;
    this.ui.textPreview.hidden = false;
    this.ui.textPreview.scrollTop = 0;
  }

  private clearPreview(): void {
    this.previewWordCount = 0;
    this.currentPreviewWordIndex = -1;
    this.ui.textPreview.innerHTML = "";
    this.ui.textPreview.hidden = true;
  }

  private setPreviewCurrentWord(globalWordIndex: number): void {
    if (this.previewWordCount <= 0) return;
    if (globalWordIndex < 0 || globalWordIndex >= this.previewWordCount) return;
    if (globalWordIndex === this.currentPreviewWordIndex) return;

    const prev = this.ui.textPreview.querySelector<HTMLElement>(
      `[data-word-index="${this.currentPreviewWordIndex}"]`
    );
    prev?.classList.remove("current");

    const el = this.ui.textPreview.querySelector<HTMLElement>(
      `[data-word-index="${globalWordIndex}"]`
    );
    el?.classList.add("current");
    el?.scrollIntoView({ block: "center" });

    this.currentPreviewWordIndex = globalWordIndex;
  }

  private async prepareSelectionHighlight(selectedText: string): Promise<void> {
    const words = this.tokenizeWords(selectedText);
    const occurrenceIndex: number[] = [];
    const seen = new Map<string, number>();

    for (const w of words) {
      const key = w.toLocaleLowerCase();
      const n = seen.get(key) ?? 0;
      occurrenceIndex.push(n);
      seen.set(key, n + 1);
    }

    this.selectionWords = words;
    this.selectionWordOccurrenceIndex = occurrenceIndex;
    this.lastHighlightedWordIndex = null;

    this.selectionContentControlId = await Word.run(async (context) => {
      const selection = context.document.getSelection();
      const cc = selection.insertContentControl();
      cc.tag = "word-tts-selection";
      cc.title = "Word TTS Selection";
      cc.appearance = "BoundingBox";
      cc.color = "#f47c30";
      cc.load("id");
      await context.sync();
      return cc.id;
    });
  }

  private async clearSelectionHighlight(): Promise<void> {
    const ccId = this.selectionContentControlId;
    if (!ccId) {
      return;
    }

    const lastIndex = this.lastHighlightedWordIndex;
    const lastWord =
      lastIndex !== null && lastIndex >= 0 && lastIndex < this.selectionWords.length
        ? this.selectionWords[lastIndex]
        : null;
    const lastOcc =
      lastIndex !== null && lastIndex >= 0 && lastIndex < this.selectionWordOccurrenceIndex.length
        ? this.selectionWordOccurrenceIndex[lastIndex]
        : null;

    this.selectionContentControlId = null;
    this.selectionWords = [];
    this.selectionWordOccurrenceIndex = [];
    this.lastHighlightedWordIndex = null;

    await Word.run(async (context) => {
      const cc = context.document.contentControls.getById(ccId);
      cc.load("id");
      await context.sync();

      const range = cc.getRange();
      if (lastWord && lastOcc !== null) {
        const res = range.search(lastWord, { matchCase: false, matchWholeWord: true });
        res.load("items");
        await context.sync();
        if (lastOcc < res.items.length) {
          res.items[lastOcc].font.highlightColor = "";
        }
      }
      cc.delete(false);
      await context.sync();
    });
  }

  private async highlightWord(globalWordIndex: number): Promise<void> {
    const ccId = this.selectionContentControlId;
    if (!ccId) return;
    if (globalWordIndex < 0 || globalWordIndex >= this.selectionWords.length) return;
    if (this.lastHighlightedWordIndex === globalWordIndex) return;

    const nextWord = this.selectionWords[globalWordIndex];
    const nextOcc = this.selectionWordOccurrenceIndex[globalWordIndex];
    const prevIndex = this.lastHighlightedWordIndex;
    const prevWord =
      prevIndex !== null && prevIndex >= 0 && prevIndex < this.selectionWords.length
        ? this.selectionWords[prevIndex]
        : null;
    const prevOcc =
      prevIndex !== null && prevIndex >= 0 && prevIndex < this.selectionWordOccurrenceIndex.length
        ? this.selectionWordOccurrenceIndex[prevIndex]
        : null;

    this.lastHighlightedWordIndex = globalWordIndex;

    await Word.run(async (context) => {
      const cc = context.document.contentControls.getById(ccId);
      cc.load("id");
      await context.sync();

      const range = cc.getRange();

      if (prevWord && prevOcc !== null) {
        const prevRes = range.search(prevWord, { matchCase: false, matchWholeWord: true });
        prevRes.load("items");
        await context.sync();
        if (prevOcc < prevRes.items.length) {
          prevRes.items[prevOcc].font.highlightColor = "";
        }
      }

      const res = range.search(nextWord, { matchCase: false, matchWholeWord: true });
      res.load("items");
      await context.sync();
      if (nextOcc < res.items.length) {
        const r = res.items[nextOcc];
        r.font.highlightColor = "#fff200";
        r.select();
      }
      await context.sync();
    });
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
    textPreview: get<HTMLElement>("textPreview"),
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
