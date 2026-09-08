const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadHistoryApi() {
  const source = fs.readFileSync("index.js", "utf8");
  const marker = "  window.stepAutoGraderHistory =";
  const prefix = source.slice(0, source.indexOf(marker));
  const context = {
    console: { warn() {}, log() {}, debug() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    Date,
    Math,
    Number,
    JSON,
    Object,
    Set,
    String,
    Symbol,
    window: null,
  };
  context.window = context;
  vm.runInNewContext(
    `${prefix} globalThis.api = { normalize: normalizeHistoryPayload, serialize: serializeHistory }; })();`,
    context
  );
  return context.api;
}

test("history round-trips through the versioned payload", () => {
  const api = loadHistoryApi();
  const entries = [{
    id: "entry-1",
    time: "2026-09-08T20:00:00.000Z",
    studentId: "student-7",
    formId: "form-7",
    label: "Ada",
    grade: 11,
    status: "success",
    reason: null,
  }];

  const restored = api.normalize(JSON.parse(api.serialize(entries)));
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), entries);
});

test("history keeps only the newest twenty valid entries", () => {
  const api = loadHistoryApi();
  const entries = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    time: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    label: `student-${index}`,
    status: "success",
  }));

  const normalized = api.normalize(entries);
  assert.equal(normalized.length, 20);
  assert.equal(normalized[0].id, "0");
  assert.equal(normalized.at(-1).id, "19");
});

test("corrupted payloads are discarded without throwing", () => {
  const api = loadHistoryApi();
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalize({ version: 99, entries: [{}] }))), []);
  const normalized = api.normalize([
    null,
    { time: "not-a-date", status: "success" },
    { time: "2026-09-08T00:00:00.000Z", status: "unknown" },
    { time: "2026-09-08T00:00:00.000Z", status: "error", label: 42 },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].label, "форма");
});

test("history labels are rendered as text instead of HTML", () => {
  const source = fs.readFileSync("index.js", "utf8");
  assert.match(source, /label\.textContent = entry\.label/);
  assert.match(source, /tag\.textContent = `\$\{entry\.status\}/);
  assert.doesNotMatch(source, /escapeHtml/);
});
