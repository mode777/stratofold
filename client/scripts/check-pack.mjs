// Verifies the npm tarball shape and dependency metadata before a release.
//
// `npm pack --dry-run --json` reports exactly what would be published.
// Only the built package, README, and manifest may appear, and the
// package must keep its zero-runtime-dependency promise.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
});
const [pack] = JSON.parse(output);

if (!pack || !Array.isArray(pack.files)) {
  throw new Error("npm pack --dry-run --json did not report a file list");
}
if (pack.name !== manifest.name || pack.version !== manifest.version) {
  throw new Error(
    `packed ${pack.name}@${pack.version}, expected ${manifest.name}@${manifest.version}`,
  );
}

const allowed = (path) =>
  path === "README.md" || path === "package.json" || path.startsWith("dist/");
const unexpected = pack.files.filter((file) => !allowed(file.path));
if (unexpected.length > 0) {
  console.error("unexpected files in the publish tarball:");
  for (const file of unexpected) console.error(`  ${file.path}`);
  process.exit(1);
}

const paths = new Set(pack.files.map((file) => file.path));
const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/stratofold.min.js",
  "README.md",
  "package.json",
];
const missing = required.filter((path) => !paths.has(path));
if (missing.length > 0) {
  console.error(`missing from the publish tarball: ${missing.join(", ")}`);
  process.exit(1);
}

const hasEntries = (value) => {
  if (value === true) return true;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && value !== null && Object.keys(value).length > 0;
};
const runtimeSections = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
];
const declared = runtimeSections.filter((section) => hasEntries(manifest[section]));
if (declared.length > 0) {
  console.error(`runtime dependency sections must be empty: ${declared.join(", ")}`);
  process.exit(1);
}

console.log(
  `checked ${pack.files.length} tarball entries for ${pack.name}@${pack.version}`,
);
