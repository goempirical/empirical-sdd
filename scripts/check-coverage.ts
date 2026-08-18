import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const path = resolve(process.argv[2] ?? "coverage/lcov.info");
const root = resolve(import.meta.dir, "..");
const source = await readFile(path, "utf8");

interface Coverage {
  lines: Map<number, number>;
  functionsFound: number;
  functionsHit: number;
}

const files = new Map<string, Coverage>();
let active: Coverage | null = null;
for (const line of source.split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    const absolute = resolve(line.slice(3));
    const label = relative(root, absolute).replaceAll("\\", "/");
    active = label.startsWith("src/") && label.endsWith(".ts")
      ? { lines: new Map(), functionsFound: 0, functionsHit: 0 }
      : null;
    if (active) files.set(label, active);
  } else if (active && line.startsWith("DA:")) {
    const [lineNumber, hits] = line.slice(3).split(",");
    if (lineNumber && hits) active.lines.set(Number(lineNumber), Number(hits));
  } else if (active && line.startsWith("FNF:")) {
    active.functionsFound = Number(line.slice(4));
  } else if (active && line.startsWith("FNH:")) {
    active.functionsHit = Number(line.slice(4));
  }
}

function percentage(covered: number, total: number): number {
  return total === 0 ? 100 : (covered / total) * 100;
}

let totalLines = 0;
let coveredLines = 0;
let totalFunctions = 0;
let coveredFunctions = 0;
const failures: string[] = [];
for (const [file, coverage] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
  const fileCoveredLines = [...coverage.lines.values()].filter((hits) => hits > 0).length;
  const fileLineRate = percentage(fileCoveredLines, coverage.lines.size);
  if (fileLineRate < 80) failures.push(`${file}: lines ${fileLineRate.toFixed(2)}% < 80%`);
  totalLines += coverage.lines.size;
  coveredLines += fileCoveredLines;
  totalFunctions += coverage.functionsFound;
  coveredFunctions += coverage.functionsHit;
}

const processAdapterModules = new Set([
  "src/cli.ts",
  "src/demo-integration-repair.ts",
  "src/index.ts",
  "src/mcp.ts",
]);
const sourceModules = (await readdir(resolve(root, "src")))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => `src/${name}`);
for (const module of sourceModules) {
  if (!files.has(module) && !processAdapterModules.has(module)) {
    failures.push(`${module}: missing from the source coverage report`);
  }
}

const lineRate = percentage(coveredLines, totalLines);
const functionRate = percentage(coveredFunctions, totalFunctions);
if (lineRate < 90) failures.push(`aggregate lines ${lineRate.toFixed(2)}% < 90%`);
if (functionRate < 90) failures.push(`aggregate functions ${functionRate.toFixed(2)}% < 90%`);
if (files.size === 0) failures.push("coverage report contains no src/*.ts modules");

console.log(`Coverage gate: ${lineRate.toFixed(2)}% lines, ${functionRate.toFixed(2)}% functions across ${files.size} modules.`);
if (failures.length > 0) {
  throw new Error(`Coverage thresholds failed:\n- ${failures.join("\n- ")}`);
}
