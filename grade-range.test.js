const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync("index.js", "utf8");
const bootStart = source.indexOf("  window.processAllFormsSequentially =");
const testableSource = `${source.slice(0, bootStart)}
  window.stepAutoGraderTestables = { normalizeGradeRange, selectGradeFromRange };
})();`;

function loadTestables() {
  const context = {
    console,
    window: {
      localStorage: {
        getItem: () => null,
      },
    },
  };
  vm.runInNewContext(testableSource, context);
  return context.window.stepAutoGraderTestables;
}

test("normalizes reversed min/max ranges", () => {
  const { normalizeGradeRange } = loadTestables();
  const range = normalizeGradeRange(12, 9);

  assert.equal(range.minGrade, 9);
  assert.equal(range.maxGrade, 12);
});

test("uses safe defaults for invalid range values", () => {
  const { normalizeGradeRange } = loadTestables();
  const defaults = normalizeGradeRange("nope", null);

  assert.equal(defaults.minGrade, 9);
  assert.equal(defaults.maxGrade, 12);
  const bounded = normalizeGradeRange(-10, 200);
  assert.equal(bounded.minGrade, 0);
  assert.equal(bounded.maxGrade, 100);
});

test("includes both range boundaries when selecting preferred grades", () => {
  const { selectGradeFromRange } = loadTestables();
  const settings = { minGrade: 9, maxGrade: 10, strategy: "preferred-low" };

  assert.equal(selectGradeFromRange([8, 9, 10, 11], settings), 9);
  assert.equal(
    selectGradeFromRange([8, 9, 10, 11], { ...settings, strategy: "preferred-high" }),
    10
  );
});

test("falls back to all available grades when the preferred range is empty", () => {
  const { selectGradeFromRange } = loadTestables();
  const grades = [3, 5, 7];

  assert.equal(
    selectGradeFromRange(grades, { minGrade: 9, maxGrade: 12, strategy: "preferred-low" }),
    3
  );
  assert.equal(
    selectGradeFromRange(grades, { minGrade: 9, maxGrade: 12, strategy: "preferred-high" }),
    7
  );
});

test("returns null when no grades are available", () => {
  const { selectGradeFromRange } = loadTestables();

  assert.equal(selectGradeFromRange([], { minGrade: 9, maxGrade: 12 }), null);
});
