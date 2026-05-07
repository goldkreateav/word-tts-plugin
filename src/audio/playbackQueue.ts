export class PlaybackQueue {
  private readonly audio: HTMLAudioElement;
  private readonly urls: string[] = [];
  private stopped = false;
  private progressTimer: number | null = null;

  constructor(volume: number) {
    this.audio = new Audio();
    this.audio.volume = volume;
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.min(1, Math.max(0, volume));
  }

  async playBlob(blob: Blob): Promise<void> {
    if (this.stopped) {
      return;
    }
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    await this.playUrl(url);
  }

  async playBlobWithProgress(
    blob: Blob,
    onProgress: (currentTimeSec: number, durationSec: number) => void
  ): Promise<void> {
    if (this.stopped) {
      return;
    }
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    await this.playUrl(url, onProgress);
  }

  pause(): void {
    this.audio.pause();
  }

  resume(): void {
    if (!this.stopped) {
      void this.audio.play();
    }
  }

  async wait(ms: number): Promise<void> {
    if (this.stopped || ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    this.stopped = true;
    this.clearProgressTimer();
    this.audio.pause();
    this.audio.src = "";
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.length = 0;
  }

  private clearProgressTimer(): void {
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private playUrl(
    url: string,
    onProgress?: (currentTimeSec: number, durationSec: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        resolve();
        return;
      }

      const onEnded = () => {
        this.clearProgressTimer();
        cleanup();
        resolve();
      };
      const onError = () => {
        this.clearProgressTimer();
        cleanup();
        reject(new Error("Audio playback failed"));
      };
      const cleanup = () => {
        this.audio.removeEventListener("ended", onEnded);
        this.audio.removeEventListener("error", onError);
      };

      this.audio.addEventListener("ended", onEnded);
      this.audio.addEventListener("error", onError);
      this.audio.src = url;

      this.clearProgressTimer();
      if (onProgress) {
        this.progressTimer = window.setInterval(() => {
          if (this.stopped) return;
          const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
          onProgress(this.audio.currentTime || 0, duration || 0);
        }, 80);
      }

      void this.audio.play().catch((error) => {
        this.clearProgressTimer();
        cleanup();
        reject(error);
      });
    });
  }
}
