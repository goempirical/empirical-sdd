import { describe, expect, test } from "bun:test";
import {
  BRAND_BLUE,
  BRAND_RED,
  BRAND_YELLOW,
  renderBrandBanner,
  renderBrandBannerForOutput,
} from "../src/branding.js";

const ansi = /\u001b\[[0-9;]*m/g;

const widePlain = [
  "       ╭────╮",
  "       │    │",
  "   ╭───╯    ╰───╮    empirical",
  "   │            │    v0.20.4",
  "   ╰───╮    ╭───╯",
  "       │    │",
  "       ╰────╯",
].join("\n");

const compactPlain = [
  "       ╭────╮",
  "       │    │",
  "   ╭───╯    ╰───╮",
  "   │            │",
  "   ╰───╮    ╭───╯",
  "       │    │",
  "       ╰────╯",
  "",
  "empirical v0.20.4",
].join("\n");

describe("GoEmpirical CLI branding", () => {
  test("renders deterministic wide and compact plain layouts", () => {
    expect(renderBrandBanner({ version: "0.20.4", columns: 80, color: false }))
      .toBe(widePlain);
    expect(renderBrandBanner({ version: "0.20.4", columns: 24, color: false }))
      .toBe(compactPlain);
    expect(renderBrandBanner({ version: "0.20.4", columns: 12, color: false }))
      .toBe("  ○\n○   ○\nempirical\nv0.20.4");
  });

  test("uses only the official mark colors without changing plain geometry", () => {
    const colored = renderBrandBanner({ version: "0.20.4", columns: 80, color: true });
    expect(BRAND_RED).toBe("#F43737");
    expect(BRAND_YELLOW).toBe("#FFCD15");
    expect(BRAND_BLUE).toBe("#4A5CFF");
    expect(colored).toContain("\u001b[38;2;244;55;55m");
    expect(colored).toContain("\u001b[38;2;255;205;21m");
    expect(colored).toContain("\u001b[38;2;74;92;255m");
    expect(colored.replace(ansi, "")).toBe(widePlain);
  });

  test("enables color only for a capable terminal and honors plain-output controls", () => {
    const tty = { isTTY: true, columns: 80 };
    expect(renderBrandBannerForOutput("0.20.4", tty, {})).toContain("\u001b[");
    expect(renderBrandBannerForOutput("0.20.4", { isTTY: true, columns: 0 }, {}))
      .toContain("empirical");
    expect(renderBrandBannerForOutput("0.20.4", tty, { NO_COLOR: "" })).not.toContain("\u001b[");
    expect(renderBrandBannerForOutput("0.20.4", tty, { TERM: "dumb" })).not.toContain("\u001b[");

    const redirected = renderBrandBannerForOutput("0.20.4", { isTTY: false, columns: 120 }, {});
    expect(redirected).toBe(compactPlain);
    expect(redirected).not.toContain("\u001b[");
  });

  test("keeps every plain logical line within each supported layout width", () => {
    for (const columns of [12, 20, 24, 39, 40, 80]) {
      const banner = renderBrandBanner({ version: "0.20.4", columns, color: false });
      expect(banner.split("\n").every((line) => [...line].length <= columns)).toBe(true);
    }
  });
});
