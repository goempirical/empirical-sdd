import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { EMPIRICAL_AGENT_SKILL_NAMES } from "../src/integrations.js";
import { OPERATIONS, SKILLS, assertRegistryIntegrity } from "../src/operations.js";
import { PRODUCT_VERSION, SCHEMA_VERSION } from "../src/protocol.js";

const root = resolve(import.meta.dir, "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
  version: string;
  engines?: { node?: string };
  exports?: Record<string, unknown>;
  files?: string[];
  scripts?: Record<string, string>;
  repository?: { url?: string };
};
assertRegistryIntegrity();
if (packageJson.version !== PRODUCT_VERSION) throw new Error("package and protocol versions differ");
if (SCHEMA_VERSION !== 5) throw new Error("product consistency requires Schema 5");
if (packageJson.engines?.node !== ">=22") throw new Error("package runtime must be Node >=22");
if (packageJson.repository?.url !== "git+https://github.com/goempirical/empirical-sdd.git") {
  throw new Error("package repository must match the canonical GitHub repository used by npm OIDC");
}
if (JSON.stringify(Object.keys(packageJson.exports ?? {}).sort()) !== JSON.stringify([".", "./integrations", "./mcp", "./protocol"])) {
  throw new Error("package exports must contain only the four supported entrypoints");
}
if (SKILLS.length !== 1 || EMPIRICAL_AGENT_SKILL_NAMES.length !== SKILLS.length) {
  throw new Error("skill registry and rendered integrations must contain exactly one entry");
}
if (JSON.stringify(EMPIRICAL_AGENT_SKILL_NAMES) !== JSON.stringify(SKILLS.map((skill) => skill.id))) {
  throw new Error("rendered skill order differs from the shared registry");
}
if (EMPIRICAL_AGENT_SKILL_NAMES[0] !== "empirical-init") {
  throw new Error("the sole global workflow skill must be empirical-init");
}
for (const required of ["CHANGELOG.md", "docs/versioning.md"]) {
  if (!packageJson.files?.includes(required)) throw new Error(`package files omit ${required}`);
}
if (!packageJson.scripts?.ci?.includes("git diff --check")) {
  throw new Error("the complete CI command must enforce git diff --check");
}
if (new Set(OPERATIONS.map((operation) => operation.mcpName)).size !== OPERATIONS.length) {
  throw new Error("MCP operation names are not unique");
}

const documentationPaths = [
  "README.md",
  "docs/architecture.md",
  "docs/demo.md",
  "docs/mcp.md",
  "docs/migration-v1.md",
  "docs/openspec-comparison.md",
  "docs/protocol.md",
  "docs/security.md",
  "docs/versioning.md",
  "CHANGELOG.md",
];
const documentation = (
  await Promise.all(documentationPaths.map((path) => readFile(resolve(root, path), "utf8")))
).join("\n");
for (const skill of SKILLS) {
  if (!documentation.includes(skill.id)) {
    throw new Error(`documentation does not name registry skill ${skill.id}`);
  }
}
if (!documentation.includes("empirical uninstall")) {
  throw new Error("documentation omits the public uninstall lifecycle");
}
if (/(?:\$|\/|@)empirical(?:`|\s)/.test(documentation)) {
  throw new Error("documentation still presents the old global empirical invocation");
}
const changelog = await readFile(resolve(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes("## [Unreleased]") || !changelog.includes(`## [${PRODUCT_VERSION}] - `)) {
  throw new Error("changelog omits Unreleased or the prepared product version");
}
if (!changelog.includes(`[Unreleased]: https://github.com/goempirical/empirical-sdd/compare/v${PRODUCT_VERSION}...HEAD`)) {
  throw new Error("changelog Unreleased compare link does not start at the product version");
}
const versioning = await readFile(resolve(root, "docs/versioning.md"), "utf8");
for (const required of ["Semantic Versioning 2.0.0", "Keep a Changelog 1.1.0", "PRODUCT_VERSION", "Publication boundary"]) {
  if (!versioning.includes(required)) throw new Error(`versioning policy omits ${required}`);
}
for (const stale of [
  /\b(?:five|5)\s+(?:managed\s+|native\s+|agent-native\s+)?skills?\b/i,
  /\bNode(?:\.js)?\s*(?:>=?|≥)?\s*20(?:\b|\+)/i,
  /caller[- ](?:supplied|asserted)\s+(?:passing\s+)?boolean\s+evidence/i,
]) {
  if (stale.test(documentation)) throw new Error(`documentation contains stale claim ${stale}`);
}
for (const level of ["implemented", "verified", "integrated", "delivered", "published"] as const) {
  if (!documentation.includes(level)) throw new Error(`documentation omits completion level ${level}`);
}
const ci = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
if (!/node:\s*\[22,\s*24,\s*26\]/.test(ci)) {
  throw new Error("CI must test the exact Node 22/24/26 matrix");
}
for (const gate of ["test:coverage", "test:dist", "test:package", "test:consistency"]) {
  if (!ci.includes(`bun run ${gate}`)) throw new Error(`CI omits ${gate}`);
}

const publish = await readFile(resolve(root, ".github/workflows/publish.yml"), "utf8");
for (const required of [
  "release:",
  "types: [published]",
  "github.repository == 'goempirical/empirical-sdd'",
  "github.event.release.prerelease == false",
  "environment: npm",
  "id-token: write",
  "persist-credentials: false",
  "git merge-base --is-ancestor HEAD origin/main",
  "bun run ci",
  "npm publish --access public --tag latest",
]) {
  if (!publish.includes(required)) throw new Error(`npm publish workflow omits ${required}`);
}
if (/NPM_(?:TOKEN|AUTH_TOKEN)|NODE_AUTH_TOKEN/.test(publish)) {
  throw new Error("npm publish workflow must use trusted publishing instead of a long-lived token");
}

console.log(`Consistency gate: Empirical ${PRODUCT_VERSION}, Schema ${SCHEMA_VERSION}, ${SKILLS.length} skill${SKILLS.length === 1 ? "" : "s"}, ${OPERATIONS.length} operations.`);
