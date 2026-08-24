#!/usr/bin/env node
// Bump the release version in all three places at once:
//   - package.json               top-level "version"
//   - src-tauri/tauri.conf.json  top-level "version"
//   - src-tauri/Cargo.toml       [package] section's version
//
// Usage: node scripts/bump-version.mjs 0.1.1
//
// Refuses to run on a dirty working tree so a typo can't slip into a
// commit silently.

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const version = process.argv[2];
if (!version) {
  console.error("Usage: bump-version.mjs <version>");
  console.error("Example: bump-version.mjs 0.1.1");
  process.exit(1);
}

// Strict semver, major.minor.patch, optional -prerelease, optional +build.
// Rejects leading 'v' on purpose: the TAG has a 'v', the versions in
// source files don't.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (!SEMVER.test(version)) {
  console.error(`Not a valid semver: "${version}" (expected e.g. 0.1.1)`);
  process.exit(1);
}

// Fail on dirty tree, the commit message gets written referring to
// this version, a dirty tree means the commit will pick up unrelated
// changes too.
const dirty = execSync("git status --porcelain", {
  cwd: root,
  encoding: "utf8",
});
if (dirty.trim().length > 0) {
  console.error("Working tree is dirty. Commit or stash first.");
  console.error(dirty);
  process.exit(1);
}

// ─── package.json ────────────────────────────────────────────
const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const oldPkgVersion = pkg.version;
pkg.version = version;
// Preserve trailing newline if present.
const pkgRaw = readFileSync(pkgPath, "utf8");
const pkgTrail = pkgRaw.endsWith("\n") ? "\n" : "";
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + pkgTrail);

// ─── src-tauri/tauri.conf.json ───────────────────────────────
const tauriConfPath = join(root, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
const oldTauriVersion = tauriConf.version;
tauriConf.version = version;
const tauriRaw = readFileSync(tauriConfPath, "utf8");
const tauriTrail = tauriRaw.endsWith("\n") ? "\n" : "";
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + tauriTrail);

// ─── src-tauri/Cargo.toml ────────────────────────────────────
// Only touch the version line inside the [package] section. We walk
// the file line-by-line so dependency lines like
//   tauri = { version = "2" }
// never match.
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargoLines = readFileSync(cargoPath, "utf8").split("\n");
let inPackage = false;
let oldCargoVersion = null;
for (let i = 0; i < cargoLines.length; i++) {
  const line = cargoLines[i];
  const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
  if (sectionMatch) {
    inPackage = sectionMatch[1].trim() === "package";
    continue;
  }
  if (inPackage) {
    // Bare `version = "..."` at the start of the line (no indent and
    // no inline-table wrapping it, that would be a dependency).
    const m = line.match(/^version\s*=\s*"([^"]+)"\s*$/);
    if (m) {
      oldCargoVersion = m[1];
      cargoLines[i] = `version = "${version}"`;
      break;
    }
  }
}
if (oldCargoVersion == null) {
  console.error("Could not find [package] version in Cargo.toml, aborting.");
  process.exit(1);
}
writeFileSync(cargoPath, cargoLines.join("\n"));

// ─── Report ─────────────────────────────────────────────────
console.log(`Bumped to ${version}:`);
console.log(`  package.json                ${oldPkgVersion} → ${version}`);
console.log(`  src-tauri/tauri.conf.json   ${oldTauriVersion} → ${version}`);
console.log(`  src-tauri/Cargo.toml        ${oldCargoVersion} → ${version}`);
console.log("");
console.log("Next steps:");
console.log(
  `  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`,
);
console.log(`  git commit -m "Release v${version}"`);
console.log(`  git push`);
console.log(`  git tag v${version}`);
console.log(`  git push origin v${version}`);
