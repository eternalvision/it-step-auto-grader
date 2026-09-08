const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorageAdapter } = require("../index.js");

const defaults = Object.freeze({ minGrade: 9, dryRun: false });
const normalize = (value) => ({
  minGrade: Number.isFinite(Number(value?.minGrade)) ? Number(value.minGrade) : defaults.minGrade,
  dryRun: value?.dryRun === true,
});

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem() {
      return value;
    },
    setItem(_key, nextValue) {
      value = nextValue;
    },
  };
}

function createAdapter(storage = memoryStorage()) {
  return createStorageAdapter({
    storage,
    key: "settings",
    version: 1,
    defaults,
    normalize,
  });
}

test("round-trips versioned settings", () => {
  const storage = memoryStorage();
  const adapter = createAdapter(storage);

  assert.equal(adapter.write({ minGrade: 11, dryRun: true }), true);
  assert.deepEqual(adapter.read(), { minGrade: 11, dryRun: true });
  assert.deepEqual(JSON.parse(storage.getItem("settings")), {
    version: 1,
    data: { minGrade: 11, dryRun: true },
  });
});

test("uses defaults for invalid values and schema versions", () => {
  const storage = memoryStorage(JSON.stringify({ version: 99, data: { minGrade: 1 } }));
  const adapter = createAdapter(storage);
  assert.deepEqual(adapter.read(), defaults);

  storage.setItem("settings", JSON.stringify({ version: 1, data: { minGrade: "bad" } }));
  assert.deepEqual(adapter.read(), defaults);
});

test("falls back when JSON or storage operations throw", () => {
  const brokenJson = memoryStorage("{");
  assert.deepEqual(createAdapter(brokenJson).read(), defaults);

  const throwingStorage = {
    getItem() {
      throw new Error("quota or security error");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  const adapter = createAdapter(throwingStorage);
  assert.deepEqual(adapter.read(), defaults);
  assert.equal(adapter.write({ minGrade: 10 }), false);
});

test("returns safe defaults for missing storage", () => {
  const adapter = createAdapter(null);
  assert.deepEqual(adapter.read(), defaults);
  assert.equal(adapter.write({ minGrade: 10 }), false);
});

test("normalizes storage events for UI synchronization", () => {
  const adapter = createAdapter();
  assert.deepEqual(
    adapter.handleStorageEvent({
      key: "settings",
      newValue: JSON.stringify({ version: 1, data: { minGrade: 12, dryRun: true } }),
    }),
    { minGrade: 12, dryRun: true }
  );
  assert.deepEqual(adapter.handleStorageEvent({ key: "other", newValue: null }), null);
  assert.deepEqual(adapter.handleStorageEvent({ key: "settings", newValue: null }), defaults);
});
