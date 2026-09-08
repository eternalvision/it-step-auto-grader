const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const source = fs.readFileSync(path.join(root, "index.js"), "utf8");

test("manifest is a Chrome MV3 content-script extension", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts.length, 1);

  const [contentScript] = manifest.content_scripts;
  assert.deepEqual(contentScript.js, ["index.js"]);
  assert.equal(contentScript.run_at, "document_idle");
  assert.ok(contentScript.matches.some((pattern) => pattern.includes("itstep.org")));
});

test("extension wiring stays self-contained and exposes panel controls", () => {
  const contentScriptFiles = manifest.content_scripts.flatMap((entry) => entry.js);
  for (const file of contentScriptFiles) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
  }

  assert.doesNotMatch(source, /https?:\/\/|<script[^>]+src=/i);
  assert.match(source, /step-auto-grader-panel/);
  assert.match(source, /window\.processAllFormsSequentially/);
  assert.match(source, /window\.stopAllFormsSequentially/);
});
