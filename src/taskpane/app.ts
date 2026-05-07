import { PlaybackQueue } from "../audio/playbackQueue";
import { loadSettings, saveSettings } from "../settings/store";
import { splitIntoChunks } from "../tts/chunker";
import { TtsClient } from "../tts/ttsClient";
import { AlignmentWord, RuntimeConfig, TtsRequest, TtsSettings, TtsSynthesisResult } from "../types";
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
  highlightColor: HTMLInputElement;
}

class TaskpaneApp {
  private readonly ui: UiRefs;
  private state: PlaybackState = "idle";
  private settings!: TtsSettings;
  private runtimeConfig!: RuntimeConfig;
  private playbackQueue: PlaybackQueue | null = null;
  private activeController: AbortController | null = null;

  private previewWordCount = 0;
  private currentPreviewWordIndex = -1;

  private selectionContentControlId: number | null = null;
  private selectionWords: string[] = [];
  private selectionWordOccurrenceIndex: number[] = [];
  private lastHighlightedWordIndex: number | null = null;
  private selectionWordSeen = new Map<string, number>();

  private highlightQueueRunning = false;
  private pendingHighlightWordIndex: number | null = null;
  private lastHighlightRequestMs = 0;
  private lastWordScrollMs = 0;

  constructor(ui: UiRefs) {
    this.ui = ui;
  }

