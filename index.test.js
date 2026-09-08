const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadHelpers() {
  const elements = new Map();
  const shadowRoot = {
    innerHTML: "",
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, {
          dataset: {},
          style: {},
          addEventListener() {},
          querySelectorAll() { return []; },
          appendChild() {},
        });
      }
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
  };
  const document = {
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement() {
      return {
        style: {},
        attachShadow() { return shadowRoot; },
        setAttribute() {},
      };
    },
    querySelectorAll() { return []; },
  };
  const window = {
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
  };
  const context = {
    window,
    document,
    MutationObserver: class {
      observe() {}
    },
    HTMLTextAreaElement: class {},
    Event: class {},
    queueMicrotask(callback) { callback(); },
    setTimeout(callback) { callback(); },
    clearTimeout() {},
    console: { log() {}, warn() {}, debug() {}, error() {}, table() {} },
    Date,
    Math,
    Number,
    Object,
    Array,
    Set,
    Promise,
    Symbol,
  };
  const source = fs.readFileSync("index.js", "utf8")
    .replace(/\n  void processAllSequentially\(\);\n\}\)\(\);\s*$/, "\n})();");
  vm.runInNewContext(source, context);
  return window.stepAutoGraderHelpers;
}

const helpers = loadHelpers();

test("preferred-low chooses the lowest grade in the preferred pool", () => {
  assert.equal(
    helpers.selectGrade([12, 8, 10, 10], { minGrade: 9, maxGrade: 12, strategy: "preferred-low" }),
    10
  );
});

test("preferred-high chooses the highest grade in the preferred pool", () => {
  assert.equal(
    helpers.selectGrade([8, 9, 11, 12], { minGrade: 9, maxGrade: 11, strategy: "preferred-high" }),
    11
  );
});

test("random chooses from the normalized fallback pool", () => {
  assert.equal(
    helpers.selectGrade(["bad", 2, 8, 12], { minGrade: 9, maxGrade: 11, strategy: "random" }, () => 0.99),
    12
  );
});

test("random clamps invalid random values and handles empty input", () => {
  assert.equal(
    helpers.selectGrade([3, 5], { strategy: "random" }, () => Number.NaN),
    3
  );
  assert.equal(helpers.selectGrade([], {}, () => 0), null);
});

test("settings normalize reversed and out-of-range grade bounds", () => {
  const settings = helpers.normalizeSettings({ minGrade: 120, maxGrade: -4 });
  assert.equal(settings.minGrade, 0);
  assert.equal(settings.maxGrade, 100);
});

test("counters track success, preview, skipped, failure, grades, and reasons", () => {
  let stats = helpers.createStats();
  stats = helpers.updateStats(stats, { ok: true, grade: 10 });
  stats = helpers.updateStats(stats, { ok: true, preview: true, grade: 11 });
  stats = helpers.updateStats(stats, { ok: true, skipped: true });
  stats = helpers.updateStats(stats, { ok: false, reason: "grade_unavailable" });
  stats = helpers.updateStats(stats, { ok: false, reason: "grade_unavailable", grade: 9 });

  assert.deepEqual(
    JSON.parse(JSON.stringify({
      total: stats.total,
      success: stats.success,
      previews: stats.previews,
      skipped: stats.skipped,
      failures: stats.failures,
      gradeCounts: stats.gradeCounts,
      errors: stats.errors,
    })),
    {
      total: 5,
      success: 1,
      previews: 1,
      skipped: 1,
      failures: 2,
      gradeCounts: { 9: 1, 10: 1, 11: 1 },
      errors: { grade_unavailable: 2 },
    }
  );
});
