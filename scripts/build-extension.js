const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const extensionDir = path.join(dist, "it-step-auto-grader-extension");
const archive = path.join(dist, "it-step-auto-grader-extension.zip");
const files = ["manifest.json", "index.js"];

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || !Array.isArray(manifest.content_scripts)) {
  throw new Error("manifest.json is not a valid Manifest V3 content-script manifest");
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(extensionDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(extensionDir, file));
}

execFileSync("zip", ["-q", "-r", archive, "."], {
  cwd: extensionDir,
  stdio: "inherit",
});

console.log(`Built ${path.relative(root, archive)}`);
