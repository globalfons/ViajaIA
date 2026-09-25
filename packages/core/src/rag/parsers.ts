import { htmlToText } from "../tools/builtin";

/**
 * Document → plain text. Heavy parsers are imported lazily so that code paths
 * that never parse PDFs/DOCX (e.g. the web UI) don't load them.
 */

export const SUPPORTED_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/html": "html",
} as const;

export type DocKind = (typeof SUPPORTED_TYPES)[keyof typeof SUPPORTED_TYPES] | "url";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function detectKind(filename: string, mime?: string | null): DocKind | null {
  if (mime && mime in SUPPORTED_TYPES) return SUPPORTED_TYPES[mime as keyof typeof SUPPORTED_TYPES];
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "txt":
      return "txt";
    case "md":
    case "markdown":
      return "md";
    case "csv":
      return "csv";
    case "html":
    case "htm":
      return "html";
    default:
      return null;
  }
}

export interface ParsedDocument {
  text: string;
  title?: string;
  pages?: number;
  metadata: Record<string, unknown>;
}

/** Magic-number check: the content must match the declared kind. */
export function sniffMatches(kind: DocKind, bytes: Uint8Array): boolean {
  if (kind === "pdf") return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  if (kind === "docx") return bytes[0] === 0x50 && bytes[1] === 0x4b; // ZIP
  // Text formats: reject binaries (NUL bytes in the first KB).
  return !bytes.subarray(0, 1024).includes(0);
}

function csvToText(csv: string, Papa: typeof import("papaparse")): { text: string; rows: number } {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];
  // One line per row keeps each record retrievable on its own.
  const lines = parsed.data.slice(0, 50_000).map((row) => fields.map((f) => `${f}: ${String(row[f] ?? "").trim()}`).join(" | "));
  return { text: lines.join("\n"), rows: lines.length };
}

export async function parseDocument(kind: DocKind, bytes: Uint8Array, filename = ""): Promise<ParsedDocument> {
  if (!sniffMatches(kind, bytes)) throw new Error(`File content does not look like ${kind.toUpperCase()}`);
  const decode = () => new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");
  switch (kind) {
    case "pdf": {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: Buffer.from(bytes) });
      try {
        const res = await parser.getText();
        // pdf-parse inserts "-- 1 of 3 --" page separators: drop them.
        const text = res.text.replace(/^\s*-- \d+ of \d+ --\s*$/gm, "");
        return { text, pages: res.total, metadata: { pages: res.total } };
      } finally {
        await parser.destroy();
      }
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { text: res.value, metadata: {} };
    }
    case "csv": {
      const Papa = (await import("papaparse")).default;
      const { text, rows } = csvToText(decode(), Papa);
      return { text, metadata: { rows } };
    }
    case "html":
    case "url": {
      const html = decode();
      const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html)?.[1]?.trim();
      return { text: htmlToText(html), title, metadata: {} };
    }
    case "md":
    case "txt": {
      const text = decode();
      const title = kind === "md" ? /^#\s+(.+)$/m.exec(text)?.[1]?.trim() : undefined;
      return { text, title: title ?? (filename || undefined), metadata: {} };
    }
  }
}
