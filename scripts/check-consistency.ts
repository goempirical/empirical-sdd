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
};
assertRegistryIntegrity();
if (packageJson.version !== PRODUCT_VERSION) throw new Error("package and protocol versions differ");
if (SCHEMA_VERSION !== 5) throw new Error("product consistency requires Schema 5");
if (packageJson.engines?.node !== ">=22") throw new Error("package runtime must be Node >=22");
if (JSON.stringify(Object.keys(packageJson.exports ?? {}).sort()) !== JSON.stringify([".", "./integrations", "./mcp", "./protocol"])) {
  throw new Error("package exports must contain only the four supported entrypoints");
}
if (SKILLS.length !== 1 || EMPIRICAL_AGENT_SKILL_NAMES.length !== SKILLS.length) {
  throw new Error("skill registry and rendered integrations must contain exactly one entry");
}
if (JSON.stringify(EMPIRICAL_AGENT_SKILL_NAMES) !== JSON.stringify(SKILLS.map((skill) => skill.id))) {
  throw new Error("rendered skill order differs from the shared registry");
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

console.log(`Consistency gate: Empirical ${PRODUCT_VERSION}, Schema ${SCHEMA_VERSION}, ${SKILLS.length} skill${SKILLS.length === 1 ? "" : "s"}, ${OPERATIONS.length} operations.`);
