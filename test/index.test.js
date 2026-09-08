const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.children = [];
    this.disabled = false;
    this.type = attributes.type || "";
    this.tagName = attributes.tagName || "BUTTON";
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith("data-")) {
        this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      }
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  attachShadow() {
    this.shadowRoot = new FakeShadow();
    return this.shadowRoot;
  }
}

class FakeShadow extends FakeElement {
  constructor() {
    super();
    this.controls = {
      start: new FakeElement({ type: "button" }),
      stop: new FakeElement({ type: "button" }),
    };
  }

  querySelector(selector) {
    if (selector === "[data-start]") return this.controls.start;
    if (selector === "[data-stop]") return this.controls.stop;
    if (selector === "[data-status]") return new FakeElement();
    if (selector === "[data-pending]" || selector === "[data-grades]" || selector === "[data-history]") {
      return new FakeElement();
    }
    return new FakeElement();
  }

  querySelectorAll(selector) {
    const setting = selector.match(/data-setting="([^"]+)"/)?.[1];
    if (setting) {
      return [new FakeElement({ "data-setting": setting, tagName: setting === "autoComment" ? "TEXTAREA" : "INPUT" })];
    }
    const stat = selector.match(/data-stat="([^"]+)"/)?.[1];
    return stat ? [new FakeElement({ "data-stat": stat })] : [];
  }
}

function createWindow() {
  const body = new FakeElement();
  const localStorage = new Map([
    ["step-auto-grader:settings", JSON.stringify({ maxWaitTime: 50, nextFormPollInterval: 10 })],
  ]);
  const document = {
    body,
    documentElement: body,
    createElement: () => new FakeElement(),
    querySelectorAll: () => [],
  };
  const window = {
    localStorage: {
      getItem: (key) => localStorage.get(key) ?? null,
      setItem: (key, value) => localStorage.set(key, value),
    },
  };
  const context = {
    window,
    document,
    console: { log() {}, warn() {}, debug() {}, error() {}, table() {} },
    MutationObserver: class {
      observe() {}
    },
    HTMLTextAreaElement: class {},
    queueMicrotask,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Symbol,
    Object,
    Array,
    Promise,
    AbortController,
    Event: class {},
  };
  vm.runInNewContext(script, context);
  return { window, body };
}

test("start while running is idempotent", async () => {
  const { window } = createWindow();
  const first = window.processAllFormsSequentially();
  const second = window.processAllFormsSequentially();

  assert.strictEqual(second, first);
  window.stopAllFormsSequentially();
  await first;
});

test("stop cancels polling without waiting for the polling timeout", async () => {
  const { window } = createWindow();
  const run = window.processAllFormsSequentially();
  const startedAt = Date.now();

  const response = window.stopAllFormsSequentially();
  const summary = await run;

  assert.equal(response.ok, true);
  assert.equal(response.stopped, true);
  assert.equal(response.reason, "stop_requested");
  assert.equal(summary.stopped, true);
  assert.ok(Date.now() - startedAt < 100);
});

test("a new run can start after a stopped run settles", async () => {
  const { window } = createWindow();
  const stoppedRun = window.processAllFormsSequentially();
  window.stopAllFormsSequentially();
  await stoppedRun;

  const restartedRun = window.processAllFormsSequentially();
  assert.notStrictEqual(restartedRun, stoppedRun);
  const summary = await restartedRun;
  assert.equal(summary.stopped, false);
  assert.equal(summary.ok, true);
});

test("start and stop controls expose the correct disabled states", async () => {
  const { window, body } = createWindow();
  const panel = body.children[0].shadowRoot;
  const start = panel.querySelector("[data-start]");
  const stop = panel.querySelector("[data-stop]");

  await Promise.resolve();
  assert.equal(start.disabled, true);
  assert.equal(stop.disabled, false);
  window.stopAllFormsSequentially();
  await window.processAllFormsSequentially();
  assert.equal(start.disabled, false);
  assert.equal(stop.disabled, true);
});
