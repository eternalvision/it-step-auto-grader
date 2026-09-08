const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const userscriptPath = path.join(__dirname, "..", "tampermonkey", "step-auto-grader.user.js");
const source = fs.readFileSync(userscriptPath, "utf8");

test("userscript declares safe Tampermonkey metadata", () => {
  const metadata = source.match(/^\/\/ ==UserScript==\n([\s\S]*?)^\/\/ ==\/UserScript==/m);

  assert.ok(metadata, "metadata block is required");
  assert.match(metadata[1], /^\/\/ @name\s+IT Step Auto Grader$/m);
  assert.match(metadata[1], /^\/\/ @match\s+https:\/\/itstep\.org\/\*$/m);
  assert.match(metadata[1], /^\/\/ @match\s+https:\/\/\*\.itstep\.org\/\*$/m);
  assert.match(metadata[1], /^\/\/ @grant\s+none$/m);
  assert.doesNotMatch(metadata[1], /@require|https?:\/\/.*(?:cdn|unpkg|jsdelivr)/i);
});

test("initialization guard prevents a second run", () => {
  const bodyStart = source.indexOf("  /*", source.indexOf("const INIT_FLAG"));
  assert.notEqual(bodyStart, -1, "embedded runtime must follow the guard");

  const guardHarness = `${source.slice(0, bodyStart)}
  window.__bodyRuns = (window.__bodyRuns || 0) + 1;
})();`;
  const context = vm.createContext({
    console: { debug() {} },
    window: {},
    Symbol,
  });

  vm.runInContext(guardHarness, context);
  vm.runInContext(guardHarness, context);

  assert.equal(context.window.__bodyRuns, 1);
});
