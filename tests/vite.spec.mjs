import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Vite build configuration", () => {
  it("keeps the extension entrypoint and config available", () => {
    expect(fs.existsSync(path.resolve("index.js"))).toBe(true);
    expect(fs.existsSync(path.resolve("vite.config.mjs"))).toBe(true);
  });
});
