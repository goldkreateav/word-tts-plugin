import { TextChunk } from "../types";

const sentenceRegex = /[^.!?\n]+[.!?]?|\n+/g;

const estimatePause = (chunkText: string, basePauseMs: number): number => {
  const trimmed = chunkText.trim();
  if (!trimmed) {
    return basePauseMs;
  }

  if (/[.!?]$/.test(trimmed)) {
    return basePauseMs + 120;
  }
  if (/[,;:]$/.test(trimmed)) {
    return basePauseMs + 60;
  }
  return basePauseMs;
};

export function splitIntoChunks(
  input: string,
  maxChunkLength: number,
  basePauseMs: number
): TextChunk[] {
  const clean = input.trim();
  if (!clean) {
    return [];
  }

  const parts = clean.match(sentenceRegex) ?? [clean];
  const chunks: TextChunk[] = [];
  let current = "";
  let index = 0;

  for (const part of parts) {
    const piece = part.replace(/\s+/g, " ").trim();
    if (!piece) {
      continue;
    }

    const tentative = current ? `${current} ${piece}` : piece;
    if (tentative.length <= maxChunkLength) {
      current = tentative;
      continue;
    }

    if (current) {
      chunks.push({
        index: index++,
        text: current,
        pauseAfterMs: estimatePause(current, basePauseMs)
      });
      current = "";
    }

    if (piece.length <= maxChunkLength) {
      current = piece;
      continue;
    }

    let start = 0;
    while (start < piece.length) {
      const end = Math.min(start + maxChunkLength, piece.length);
      const slice = piece.slice(start, end).trim();
      if (slice) {
        chunks.push({
          index: index++,
          text: slice,
          pauseAfterMs: estimatePause(slice, basePauseMs)
        });
      }
      start = end;
    }
  }

  if (current) {
    chunks.push({
      index: index,
      text: current,
      pauseAfterMs: estimatePause(current, basePauseMs)
    });
  }

  return chunks;
}
