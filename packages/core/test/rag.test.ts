import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkText, reciprocalRankFusion } from "../src/rag/chunker";
import { detectKind, parseDocument, sniffMatches } from "../src/rag/parsers";

const fixture = (f: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", f)));
const enc = (s: string) => new TextEncoder().encode(s);

describe("parsers", () => {
  it("extracts text from a real PDF", async () => {
    const doc = await parseDocument("pdf", fixture("horario.pdf"));
    expect(doc.text).toContain("lunes a viernes de 9 a 14h");
    expect(doc.pages).toBe(1);
  });

  it("extracts text from a real DOCX", async () => {
    const doc = await parseDocument("docx", fixture("politica.docx"));
    expect(doc.text).toContain("Aceptamos devoluciones durante 30 días");
  });

  it("turns CSV rows into self-contained lines", async () => {
    const doc = await parseDocument("csv", enc("producto,precio\nCorte,20 €\nTinte,45 €\n"));
    expect(doc.text).toBe("producto: Corte | precio: 20 €\nproducto: Tinte | precio: 45 €");
    expect(doc.metadata.rows).toBe(2);
  });

  it("strips scripts from HTML and keeps the title", async () => {
    const doc = await parseDocument("html", enc("<html><head><title>FAQ</title><script>steal()</script></head><body><h1>Envíos</h1><p>24-48h</p></body></html>"));
    expect(doc.title).toBe("FAQ");
    expect(doc.text).not.toContain("steal");
    expect(doc.text).toContain("24-48h");
  });

  it("uses the Markdown H1 as title", async () => {
    expect((await parseDocument("md", enc("# Guía\ntexto"))).title).toBe("Guía");
  });

  it("rejects files whose content does not match the extension", async () => {
    await expect(parseDocument("pdf", enc("not a pdf"))).rejects.toThrow(/does not look like PDF/);
    expect(sniffMatches("txt", new Uint8Array([0x41, 0x00, 0x42]))).toBe(false);
  });

  it("detects kinds by MIME or extension", () => {
    expect(detectKind("a.PDF")).toBe("pdf");
    expect(detectKind("x", "text/csv")).toBe("csv");
    expect(detectKind("virus.exe")).toBeNull();
  });
});

describe("chunker", () => {
  it("respects the size budget and overlaps consecutive chunks", () => {
    const text = Array.from({ length: 200 }, (_, i) => `Frase número ${i} sobre el servicio.`).join(" ");
    const chunks = chunkText(text, { chunkTokens: 100, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(100 * 4 + 20 * 4);
    const tail = chunks[0]!.content.slice(-30);
    expect(chunks[1]!.content).toContain(tail.slice(tail.indexOf(" ") + 1));
  });

  it("tracks Markdown sections", () => {
    const chunks = chunkText("# Envíos\nEnviamos en 24h.\n\n# Devoluciones\nTienes 30 días.");
    expect(chunks.map((c) => c.heading)).toEqual(["Envíos", "Devoluciones"]);
  });

  it("returns nothing for empty text and splits unbreakable strings", () => {
    expect(chunkText("   \n\n ")).toEqual([]);
    expect(chunkText("x".repeat(5000), { chunkTokens: 100 }).length).toBeGreaterThan(10);
  });
});

describe("reciprocalRankFusion", () => {
  it("rewards items ranked well in both lists", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["c", "a", "d"],
    ]);
    expect(fused[0]!.id).toBe("a");
    expect(fused.map((f) => f.id)).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
  });
});