  async init(): Promise<void> {
    this.runtimeConfig = await loadRuntimeConfig();
    this.settings = await loadSettings(this.runtimeConfig);
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
    this.ui.highlightColor.addEventListener("change", onInput);
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
    this.ui.highlightColor.value = this.settings.highlightColor || "#fff200";
    this.applyPreviewHighlightColor();
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
      audioFormat: this.ui.audioFormat.value.trim() || "mp3",
      highlightColor: (this.ui.highlightColor.value || "#fff200").trim() || "#fff200"
    };
  }

  private async persistSettings(): Promise<void> {
    this.settings = this.readSettingsFromForm();
    await saveSettings(this.settings);
    this.playbackQueue?.setVolume(this.settings.volume);
    this.applyPreviewHighlightColor();
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
      const inFlight = new Map<number, Promise<TtsSynthesisResult>>();
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
        inFlight.set(index, ttsClient.synthesizeWithAlignment(req, true, this.activeController?.signal));
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
        const synth = await inFlight.get(i)!;
        const blob = synth.audio;
        this.setProgress(i + 1, chunks.length);
        this.setStatus(`Воспроизведение: фрагмент ${i + 1}/${chunks.length}...`);

        const alignmentWords: AlignmentWord[] =
          synth.alignment?.words?.filter((w) => !!w?.word) ?? [];
        const chunkWords = alignmentWords.length
          ? alignmentWords.map((w) => w.word)
          : this.tokenizeWords(chunks[i].text);
        const chunkWordCount = chunkWords.length;

        this.appendSelectionWords(chunkWords);

        let lastLocalIndex = -1;

        await this.playbackQueue.playBlobWithProgress(blob, (currentTimeSec, durationSec) => {
          if (this.state !== "playing") return;
          if (chunkWordCount <= 0) return;
          if (!Number.isFinite(currentTimeSec) || currentTimeSec < 0) return;

          let localIndex = 0;
          if (alignmentWords.length) {
            // Find the word whose [startSec, endSec) contains currentTimeSec.
            // If currentTimeSec is between words (gap), keep the previous word.
            let lo = 0;
            let hi = alignmentWords.length - 1;
            let found = -1;
            while (lo <= hi) {
              const mid = (lo + hi) >> 1;
              const w = alignmentWords[mid];
              if (currentTimeSec < w.startSec) {
                hi = mid - 1;
              } else if (currentTimeSec >= w.endSec) {
                lo = mid + 1;
              } else {
                found = mid;
                break;
              }
            }
            // If not inside any word range, `hi` ends up as the index of the previous word.
            const best = found >= 0 ? found : hi;
            localIndex = Math.min(chunkWordCount - 1, Math.max(0, best));
          } else {
            if (!Number.isFinite(durationSec) || durationSec <= 0) return;
            const p = Math.min(0.999, Math.max(0, currentTimeSec / durationSec));
            localIndex = Math.min(chunkWordCount - 1, Math.floor(p * chunkWordCount));
          }
          if (localIndex === lastLocalIndex) return;
          lastLocalIndex = localIndex;

          const globalIndex = globalWordBase + localIndex;
          this.requestHighlight(globalIndex);
          this.setPreviewCurrentWord(globalIndex);
        });

        globalWordBase += chunkWordCount;
        await this.playbackQueue.wait(chunks[i].pauseAfterMs);
      }

      if (!this.activeController.signal.aborted) {
        this.setStatus("Готово.");
      }
    } catch (error) {
      this.reportError(error);
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

  private reportError(error: unknown): void {
    const err = error as Error;
    if (this.runtimeConfig?.DEBUG) {
      // eslint-disable-next-line no-console
      console.error(err);
      this.setStatus(err?.message || "Ошибка.");
      return;
    }

    const msg = (err?.message || "").toLowerCase();
    if (msg.includes("текст не выделен") || msg.includes("выделите фрагмент")) {
      this.setStatus("Текст не выделен. Выделите фрагмент в Word и попробуйте ещё раз.");
      return;
    }
    if (msg.includes("failed to fetch") || msg.includes("networkerror")) {
      this.setStatus("Сервер TTS недоступен. Запустите сервер и проверьте URL.");
      return;
    }
    if (msg.includes("timeout")) {
      this.setStatus("Сервер TTS не отвечает (таймаут).");
      return;
    }
    if (msg.includes("http 401") || msg.includes("http 403")) {
      this.setStatus("Нет доступа к TTS API. Проверьте API ключ.");
      return;
    }
    if (msg.includes("http 404")) {
      this.setStatus("Неверный URL TTS API. Проверьте адрес (должен указывать на базу `/v1/`).");
      return;
    }

    this.setStatus("Произошла ошибка. Проверьте URL/ключ и попробуйте ещё раз.");
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

  private requestHighlight(globalWordIndex: number): void {
    // Office.js calls are relatively slow; avoid queue buildup by always applying only the latest word.
    const now = Date.now();
    if (now - this.lastHighlightRequestMs < 110) {
      // throttling: if updates come too frequently, skip intermediate indices
      this.pendingHighlightWordIndex = globalWordIndex;
      if (!this.highlightQueueRunning) {
        void this.processHighlightQueue();
      }
      return;
    }
    this.lastHighlightRequestMs = now;
    this.pendingHighlightWordIndex = globalWordIndex;
    if (!this.highlightQueueRunning) {
      void this.processHighlightQueue();
    }
  }

  private async processHighlightQueue(): Promise<void> {
    if (this.highlightQueueRunning) return;
    this.highlightQueueRunning = true;
    try {
      while (this.pendingHighlightWordIndex !== null && this.state === "playing") {
        const idx = this.pendingHighlightWordIndex;
        this.pendingHighlightWordIndex = null;
        try {
          await this.highlightWord(idx);
        } catch (e) {
          if (this.runtimeConfig?.DEBUG) {
            // eslint-disable-next-line no-console
            console.error(e);
          }
        }
      }
    } finally {
      this.highlightQueueRunning = false;
    }
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
    this.applyPreviewHighlightColor();
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

  private applyPreviewHighlightColor(): void {
    const c = (this.settings?.highlightColor || "#fff200").trim() || "#fff200";
    this.ui.textPreview.style.setProperty("--highlight-color", c);
  }

  private async prepareSelectionHighlight(selectedText: string): Promise<void> {
    // We'll append words as we synthesize chunks (prefer alignment words).
    this.selectionWords = [];
    this.selectionWordOccurrenceIndex = [];
    this.selectionWordSeen = new Map<string, number>();
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

  private appendSelectionWords(words: string[]): void {
    for (const w of words) {
      const word = (w || "").trim();
      if (!word) continue;
      const key = word.toLocaleLowerCase();
      const n = this.selectionWordSeen.get(key) ?? 0;
      this.selectionWords.push(word);
      this.selectionWordOccurrenceIndex.push(n);
      this.selectionWordSeen.set(key, n + 1);
    }
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
      // Keep the user's text; remove only the content control wrapper.
      cc.delete(true);
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

      const prevRes =
        prevWord && prevOcc !== null
          ? range.search(prevWord, { matchCase: false, matchWholeWord: true })
          : null;
      prevRes?.load("items");

      if (prevWord && prevOcc !== null) {
        // loaded above
      }

      const res = range.search(nextWord, { matchCase: false, matchWholeWord: true });
      res.load("items");
      await context.sync();

      if (prevRes && prevOcc !== null && prevOcc < prevRes.items.length) {
        prevRes.items[prevOcc].font.highlightColor = "";
      }

      if (nextOcc < res.items.length) {
        const r = res.items[nextOcc];
        r.font.highlightColor = (this.settings.highlightColor || "#fff200").trim() || "#fff200";

        // Avoid view "jumps": scrolling via selection is expensive/flickery.
        // Scroll only occasionally to keep the current word in view.
        const now = Date.now();
        if (now - this.lastWordScrollMs > 900) {
          r.select("Start");
          this.lastWordScrollMs = now;
        }
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
    audioFormat: get<HTMLInputElement>("audioFormat"),
    highlightColor: get<HTMLInputElement>("highlightColor")
  };

  return new TaskpaneApp(ui);
}
