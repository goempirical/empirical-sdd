import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = await mkdtemp(join(tmpdir(), "empirical-dist-smoke-"));
const yoloRoot = await mkdtemp(join(tmpdir(), "empirical-dist-yolo-"));
const gitRoot = await mkdtemp(join(tmpdir(), "empirical-dist-git-"));
const skillHome = await mkdtemp(join(tmpdir(), "empirical-dist-skills-"));
const createdWorktrees: string[] = [];
const cli = resolve(import.meta.dir, "../dist/cli.js");
const transport = new StdioClientTransport({
  command: "node",
  args: [cli, "mcp", "--root", root],
  cwd: root,
  stderr: "pipe",
});
const client = new Client({ name: "empirical-dist-smoke", version: "1.0.0" });

async function runCli(directory: string, args: string[], env?: Record<string, string>) {
  const publicCommand = args.length === 0 || ["help", "--help", "-h", "version", "--version", "-v", "install", "update", "uninstall"].includes(args[0] ?? "");
  const child = Bun.spawn(["node", cli, ...(publicCommand ? args : ["__internal", ...args]), "--root", directory], {
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { code, stdout, stderr };
}

function git(directory: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

try {
  await client.connect(transport);
  const listed = (await client.listTools()).tools.map((tool) => tool.name);
  for (const name of [
    "empirical_route", "empirical_yolo", "empirical_evidence_execute",
    "empirical_evidence_collect", "empirical_integrate", "empirical_deliver",
    "empirical_publish", "empirical_integrations", "empirical_doctor",
  ]) {
    if (!listed.includes(name)) throw new Error(`Bundled MCP omitted ${name}`);
  }
  if (listed.some((name) => name.includes("workstreams"))) {
    throw new Error("Bundled MCP retained the removed parallel-state tool");
  }

  const initialized = await client.callTool({ name: "empirical_init", arguments: { root } });
  if (initialized.isError) throw new Error("Bundled MCP init failed");
  const policy = {
    schemaVersion: 2,
    context: [],
    phases: {},
    verification: {
      evidence: { required: true, browserForUi: true, screenshotForUi: true, codeReview: true },
      commands: [{
        id: "verify",
        argv: [process.execPath, "-e", "process.exit(0)"],
        cwd: ".",
        timeoutMs: 30_000,
        maxOutputBytes: 65_536,
        evidenceKinds: ["test", "review"],
        criteria: [],
      }],
    },
    delivery: null,
    preferredAgent: null,
  };
  const configured = await client.callTool({ name: "empirical_configure", arguments: { root, policy } });
  if (configured.isError) throw new Error("Bundled Policy-v2 configuration failed");

  const configBefore = await readFile(join(root, ".empirical/config.json"), "utf8");
  const explored = await client.callTool({ name: "empirical_explore", arguments: { root, problem: "Make status easier to understand" } });
  if (explored.isError || (explored.structuredContent as { problem?: string })?.problem !== "Make status easier to understand") {
    throw new Error("Bundled Explore failed");
  }
  if (await readFile(join(root, ".empirical/config.json"), "utf8") !== configBefore) {
    throw new Error("Explore mutated configuration");
  }

  let fast = await runCli(root, ["fast", "Fix a docs punctuation typo"]);
  for (const expected of [
    "Empirical · step 1/2",
    "implement (fast, waiting, revision 1)",
    "Required evidence: test, review",
    "--receipt <receipt-id>",
  ]) {
    if (!fast.stdout.includes(expected)) throw new Error(`Bundled Fast output omitted ${expected}: ${fast.stderr}`);
  }
  const evidence = await client.callTool({
    name: "empirical_evidence_execute",
    arguments: {
      root,
      commandId: "verify",
      criteria: ["AC-1"],
      evidenceKinds: ["test", "review"],
      summary: "Built focused test and diff review passed",
    },
  });
  if (evidence.isError) throw new Error("Bundled executed evidence failed");
  const receiptId = (evidence.structuredContent as { id?: string })?.id;
  if (!receiptId?.startsWith("executed-")) throw new Error("Bundled evidence omitted its immutable id");
  fast = await runCli(root, [
    "complete", "--revision", "1", "--outcome", "passed", "--summary", "Implemented",
    "--receipt", receiptId,
  ]);
  if (fast.code !== 0 || !fast.stdout.includes("done (fast, done, revision 2)")) {
    throw new Error(`Bundled Fast receipt completion failed: ${fast.stderr}`);
  }

  const routed = await client.callTool({
    name: "empirical_route",
    arguments: { root, request: "Publish npm release 1.0.0", requestedProfile: "fast" },
  });
  if (routed.isError || (routed.structuredContent as { riskFloor?: string })?.riskFloor !== "publication") {
    throw new Error("Bundled deterministic risk promotion failed");
  }
  if ((await client.callTool({ name: "empirical_init", arguments: { root: yoloRoot } })).isError) {
    throw new Error("Bundled YOLO fixture init failed");
  }
  const yolo = await client.callTool({
    name: "empirical_yolo",
    arguments: { root: yoloRoot, request: "Fix a docs punctuation typo", ceiling: "integrated" },
  });
  if (yolo.isError || (yolo.structuredContent as { mode?: string })?.mode !== "yolo") {
    throw new Error("Bundled bounded YOLO authorization failed");
  }

  git(gitRoot, ["init", "-b", "main"]);
  git(gitRoot, ["config", "user.name", "Empirical Smoke"]);
  git(gitRoot, ["config", "user.email", "empirical@example.test"]);
  await writeFile(join(gitRoot, "README.md"), "# Worktree smoke\n", "utf8");
  let gitCli = await runCli(gitRoot, ["init", "--defaults", "--no-integrations"]);
  if (gitCli.code !== 0) throw new Error(`Git fixture init failed: ${gitCli.stderr}`);
  git(gitRoot, ["add", "."]);
  git(gitRoot, ["commit", "-m", "base"]);
  git(gitRoot, ["checkout", "-b", "feature/current"]);
  gitCli = await runCli(gitRoot, ["fast", "Keep current comments-only work active"]);
  if (gitCli.code !== 0) throw new Error(`Current feature start failed: ${gitCli.stderr}`);
  git(gitRoot, ["add", "."]);
  git(gitRoot, ["commit", "-m", "current feature"]);
  const target = join(dirname(gitRoot), `${basename(gitRoot)}-isolated`);
  createdWorktrees.push(target);
  gitCli = await runCli(gitRoot, [
    "worktree", "create", "Add isolated output", "--workflow", "fast", "--type", "feature",
    "--id", "isolated-output", "--branch", "feature/isolated-output", "--path", target,
    "--base", "main", "--yes",
  ]);
  if (gitCli.code !== 0 || !gitCli.stdout.includes("Worktree created") || git(target, ["branch", "--show-current"]) !== "feature/isolated-output") {
    throw new Error(`Bundled real-worktree handoff failed: ${gitCli.stderr}`);
  }

  const packageJson = JSON.parse(await readFile(resolve(import.meta.dir, "../package.json"), "utf8")) as { version: string };
  for (const args of [["version"], ["--version"], ["-v"]]) {
    const version = await runCli(root, args);
    if (version.stdout !== "0.24.1\n" || packageJson.version !== "0.24.1") {
      throw new Error(`Bundled/package version mismatch: ${version.stdout}`);
    }
  }
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const help = await runCli(root, args);
    if (
      !help.stdout.includes("empirical v0.24.1")
      || !help.stdout.includes("through 1 installed skill")
      || !help.stdout.includes("Explicitly initialize or repair Empirical")
      || help.stdout.includes("\u001b[")
    ) throw new Error(`Bundled help omitted Schema-5 UX: ${help.stdout}`);
  }
  for (const args of [["install", "--help"], ["update", "--help"], ["uninstall", "--help"]]) {
    const help = await runCli(root, args, { HOME: skillHome, USERPROFILE: skillHome });
    const expected = args[0] === "uninstall"
      ? "Project .empirical histories and repository MCP/agent configuration are always preserved."
      : "1 registry-backed";
    if (help.code !== 0 || !help.stdout.includes(expected)) {
      throw new Error(`Bundled subcommand help failed: ${help.stderr}`);
    }
  }

  const installed = await runCli(root, ["install", "--all", "--json"], {
    HOME: skillHome,
    USERPROFILE: skillHome,
  });
  const integration = JSON.parse(installed.stdout) as {
    created?: string[];
    selected?: string[];
    destinations?: string[];
    entrypoints?: Array<{ skills: string[]; guidanceVerified: boolean }>;
  };
  if (
    installed.code !== 0
    || integration.created?.length !== 131
    || integration.selected?.length !== 73
    || integration.destinations?.length !== 65
    || integration.entrypoints?.filter((entry) => entry.guidanceVerified).length !== 5
    || integration.entrypoints?.some((entry) => entry.skills.length !== 1)
  ) {
    throw new Error(`Bundled broad single-skill install failed: ${installed.stderr}`);
  }
  for (const name of ["empirical-init"]) {
    const skill = await readFile(join(skillHome, ".codex", "skills", name, "SKILL.md"), "utf8");
    if (!skill.includes(`name: ${name}`) || !skill.includes("empirical-sdd:managed-file")) {
      throw new Error(`Bundled install produced an invalid ${name} skill`);
    }
  }

  console.log("Bundled 0.24 Init-skill, tracker, uninstall, receipt, routing, YOLO, worktree, CLI, and MCP smoke passed.");
} finally {
  await client.close();
  await Promise.all([...createdWorktrees, root, yoloRoot, gitRoot, skillHome].map((path) => rm(path, { recursive: true, force: true })));
}
