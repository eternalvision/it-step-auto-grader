const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync("index.js", "utf8");

function createHarness({ dryRun, forms }) {
  const storage = new Map();
  const context = {
    console: { log() {}, debug() {}, warn() {}, error() {}, table() {} },
    Date,
    Math,
    Number,
    JSON,
    Set,
    WeakSet,
    Symbol,
    Array,
    Object,
    Promise,
    Event: class Event {
      constructor(type, options) {
        this.type = type;
        this.bubbles = options?.bubbles;
      }
    },
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    MutationObserver: class MutationObserver {},
    queueMicrotask,
    setTimeout,
    clearTimeout,
  };
  context.window = {
    __STEP_AUTO_GRADER_TEST__: true,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  context.document = {
    body: {},
    documentElement: {},
    querySelectorAll: () => forms,
    createElement: () => {
      throw new Error("panel must not be created in tests");
    },
  };

  const settings = JSON.stringify({
    minGrade: 9,
    maxGrade: 12,
    strategy: "preferred-high",
    dryRun,
  });
  storage.set("step-auto-grader:settings", settings);
  vm.runInNewContext(source, { ...context, window: context.window, document: context.document });
  return context.window.__STEP_AUTO_GRADER_TEST_API__;
}

function createForm(label, grade = "10", acceptButton = null) {
  let commentWrites = 0;
  const gradeButton = {
    disabled: false,
    clickCount: 0,
    getAttribute: () => null,
    click() {
      this.clickCount += 1;
    },
    querySelector: () => ({ textContent: grade }),
  };
  const textarea = {
    get value() {
      return "";
    },
    set value(value) {
      commentWrites += 1;
      this.lastValue = value;
    },
    dispatchEvent() {
      commentWrites += 1;
    },
  };
  const form = {
    isConnected: true,
    clickCount: () => gradeButton.clickCount,
    commentWrites: () => commentWrites,
    getAttribute: (name) => (name === "data-student" ? label : null),
    querySelectorAll: (selector) => {
      if (selector === "mat-button-toggle button") return [gradeButton];
      if (selector === "button") return acceptButton ? [acceptButton] : [];
      return [];
    },
    querySelector: (selector) =>
      selector === 'textarea[formcontrolname="coment"]' ? textarea : null,
  };
  return form;
}

test("dry-run previews each form without click or comment mutations", async () => {
  const forms = [createForm("Alice"), createForm("Bob")];
  const api = createHarness({ dryRun: true, forms });
  const summary = await api.processAllSequentially();
  const state = api.getState();

  assert.equal(summary.previews, 2);
  assert.equal(summary.success, 0);
  assert.equal(summary.failures, 0);
  assert.equal(summary.stopped, false);
  assert.equal(JSON.stringify(summary.gradeCounts), JSON.stringify({ 10: 2 }));
  assert.equal(
    JSON.stringify(state.history.map((entry) => [entry.label, entry.status])),
    JSON.stringify([["Bob", "preview"], ["Alice", "preview"]])
  );
  assert.ok(forms.every((form) => form.clickCount() === 0));
  assert.ok(forms.every((form) => form.commentWrites() === 0));
});

test("normal mode still clicks the grade and accept button", async () => {
  const forms = [];
  const acceptButton = {
    textContent: "Принять",
    disabled: false,
    getAttribute: () => null,
    clickCount: 0,
    click() {
      this.clickCount += 1;
    },
  };
  const form = createForm("Alice", "10", acceptButton);
  forms.push(form);
  acceptButton.click = () => {
    acceptButton.clickCount += 1;
    form.isConnected = false;
    forms.splice(forms.indexOf(form), 1);
  };

  const api = createHarness({ dryRun: false, forms });
  const summary = await api.processAllSequentially();

  assert.equal(summary.success, 1);
  assert.equal(summary.previews, 0);
  assert.equal(acceptButton.clickCount, 1);
});
