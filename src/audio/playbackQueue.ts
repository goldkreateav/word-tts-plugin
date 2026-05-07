export class PlaybackQueue {
  private readonly audio: HTMLAudioElement;
  private readonly urls: string[] = [];
  private stopped = false;

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
    this.audio.pause();
    this.audio.src = "";
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.length = 0;
  }

  private playUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        resolve();
        return;
      }

      const onEnded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
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
      void this.audio.play().catch((error) => {
        cleanup();
        reject(error);
      });
    });
  }
}
