// Edit the newest release in releases.json, then run --write. No tags/publishing.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = resolve(process.argv[3] || fileURLToPath(new URL("..", import.meta.url)));
const read = path => readFileSync(resolve(root, path), "utf8");
const releases = JSON.parse(read("client/src/data/releases.json")).releases;
const version = releases[0]?.version;
const parts = value => { assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/); const nums = value.split(".").map(Number); assert.ok(nums.every(Number.isSafeInteger)); return nums; };
const compare = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]); return 0; };
assert.ok(releases.length);
for (const [i, release] of releases.entries()) {
  parts(release.version);
  if (i) assert.ok(compare(releases[i - 1].version, release.version) > 0, "Releases must be unique and newest first");
  assert.ok(release.title?.trim() && release.summary?.trim() && release.highlights?.length && release.highlights.every(item => typeof item === "string" && item.trim()) && release.sections?.length);
  assert.ok(release.date === null || (/^\d{4}-\d{2}-\d{2}$/.test(release.date) && new Date(release.date).toISOString().slice(0, 10) === release.date));
  for (const section of release.sections) assert.ok(section.title?.trim() && section.items.length && section.items.every(item => typeof item === "string" && item.trim()));
}
const desired = new Map();
for (const path of ["client/package.json", "client/package-lock.json"]) {
  const content = JSON.parse(read(path)); content.version = version;
  if (content.packages?.[""]) content.packages[""].version = version;
  desired.set(path, JSON.stringify(content, null, 2) + "\n");
}
desired.set("Cargo.toml", read("Cargo.toml").replace(/(\[package\][\s\S]*?\nversion = ")[^"]+/, `$1${version}`));
desired.set("Cargo.lock", read("Cargo.lock").replace(/(name = "hanafudakan-server"\nversion = ")[^"]+/, `$1${version}`));
assert.ok(["--check", "--write"].includes(process.argv[2]), "Use --check or --write");
for (const [path, content] of desired) {
  if (process.argv[2] === "--write") writeFileSync(resolve(root, path), content);
  else assert.equal(read(path), content, `${path} differs from releases.json; run node scripts/release-version.mjs --write`);
}
console.log(`Release catalog and manifests: v${version} OK`);
