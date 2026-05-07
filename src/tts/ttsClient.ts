import { RuntimeConfig, TtsRequest, TtsSettings } from "../types";

const toError = (message: string, status?: number): Error => {
  const suffix = status ? ` (HTTP ${status})` : "";
  return new Error(`${message}${suffix}`);
};

const withTimeout = (signal: AbortSignal | undefined, timeoutMs: number): AbortSignal => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort("timeout"), timeoutMs);

  const abortFromParent = () => controller.abort("cancelled");

  signal?.addEventListener("abort", abortFromParent, { once: true });
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    },
    { once: true }
  );

  return controller.signal;
};

export class TtsClient {
  constructor(private readonly config: RuntimeConfig, private readonly settings: TtsSettings) {}

  private baseUrl(): URL {
    const raw = (this.settings.apiUrl || "").trim();
    const u = new URL(raw);

    // Backward compatibility: previously users entered the full synthesize URL.
    if (u.pathname.endsWith("/synthesize")) {
      u.pathname = u.pathname.replace(/\/synthesize$/, "/");
    }

    // Ensure trailing slash so relative URL resolution works as expected.
    if (!u.pathname.endsWith("/")) {
      u.pathname += "/";
    }

    u.search = "";
    u.hash = "";
    return u;
  }

  private synthesizeUrl(): string {
    return new URL("./synthesize", this.baseUrl()).toString();
  }

  async synthesize(request: TtsRequest, signal?: AbortSignal): Promise<Blob> {
    const retries = Math.max(0, this.config.MAX_RETRIES);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(this.synthesizeUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.settings.apiKey ? { Authorization: `Bearer ${this.settings.apiKey}` } : {})
          },
          body: JSON.stringify({
            text: request.text,
            voice: request.voice,
            rate: request.rate,
            format: request.format
          }),
          signal: withTimeout(signal, this.config.REQUEST_TIMEOUT_MS)
        });

        if (!response.ok) {
          if (response.status >= 500 || response.status === 429) {
            throw toError("Temporary TTS API error", response.status);
          }
          throw toError("TTS API request failed", response.status);
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = (await response.json()) as { audioBase64?: string; audioUrl?: string };
          if (json.audioBase64) {
            const bytes = Uint8Array.from(atob(json.audioBase64), (ch) => ch.charCodeAt(0));
            return new Blob([bytes], { type: `audio/${request.format}` });
          }
          if (json.audioUrl) {
            const audioResp = await fetch(json.audioUrl, { signal });
            if (!audioResp.ok) {
              throw toError("Unable to fetch synthesized audio", audioResp.status);
            }
            return await audioResp.blob();
          }
          throw new Error("JSON response does not contain audio data");
        }

        return await response.blob();
      } catch (error) {
        if (signal?.aborted) {
          throw new Error("Synthesis aborted");
        }
        lastError = error as Error;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
        }
      }
    }

    throw lastError ?? new Error("Unknown TTS synthesis error");
  }
}
