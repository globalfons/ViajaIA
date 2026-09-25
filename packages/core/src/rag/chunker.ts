/**
 * Recursive text splitter (paragraph → line → sentence → word) with overlap.
 * Sizes are in approximate tokens (≈4 chars per token for Spanish/English),
 * which is accurate enough for chunking and avoids a tokenizer dependency.
 */

export interface Chunk {
  index: number;
  content: string;
  tokens: number;
  /** Section heading (Markdown) the chunk belongs to, if any. */
  heading?: string;
  page?: number;
}

export interface ChunkOptions {
  chunkTokens?: number;
  overlapTokens?: number;
}

export const approxTokens = (text: string) => Math.ceil(text.length / 4);

const SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];

function split(text: string, maxChars: number, seps: string[]): string[] {
  if (text.length <= maxChars) return [text];
  const [sep, ...rest] = seps;
  if (sep === undefined) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars));
    return out;
  }
  const parts = text.split(sep);
  if (parts.length === 1) return split(text, maxChars, rest);
  const out: string[] = [];
  let cur = "";
  for (const [i, raw] of parts.entries()) {
    const piece = i < parts.length - 1 ? raw + sep : raw;
    if (piece.length > maxChars) {
      if (cur) out.push(cur);
      cur = "";
      out.push(...split(piece, maxChars, rest));
    } else if ((cur + piece).length > maxChars) {
      if (cur) out.push(cur);
      cur = piece;
    } else {
      cur += piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = (opts.chunkTokens ?? 400) * 4;
  const overlapChars = Math.min((opts.overlapTokens ?? 60) * 4, Math.floor(maxChars / 2));
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  // Track Markdown headings so each chunk knows its section.
  const sections: { heading?: string; body: string }[] = [];
  let current: { heading?: string; body: string } = { body: "" };
  for (const line of normalized.split("\n")) {
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    if (h) {
      if (current.body.trim()) sections.push(current);
      current = { heading: h[1]!.trim(), body: `${line}\n` };
    } else current.body += `${line}\n`;
  }
  if (current.body.trim()) sections.push(current);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const pieces = split(section.body.trim(), maxChars, SEPARATORS);
    let prevTail = "";
    for (const p of pieces) {
      const content = (prevTail + p).trim();
      if (content) chunks.push({ index: chunks.length, content, tokens: approxTokens(content), heading: section.heading });
      prevTail = overlapChars ? p.slice(-overlapChars).replace(/^\S*\s/, "") : "";
    }
  }
  return chunks;
}

/** Reciprocal Rank Fusion of several ranked id lists (hybrid search). */
export function reciprocalRankFusion(lists: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
