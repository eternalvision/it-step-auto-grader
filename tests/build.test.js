const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("build creates a loadable Chrome extension archive", () => {
  execFileSync(process.execPath, ["scripts/build-extension.js"], {
    cwd: root,
    stdio: "pipe",
  });

  const archive = path.join(root, "dist", "it-step-auto-grader-extension.zip");
  assert.equal(fs.existsSync(archive), true);

  const listing = execFileSync("unzip", ["-Z1", archive], {
    cwd: root,
    encoding: "utf8",
  }).trim().split("\n");

  assert.deepEqual(listing.sort(), ["index.js", "manifest.json"]);
});
