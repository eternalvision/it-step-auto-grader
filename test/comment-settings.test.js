const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness(storedSettings = null) {
  const storage = new Map(storedSettings ? [["step-auto-grader:settings", storedSettings]] : []);
  const window = {
    __STEP_AUTO_GRADER_TEST__: true,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    console,
    Event,
  };
  window.HTMLTextAreaElement = class HTMLTextAreaElement {};
  window.HTMLTextAreaElement.prototype.value = "";
  const context = vm.createContext({ window, console, Event });
  vm.runInContext(fs.readFileSync("index.js", "utf8"), context);
  return { api: window.__stepAutoGraderTestApi, storage };
}

test("normalizes persisted comment settings and saves the empty value", () => {
  const { api, storage } = createHarness(JSON.stringify({
    autoComment: "",
    minGrade: 12,
    maxGrade: 4,
    strategy: "invalid",
  }));

  assert.equal(api.state.settings.autoComment, "");
  assert.equal(api.state.settings.minGrade, 4);
  assert.equal(api.state.settings.maxGrade, 12);
  assert.equal(api.state.settings.strategy, "random");

  api.state.settings = api.normalizeSettings({ autoComment: "" });
  api.saveSettings();
  assert.equal(JSON.parse(storage.get("step-auto-grader:settings")).autoComment, "");
});

test("fills textarea with native setter and Angular events", () => {
  const { api } = createHarness();
  const events = [];
  const textarea = Object.create(windowLikeTextareaPrototype());
  textarea.ownerDocument = { defaultView: { HTMLTextAreaElement: textarea.constructor, Event } };
  textarea.dispatchEvent = (event) => events.push([event.type, event.bubbles]);
  textarea.formValue = "";
  const form = { querySelector: (selector) => selector.includes("textarea") ? textarea : null };

  assert.equal(api.fillAutoComment(form, { autoComment: "Спасибо!" }), true);
  assert.equal(textarea.formValue, "Спасибо!");
  assert.deepEqual(events, [["input", true], ["change", true], ["blur", true]]);
});

test("does not fill textarea for an explicitly empty comment", () => {
  const { api } = createHarness();
  let called = false;
  const textarea = {
    ownerDocument: { defaultView: { HTMLTextAreaElement: class {}, Event } },
    dispatchEvent: () => { called = true; },
  };
  const form = { querySelector: () => textarea };

  assert.notEqual(api.fillAutoComment(form, { autoComment: "" }), true);
  assert.equal(called, false);
});

function windowLikeTextareaPrototype() {
  const textarea = function Textarea() {};
  Object.defineProperty(textarea.prototype, "value", {
    set(value) {
      this.formValue = value;
    },
  });
  return textarea.prototype;
}
