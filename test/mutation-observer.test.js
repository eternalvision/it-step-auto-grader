const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync("index.js", "utf8");
const start = source.indexOf("  const waitUntil =");
const end = source.indexOf("  const hasGradeButtons =", start);
const waitUntilSource = source.slice(start, end);

function createHarness() {
  const observers = [];
  const context = {
    STOPPED: Symbol("stopped"),
    document: { body: {} },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }

      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
    state: { stopRequested: false, waiters: new Set() },
    console: { debug() {} },
    setTimeout,
    clearTimeout,
    Promise,
    Number,
    Math,
  };
  vm.createContext(context);
  vm.runInContext(`const isStopped = () => state.stopRequested;\n${waitUntilSource}; this.waitUntil = waitUntil;`, context);
  return {
    waitUntil: context.waitUntil,
    observers,
    state: context.state,
  };
}

test("resolves when a new form mutation makes the predicate true", async () => {
  const harness = createHarness();
  let form = null;
  const resultPromise = harness.waitUntil(() => form, 1000, 100);

  form = { id: "new-form" };
  harness.observers[0].callback([{ type: "childList", target: {} }]);

  assert.deepEqual(await resultPromise, { id: "new-form" });
  assert.equal(harness.observers[0].disconnected, true);
});

test("rechecks disabled and selected state changes through attribute mutations", async () => {
  const harness = createHarness();
  let ready = false;
  let selected = false;
  const resultPromise = harness.waitUntil(
    () => ready && !selected && "ready",
    1000,
    100,
    {}
  );

  ready = true;
  harness.observers[0].callback([{ type: "attributes", attributeName: "disabled", target: {} }]);
  assert.equal(await resultPromise, "ready");

  const selectedHarness = createHarness();
  let selectedInSecondForm = true;
  const selectedResult = selectedHarness.waitUntil(
    () => !selectedInSecondForm && "unselected",
    20,
    100,
    {}
  );
  selectedInSecondForm = false;
  selectedHarness.observers[0].callback([
    { type: "attributes", attributeName: "aria-checked", target: {} },
  ]);
  assert.equal(await selectedResult, "unselected");
});

test("disconnects the observer on timeout and removes its stop waiter", async () => {
  const harness = createHarness();
  const result = await harness.waitUntil(() => null, 5, 100);

  assert.equal(result, null);
  assert.equal(harness.observers[0].disconnected, true);
  assert.equal(harness.state.waiters.size, 0);
});
