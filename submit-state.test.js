const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function loadInternals() {
  const source = fs.readFileSync("index.js", "utf8");
  const messages = [];
  const document = {
    body: {},
    documentElement: {},
    querySelectorAll: () => messages,
  };
  const window = {
    __STEP_AUTO_GRADER_TEST__: true,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  };
  vm.runInNewContext(source, {
    window,
    document,
    console: { log() {}, warn() {}, error() {}, debug() {} },
    queueMicrotask,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    Object,
    Array,
    Boolean,
    String,
    JSON,
    Symbol,
    RegExp,
    Promise,
    MutationObserver: class {},
  });
  return { internals: window.__stepAutoGraderInternals, messages };
}

function form({ connected = true, success = false } = {}) {
  return {
    isConnected: connected,
    className: success ? "submitted" : "",
    matches: (selector) => success && selector.includes(".submitted"),
    querySelector: () => null,
  };
}

function button() {
  return {
    disabled: false,
    getAttribute: () => null,
  };
}

const settings = { maxSubmit: 20, maxWaitSubmit: 20, pollInterval: 1 };

test("confirms success when the submitted form disappears", async () => {
  const { internals, messages } = loadInternals();
  const currentForm = form({ connected: false });
  const result = await internals.waitSubmitFinished(currentForm, button(), settings);

  assert.equal(result, true);
  assert.equal(messages.length, 0);
});

test("confirms success from an Angular live-region message", async () => {
  const { internals, messages } = loadInternals();
  messages.push({ textContent: "Работа успешно сохранена", getAttribute: () => "polite" });

  const result = await internals.waitSubmitFinished(form(), button(), settings);

  assert.equal(result, true);
});

test("rejects submit when Angular exposes an error message", async () => {
  const { internals, messages } = loadInternals();
  messages.push({ textContent: "Не удалось сохранить работу", getAttribute: () => "assertive" });

  const result = await internals.waitSubmitFinished(form(), button(), settings);

  assert.equal(result, false);
});

test("times out when only disabled/loading state changes", async () => {
  const { internals } = loadInternals();
  let loading = false;
  const acceptButton = {
    disabled: false,
    getAttribute: (name) => name === "aria-busy" && loading ? "true" : null,
  };
  const currentForm = form();
  const before = internals.captureSubmitSnapshot(currentForm, acceptButton);
  loading = true;

  const startedAt = Date.now();
  const result = await internals.waitSubmitFinished(currentForm, acceptButton, settings, before);

  assert.equal(result, false);
  assert.ok(Date.now() - startedAt >= settings.maxWaitSubmit - 2);
});
