import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "empirical-package-consumer-"));
const cache = join(temporary, "npm-cache");
const consumer = join(temporary, "consumer");
await mkdir(cache);
await mkdir(consumer);

function run(command: string, args: string[], cwd: string, inherit = false): string {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, npm_config_cache: cache },
    encoding: "utf8",
    shell: false,
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout ?? "";
}

try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const node = process.platform === "win32" ? "node.exe" : "node";
  const packedOutput = run(
    npm,
    ["pack", "--json", "--pack-destination", temporary],
    root,
  );
  const packed = JSON.parse(packedOutput) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  const archive = packed[0];
  if (!archive) throw new Error("npm pack returned no package");
  const paths = new Set(archive.files.map((file) => file.path));
  for (const required of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/protocol.js",
    "dist/protocol.d.ts",
    "dist/mcp.js",
    "dist/mcp.d.ts",
    "dist/integrations.js",
    "dist/integrations.d.ts",
    "CHANGELOG.md",
    "docs/versioning.md",
  ]) {
    if (!paths.has(required)) throw new Error(`Packed package omitted ${required}`);
  }
  if ([...paths].some((path) => path.startsWith("src/"))) {
    throw new Error("Packed package exposed source internals");
  }

  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({
      name: "empirical-clean-consumer",
      private: true,
      type: "module",
      dependencies: { "empirical-sdd": `file:${join(temporary, archive.filename)}` },
    }, null, 2)}\n`,
    "utf8",
  );
  run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer, true);

  await writeFile(
    join(consumer, "runtime.mjs"),
    `import { EmpiricalProject, PRODUCT_VERSION, SCHEMA_VERSION } from "empirical-sdd";
import { canonicalJson } from "empirical-sdd/protocol";
import { createMcpServer } from "empirical-sdd/mcp";
import { EMPIRICAL_AGENT_SKILL_NAMES, uninstallGlobalAgentSkills } from "empirical-sdd/integrations";

if (typeof EmpiricalProject !== "function" || PRODUCT_VERSION !== "0.23.0" || SCHEMA_VERSION !== 5) throw new Error("root export mismatch");
if (canonicalJson({ b: 2, a: 1 }) !== '{"a":1,"b":2}') throw new Error("protocol export mismatch");
if (typeof createMcpServer !== "function") throw new Error("MCP export mismatch");
if (EMPIRICAL_AGENT_SKILL_NAMES.length !== 1 || EMPIRICAL_AGENT_SKILL_NAMES[0] !== "empirical-init" || typeof uninstallGlobalAgentSkills !== "function") throw new Error("integration export mismatch");
let blocked = false;
try { await import("empirical-sdd/storage"); } catch (error) { blocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"; }
if (!blocked) throw new Error("internal package subpath was exported");
`,
    "utf8",
  );
  run(node, [join(consumer, "runtime.mjs")], consumer);
  const packagedHelp = run(
    node,
    [join(consumer, "node_modules", "empirical-sdd", "dist", "cli.js"), "--help"],
    consumer,
  );
  if (!packagedHelp.includes("empirical uninstall")) {
    throw new Error("Packed CLI help omitted empirical uninstall");
  }

  await writeFile(
    join(consumer, "types.ts"),
    `import { EmpiricalProject, type UninstallReport, type WorkflowState } from "empirical-sdd";
import { type EvidenceReceipt } from "empirical-sdd/protocol";
import { createMcpServer } from "empirical-sdd/mcp";
import { uninstallGlobalAgentSkills, type EmpiricalAgentSkillName } from "empirical-sdd/integrations";
// @ts-expect-error package internals are intentionally unavailable
import { ProjectStore } from "empirical-sdd/storage";
void EmpiricalProject; void createMcpServer;
const state = null as unknown as WorkflowState;
const receipt = null as unknown as EvidenceReceipt;
const skill = null as unknown as EmpiricalAgentSkillName;
const uninstall = null as unknown as UninstallReport;
void state; void receipt; void skill; void uninstall; void uninstallGlobalAgentSkills; void ProjectStore;
`,
    "utf8",
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ["types.ts"],
    }, null, 2)}\n`,
    "utf8",
  );
  run(
    node,
    [resolve(root, "node_modules/typescript/bin/tsc"), "-p", join(consumer, "tsconfig.json")],
    consumer,
  );

  const installed = JSON.parse(
    await readFile(join(consumer, "node_modules/empirical-sdd/package.json"), "utf8"),
  ) as { version: string };
  console.log(`Clean package consumer passed for empirical-sdd ${installed.version}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
