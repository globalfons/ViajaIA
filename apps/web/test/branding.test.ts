import { describe, expect, it } from "vitest";
import { hexToHslTriplet, parseBranding, resolveBrand } from "@/lib/branding";
import { safeNextPath } from "@/lib/safe-redirect";

describe("branding", () => {
  it("converts hex to HSL triplets", () => {
    expect(hexToHslTriplet("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslTriplet("#ffffff")).toBe("0 0% 100%");
  });

  it("rejects values that could inject CSS", () => {
    expect(hexToHslTriplet("red; background:url(x)")).toBeNull();
    expect(parseBranding({ colors: { primary: "#fff;}body{display:none" } })).toEqual({});
  });

  it("rejects non-https logos (javascript:, data:, http:)", () => {
    expect(parseBranding({ logo_url: "javascript:alert(1)" })).toEqual({});
    expect(parseBranding({ logo_url: "http://x.test/logo.png" })).toEqual({});
    expect(parseBranding({ logo_url: "https://cdn.test/logo.png" }).logo_url).toBe("https://cdn.test/logo.png");
  });

  it("only applies tenant branding when white-label is enabled", () => {
    const branding = { name: "Clínica Sol", colors: { primary: "#00aa00" } };
    expect(resolveBrand({ branding, white_label_enabled: false }).name).toBe("DigitalizaTusNegocios");
    const on = resolveBrand({ branding, white_label_enabled: true });
    expect(on.name).toBe("Clínica Sol");
    expect(on.cssVars["--brand-primary"]).toBe("120 100% 33%");
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/agents", "/agents"],
    ["//evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    ["https://evil.com", "/dashboard"],
    [undefined, "/dashboard"],
    ["/x\r\nSet-Cookie: a", "/dashboard"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
