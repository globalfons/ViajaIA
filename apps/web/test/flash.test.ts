import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Flash } from "@/components/flash";

const html = (props: Parameters<typeof Flash>[0]) => renderToStaticMarkup(createElement(Flash, props));

describe("Flash", () => {
  it("shows known success keys", () => {
    expect(html({ ok: "invited" })).toContain("Invitación enviada.");
  });
  it("never shows arbitrary text from a crafted ?ok= link", () => {
    const out = html({ ok: "Tu cuenta está bloqueada, llama al 900 000 000" });
    expect(out).not.toContain("900");
    expect(out).toContain("Hecho.");
  });
  it("shows trusted page messages and escapes error text", () => {
    expect(html({ message: "Canal creado." })).toContain("Canal creado.");
    expect(html({ error: "<img src=x onerror=alert(1)>" })).not.toContain("<img");
  });
  it("renders nothing without a message", () => {
    expect(html({})).toBe("");
  });
});
