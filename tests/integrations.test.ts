import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, parse } from "node:path";
import { EmpiricalProject } from "../src/core.js";
import { EmpiricalError } from "../src/errors.js";
import {
  EMPIRICAL_AGENT_SKILL_NAMES,
  installGlobalAgentSkills,
  managedGlobalAgentIds,
  uninstallGlobalAgentSkills,
} from "../src/integrations.js";
import { OPERATIONS } from "../src/operations.js";
import type { IntegrationReport } from "../src/types.js";

const directories: string[] = [];
const obsoleteSkillNames = [
  "empirical-explore",
  "empirical-fast",
  "empirical-complex",
  "empirical-init",
  "empirical-loop",
  "empirical-socratic",
  "empirical-spec",
  "empirical-yolo",
] as const;
const currentSkillNames = [...EMPIRICAL_AGENT_SKILL_NAMES];
const globalRoots = [
  [".codex", "skills"],
  [".claude", "skills"],
  [".cursor", "skills"],
  [".gemini", "skills"],
  [".codeium", "windsurf", "skills"],
] as const;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

describe("agent integrations", () => {
  test("project initialization installs runtime bridges without project-local workflow commands", async () => {
    const root = await temporaryDirectory("empirical-project-integrations-");
    const { integrations } = await EmpiricalProject.initialize(root);

    expect(integrations.scope).toBe("project");
    expect(integrations.entrypoints).toEqual([]);
    expect(integrations.created.sort()).toEqual([
      ".codex/config.toml",
      ".cursor/mcp.json",
      ".gemini/settings.json",
      ".mcp.json",
    ]);
    await expect(readFile(join(root, ".agents", "skills", "empirical", "SKILL.md"), "utf8"))
      .rejects.toBeDefined();
    expect(await readFile(join(root, ".mcp.json"), "utf8")).toContain('"empirical"');
  });

  test("project integration removes only marker-owned legacy commands and instruction blocks", async () => {
    const root = await temporaryDirectory("empirical-project-migration-");
    await mkdir(join(root, ".agents", "skills", "empirical-fast"), { recursive: true });
    await mkdir(join(root, ".agents", "skills", "empirical-loop"), { recursive: true });
    await mkdir(join(root, ".claude", "skills", "empirical-complex"), { recursive: true });
    await mkdir(join(root, ".claude", "skills", "empirical-spec"), { recursive: true });
    await writeFile(
      join(root, "AGENTS.md"),
      "  Keep this spacing.  \n<!-- empirical-sdd:start -->\nold workflow\n<!-- empirical-sdd:end -->\n",
      "utf8",
    );
    await writeFile(
      join(root, ".agents", "skills", "empirical-fast", "SKILL.md"),
      "<!-- empirical-sdd:managed-file -->\nold\n",
      "utf8",
    );
    await writeFile(
      join(root, ".agents", "skills", "empirical-loop", "SKILL.md"),
      "<!-- empirical-sdd:managed-file -->\nold local loop\n",
      "utf8",
    );
    await writeFile(
      join(root, ".claude", "skills", "empirical-complex", "SKILL.md"),
      "# Mine\n",
      "utf8",
    );
    await writeFile(join(root, ".claude", "skills", "empirical-spec", "SKILL.md"), "# My spec\n", "utf8");

    const { integrations } = await EmpiricalProject.initialize(root);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("  Keep this spacing.  \n");
    expect(integrations.removed).toContain(".agents/skills/empirical-fast/SKILL.md");
    expect(integrations.removed).toContain(".agents/skills/empirical-loop/SKILL.md");
    expect(integrations.preserved).toContain(
      ".claude/skills/empirical-complex/SKILL.md (existing unmanaged file)",
    );
    expect(await readFile(join(root, ".claude", "skills", "empirical-complex", "SKILL.md"), "utf8"))
      .toBe("# Mine\n");
    expect(integrations.preserved).toContain(
      ".claude/skills/empirical-spec/SKILL.md (existing unmanaged file)",
    );
  });

  test("global install creates only the registry-backed Empirical skill for every selected agent", async () => {
    const home = await temporaryDirectory("empirical-global-skills-");
    const report = await installGlobalAgentSkills(home, { all: true, pathValue: "" });

    expect(report.scope).toBe("global");
    expect(report.selected).toHaveLength(73);
    expect(report.destinations).toHaveLength(65);
    expect(report.created).toHaveLength(66);
    expect(report.updated).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.preserved).toEqual([]);
    expect(report.entrypoints).toHaveLength(73);
    expect(report.entrypoints.filter((entrypoint) => entrypoint.guidanceVerified)).toHaveLength(5);
    expect(report.entrypoints.filter((entrypoint) => entrypoint.guidanceVerified)
      .every((entrypoint) => entrypoint.invocations.length === 1)).toBe(true);
    expect(report.entrypoints.find((entrypoint) => entrypoint.id === "codebuddy")).toMatchObject({
      invocations: [], guidanceVerified: false, projectMcp: false, handoff: false,
    });
    expect(report.entrypoints.find((entrypoint) => entrypoint.id === "codex")?.invocations)
      .toEqual(["$empirical"]);
    expect(report.entrypoints.find((entrypoint) => entrypoint.id === "claude-code")?.invocations)
      .toEqual(["/empirical"]);
    expect(report.entrypoints.find((entrypoint) => entrypoint.id === "windsurf")?.invocations)
      .toEqual(["@empirical"]);

    for (const segments of globalRoots) {
      for (const skillName of currentSkillNames) {
        const contents = await readFile(join(home, ...segments, skillName, "SKILL.md"), "utf8");
        expect(contents).toStartWith(`---\nname: ${skillName}\ndescription: `);
        expect(contents.match(/^name:/gm)).toHaveLength(1);
        expect(contents).toContain("empirical-sdd:managed-file");
        expect(contents).toContain("MCP");
        expect(contents).toContain("empirical __internal");
      }
      expect(await readFile(join(home, ...segments, "empirical", "SKILL.md"), "utf8"))
        .toContain("only user-facing Empirical skill");
      expect(await readFile(join(home, ...segments, "empirical", "SKILL.md"), "utf8"))
        .toContain("empirical_tracker_configure");
      expect(await readFile(join(home, ...segments, "empirical", "SKILL.md"), "utf8"))
        .toContain("local journal as authoritative");
      for (const obsolete of obsoleteSkillNames) {
        await expect(readFile(join(home, ...segments, obsolete, "SKILL.md"), "utf8"))
          .rejects.toBeDefined();
      }
    }

    const repeated = await installGlobalAgentSkills(home, { all: true, pathValue: "" });
    expect(repeated.created).toEqual([]);
    expect(repeated.updated).toEqual([]);
    expect(repeated.removed).toEqual([]);
    expect(repeated.preserved).toEqual([]);
    expect(JSON.parse(await readFile(join(home, ".empirical-sdd", "integrations.json"), "utf8")))
      .toMatchObject({ managedBy: "empirical-sdd", selected: report.selected });
  });

  test("global refresh updates current managed skills, removes managed legacy skills, and preserves unmanaged collisions", async () => {
    const home = await temporaryDirectory("empirical-global-preserve-");
    await installGlobalAgentSkills(home, { all: true, pathValue: "" });

    const stale = join(home, ".codex", "skills", "empirical", "SKILL.md");
    const managedObsolete = join(home, ".codex", "skills", "empirical-fast", "SKILL.md");
    const unmanagedObsolete = join(home, ".claude", "skills", "empirical-fast", "SKILL.md");
    const unmanagedCurrent = join(home, ".claude", "skills", "empirical-spec", "SKILL.md");
    const staleLoop = join(home, ".gemini", "skills", "empirical-loop", "SKILL.md");
    const nonFile = join(home, ".gemini", "skills", "empirical-explore", "SKILL.md");
    await writeFile(stale, "<!-- empirical-sdd:managed-file -->\nstale\n", "utf8");
    await mkdir(join(staleLoop, ".."), { recursive: true });
    await writeFile(staleLoop, "<!-- empirical-sdd:managed-file -->\nstale loop\n", "utf8");
    await mkdir(join(managedObsolete, ".."), { recursive: true });
    await writeFile(managedObsolete, "<!-- empirical-sdd:managed-file -->\nold\n", "utf8");
    await mkdir(join(unmanagedObsolete, ".."), { recursive: true });
    await writeFile(unmanagedObsolete, "# My own skill\n", "utf8");
    await mkdir(join(unmanagedCurrent, ".."), { recursive: true });
    await writeFile(unmanagedCurrent, "# My own specification skill\n", "utf8");
    await mkdir(nonFile, { recursive: true });

    const report = await installGlobalAgentSkills(home, { all: true, pathValue: "" });
    expect(report.updated).toContain(".codex/skills/empirical/SKILL.md");
    expect(report.removed).toContain(".gemini/skills/empirical-loop/SKILL.md");
    expect(report.removed).toContain(".codex/skills/empirical-fast/SKILL.md");
    expect(await readFile(stale, "utf8")).toContain("name: empirical");
    expect(report.preserved).toContain(
      ".claude/skills/empirical-fast/SKILL.md (existing unmanaged file)",
    );
    expect(await readFile(unmanagedObsolete, "utf8")).toBe("# My own skill\n");
    expect(report.preserved).toContain(
      ".claude/skills/empirical-spec/SKILL.md (existing unmanaged file)",
    );
    expect(await readFile(unmanagedCurrent, "utf8")).toBe("# My own specification skill\n");
    expect(report.preserved).toContain(
      ".gemini/skills/empirical-explore/SKILL.md (existing non-file)",
    );
    expect((await lstat(nonFile)).isDirectory()).toBe(true);
  });

  test("an explicit selection installs selected agents and removes only deselected managed skills", async () => {
    const home = await temporaryDirectory("empirical-global-selection-");
    await installGlobalAgentSkills(home, { all: true, pathValue: "" });
    const unmanaged = join(home, ".claude", "skills", "my-skill", "SKILL.md");
    await mkdir(join(unmanaged, ".."), { recursive: true });
    await writeFile(unmanaged, "# Mine\n", "utf8");

    const report = await installGlobalAgentSkills(home, { agents: ["codex", "cursor"], pathValue: "" });
    expect(report.entrypoints.map((entrypoint) => entrypoint.id)).toEqual(["codex", "cursor"]);
    expect(report.removed).toHaveLength(63);
    expect(report.removed).toEqual(expect.arrayContaining([
      ".claude/skills/empirical/SKILL.md",
      ".gemini/skills/empirical/SKILL.md",
      ".codeium/windsurf/skills/empirical/SKILL.md",
    ]));
    expect(await readFile(unmanaged, "utf8")).toBe("# Mine\n");
    expect(await readFile(join(home, ".codex", "skills", "empirical", "SKILL.md"), "utf8"))
      .toContain("name: empirical");
    await expect(readFile(join(home, ".claude", "skills", "empirical", "SKILL.md"), "utf8"))
      .rejects.toBeDefined();
  });

  test("shared roots are reconciled once and remain until the last selected target leaves", async () => {
    const home = await temporaryDirectory("empirical-global-shared-");
    const shared = join(home, ".config", "agents", "skills");
    const first = await installGlobalAgentSkills(home, { agents: ["amp", "replit"], pathValue: "" });
    expect(first.entrypoints.map((entrypoint) => entrypoint.id)).toEqual(["amp", "replit"]);
    expect(first.destinations).toEqual([shared]);
    expect(first.created).toHaveLength(2);

    const survivor = await installGlobalAgentSkills(home, { agents: ["amp"], pathValue: "" });
    expect(survivor.removed).toEqual([]);
    expect(await readFile(join(shared, "empirical", "SKILL.md"), "utf8")).toContain("name: empirical");
    expect(await managedGlobalAgentIds(home)).toEqual(["amp"]);

    const metadataPath = join(home, ".empirical-sdd", "integrations.json");
    const previousCatalog = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    previousCatalog.catalogCommit = "0000000000000000000000000000000000000000";
    await writeFile(metadataPath, `${JSON.stringify(previousCatalog, null, 2)}\n`, "utf8");
    expect(await managedGlobalAgentIds(home)).toEqual(["amp"]);
    const migratedMetadata = await installGlobalAgentSkills(home, { agents: ["amp"], pathValue: "" });
    expect(migratedMetadata.updated).toContain(".empirical-sdd/integrations.json");

    const lastRemoved = await installGlobalAgentSkills(home, { agents: ["codex"], pathValue: "" });
    expect(lastRemoved.removed).toHaveLength(1);
    await expect(readFile(join(shared, "empirical", "SKILL.md"), "utf8")).rejects.toBeDefined();
  });

  test("legacy aliases canonicalize, project-only targets fail, and unmanaged selection metadata is preserved", async () => {
    const home = await temporaryDirectory("empirical-global-aliases-");
    const metadata = join(home, ".empirical-sdd", "integrations.json");
    await mkdir(join(metadata, ".."), { recursive: true });
    await writeFile(metadata, "{\"owner\":\"mine\"}\n", "utf8");
    const report = await installGlobalAgentSkills(home, { agents: ["claude", "gemini"], pathValue: "" });
    expect(report.selected).toEqual(["claude-code", "gemini-cli"]);
    expect(report.preserved).toContain(".empirical-sdd/integrations.json (unmanaged or incompatible selection metadata)");
    expect(await readFile(metadata, "utf8")).toBe("{\"owner\":\"mine\"}\n");
    await expect(installGlobalAgentSkills(home, { agents: ["eve"], pathValue: "" }))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  test("global refresh does not follow skill or parent-directory symbolic links", async () => {
    if (process.platform === "win32") return;
    const home = await temporaryDirectory("empirical-global-links-");
    const outside = await temporaryDirectory("empirical-global-links-outside-");
    await mkdir(join(home, ".codex", "skills"), { recursive: true });
    await mkdir(join(home, ".cursor"), { recursive: true });
    await symlink(outside, join(home, ".codex", "skills", "empirical"));
    await symlink(outside, join(home, ".cursor", "skills"));

    const report = await installGlobalAgentSkills(home, { all: true, pathValue: "" });
    expect(report.preserved).toContain(
      ".codex/skills/empirical/SKILL.md (symbolic link ancestor .codex/skills/empirical)",
    );
    expect(report.preserved).toContain(
      ".cursor/skills/empirical/SKILL.md (symbolic link ancestor .cursor/skills)",
    );
    expect(await lstat(join(home, ".codex", "skills", "empirical"))).toSatisfy((value) => value.isSymbolicLink());
    await expect(readFile(join(outside, "SKILL.md"), "utf8")).rejects.toBeDefined();

    const removed = await uninstallGlobalAgentSkills(home);
    expect(removed.preserved).toContain(
      ".codex/skills/empirical/SKILL.md (symbolic link ancestor .codex/skills/empirical)",
    );
    expect(removed.preserved).toContain(
      ".cursor/skills/empirical/SKILL.md (symbolic link ancestor .cursor/skills)",
    );
    expect((await lstat(join(home, ".codex", "skills", "empirical"))).isSymbolicLink()).toBe(true);
    await expect(readFile(join(outside, "SKILL.md"), "utf8")).rejects.toBeDefined();
  });

  test("global uninstall removes only owned skills and metadata and converges", async () => {
    const home = await temporaryDirectory("empirical-global-uninstall-");
    const project = join(home, "project");
    await mkdir(join(project, ".empirical"), { recursive: true });
    await writeFile(join(project, ".empirical", "state.json"), "durable history\n", "utf8");
    await writeFile(join(project, ".mcp.json"), '{"mcpServers":{"empirical":{"command":"empirical"}}}\n', "utf8");
    await installGlobalAgentSkills(home, { agents: ["amp", "replit", "codex"], pathValue: "" });

    const unmanaged = join(home, ".codex", "skills", "empirical-spec", "SKILL.md");
    const obsolete = join(home, ".config", "agents", "skills", "empirical-fast", "SKILL.md");
    await mkdir(join(unmanaged, ".."), { recursive: true });
    await writeFile(unmanaged, "# My own similarly named skill\n", "utf8");
    await mkdir(join(obsolete, ".."), { recursive: true });
    await writeFile(obsolete, "<!-- empirical-sdd:managed-file -->\nlegacy\n", "utf8");

    const report = await uninstallGlobalAgentSkills(home);
    expect(report.scope).toBe("global");
    expect(new Set(report.selected)).toEqual(new Set(["amp", "codex", "replit"]));
    expect(new Set(report.destinations)).toEqual(new Set([
      join(home, ".codex", "skills"),
      join(home, ".config", "agents", "skills"),
    ]));
    expect(report.removed).toContain(".empirical-sdd/integrations.json");
    expect(report.removed).toContain(".config/agents/skills/empirical-fast/SKILL.md");
    expect(report.preserved).toContain(
      ".codex/skills/empirical-spec/SKILL.md (existing unmanaged file)",
    );
    expect(await readFile(unmanaged, "utf8")).toBe("# My own similarly named skill\n");
    await expect(readFile(join(home, ".codex", "skills", "empirical", "SKILL.md"), "utf8"))
      .rejects.toBeDefined();
    await expect(readFile(join(home, ".empirical-sdd", "integrations.json"), "utf8"))
      .rejects.toBeDefined();
    expect(await readFile(join(project, ".empirical", "state.json"), "utf8")).toBe("durable history\n");
    expect(await readFile(join(project, ".mcp.json"), "utf8"))
      .toContain('"command":"empirical"');

    const repeated = await uninstallGlobalAgentSkills(home);
    expect(repeated.removed).toEqual([]);
    expect(repeated.preserved).toEqual([
      ".codex/skills/empirical-spec/SKILL.md (existing unmanaged file)",
    ]);
  });

  test("global uninstall preserves incompatible selection metadata", async () => {
    const home = await temporaryDirectory("empirical-global-uninstall-metadata-");
    const metadata = join(home, ".empirical-sdd", "integrations.json");
    await mkdir(join(metadata, ".."), { recursive: true });
    await writeFile(metadata, '{"owner":"mine"}\n', "utf8");
    const report = await uninstallGlobalAgentSkills(home);
    expect(report.removed).toEqual([]);
    expect(report.preserved).toEqual([
      ".empirical-sdd/integrations.json (unmanaged or incompatible selection metadata)",
    ]);
    expect(await readFile(metadata, "utf8")).toBe('{"owner":"mine"}\n');
  });

  test("global integration rejects empty and filesystem-root homes", async () => {
    await expect(installGlobalAgentSkills(" ")).rejects.toBeInstanceOf(EmpiricalError);
    await expect(installGlobalAgentSkills(parse(tmpdir()).root)).rejects.toBeInstanceOf(EmpiricalError);
  });

  test("install CLI works outside a project and reports one human and JSON entrypoint per agent", async () => {
    const home = await temporaryDirectory("empirical-global-cli-home-");
    const cwd = await temporaryDirectory("empirical-global-cli-cwd-");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    };

    const human = spawnSync(process.execPath, [cli, "install", "--all"], {
      cwd,
      env,
      encoding: "utf8",
    });
    expect(human.status).toBe(0);
    expect(human.stderr).toBe("");
    expect(human.stdout).toContain("reconciled 73 selected agents (66 created");
    expect(human.stdout).toContain("Filesystem outcomes:");
    expect(human.stdout).toContain("Created (66)");
    expect(human.stdout).toContain("Installed Empirical agent skills:");
    expect(human.stdout).toContain(`Codex (${join(home, ".codex", "skills")})`);
    expect(human.stdout).toContain("Invoke: $empirical");
    expect(human.stdout).not.toContain("$empirical-spec");
    expect(human.stdout).toContain("Windsurf");
    expect(human.stdout).not.toContain("$empirical-explore");

    const json = spawnSync(process.execPath, [cli, "install", "--all", "--json"], {
      cwd,
      env,
      encoding: "utf8",
    });
    expect(json.status).toBe(0);
    const report = JSON.parse(json.stdout) as Awaited<ReturnType<typeof installGlobalAgentSkills>>;
    expect(report.scope).toBe("global");
    expect(report.created).toEqual([]);
    expect(report.entrypoints).toHaveLength(73);
    expect(report.destinations).toHaveLength(65);
    expect(report.entrypoints.filter((entrypoint) => entrypoint.guidanceVerified)).toHaveLength(5);
    await expect(lstat(join(cwd, ".empirical"))).rejects.toBeDefined();
  });

  test("primary help exposes only install, update, and uninstall as normal terminal commands", () => {
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const outputs = [[], ["help"], ["--help"], ["-h"]].map((args) => spawnSync(
      process.execPath,
      [cli, ...args],
      { encoding: "utf8" },
    ));
    for (const result of outputs) {
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("╭───╯    ╰───╮");
      expect(result.stdout.match(/empirical v0\.22\.1/g)).toHaveLength(1);
      expect(result.stdout.indexOf("empirical v0.22.1")).toBeLessThan(result.stdout.indexOf("Lifecycle:"));
      expect(result.stdout).not.toContain("\u001b[");
      expect(result.stdout).toContain("empirical install");
      expect(result.stdout).toContain("empirical update");
      expect(result.stdout).toContain("empirical uninstall");
      for (const hidden of [
        "init", "config", "explore", "fast", "complex", "loop", "complete",
        "archive", "status", "integrate", "doctor", "migrate",
      ]) expect(result.stdout).not.toContain(`empirical ${hidden}`);
    }
    expect(outputs.every((result) => result.stdout === outputs[0]!.stdout)).toBe(true);
  });

  test("every registry operation and public subcommand has no-write usable help", async () => {
    const cwd = await temporaryDirectory("empirical-help-");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    for (const operation of OPERATIONS) {
      const result = spawnSync(process.execPath, [
        cli,
        "__internal",
        operation.internalVerb,
        "--help",
        "--root",
        cwd,
      ], { encoding: "utf8", cwd });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(operation.summary);
      expect(result.stdout).toContain(`empirical __internal ${operation.internalVerb}${operation.cliUsage}`);
      expect(result.stdout).toContain(`MCP tool: ${operation.mcpName}`);
    }
    for (const command of ["install", "update", "uninstall", "mcp"]) {
      const result = spawnSync(process.execPath, [cli, command, "--help"], {
        encoding: "utf8",
        cwd,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`empirical ${command}`);
    }
    await expect(lstat(join(cwd, ".empirical"))).rejects.toBeDefined();
  });

  test("version aliases remain exact and unbranded", () => {
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    for (const alias of ["version", "--version", "-v"]) {
      const result = spawnSync(process.execPath, [cli, alias], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("0.22.1\n");
      expect(result.stderr).toBe("");
    }
  });

  test("public workflow verbs are rejected before project discovery", () => {
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    for (const command of ["init", "config", "explore", "discovery", "fast", "complex", "spec", "socratic", "loop"]) {
      const result = spawnSync(process.execPath, [cli, command], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("UNKNOWN_COMMAND");
      expect(result.stderr).toContain("empirical install, empirical update, or empirical uninstall");
    }
  });

  test("non-interactive install requires an explicit selection", async () => {
    const home = await temporaryDirectory("empirical-global-no-tty-");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const result = spawnSync(process.execPath, [cli, "install"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AGENT_SELECTION_REQUIRED");
    expect(result.stderr).toContain("--agent <name>");
    const yes = spawnSync(process.execPath, [cli, "install", "--yes"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: "" },
    });
    expect(yes.status).toBe(1);
    expect(yes.stderr).toContain("AGENT_SELECTION_REQUIRED");
  });

  test("non-interactive uninstall refuses before mutation without --yes", async () => {
    const home = await temporaryDirectory("empirical-global-uninstall-confirm-");
    const cwd = await temporaryDirectory("empirical-global-uninstall-confirm-cwd-");
    await installGlobalAgentSkills(home, { agents: ["codex"], pathValue: "" });
    const managed = join(home, ".codex", "skills", "empirical", "SKILL.md");
    const before = await readFile(managed, "utf8");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    for (const args of [["uninstall"], ["uninstall", "--json"]]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: "" },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("UNINSTALL_CONFIRMATION_REQUIRED");
      expect(result.stderr).toContain("--yes");
      expect(await readFile(managed, "utf8")).toBe(before);
    }
  });

  test("confirmed uninstall works outside a repository with JSON and human reports", async () => {
    if (process.platform === "win32") return;
    const home = await temporaryDirectory("empirical-global-uninstall-cli-");
    const cwd = await temporaryDirectory("empirical-global-uninstall-cli-cwd-");
    const bin = join(home, "bin");
    const npmLog = join(home, "npm-argv.txt");
    await mkdir(bin);
    await writeFile(
      join(bin, "npm"),
      '#!/bin/sh\ntest ! -e "$EMPIRICAL_MANAGED_SENTINEL" || exit 21\nprintf \'npm chatter\\n\'\nprintf \'%s\\n\' "$@" > "$EMPIRICAL_NPM_LOG"\n',
      "utf8",
    );
    await chmod(join(bin, "npm"), 0o755);
    await mkdir(join(cwd, ".empirical"), { recursive: true });
    await writeFile(join(cwd, ".empirical", "history.json"), "preserve me\n", "utf8");
    await writeFile(join(cwd, ".mcp.json"), "preserve integration\n", "utf8");
    await installGlobalAgentSkills(home, { agents: ["codex"], pathValue: "" });
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      EMPIRICAL_NPM_LOG: npmLog,
      EMPIRICAL_MANAGED_SENTINEL: join(home, ".codex", "skills", "empirical", "SKILL.md"),
    };

    const json = spawnSync(process.execPath, [cli, "uninstall", "--yes", "--json"], {
      cwd,
      env,
      encoding: "utf8",
    });
    expect(json.status).toBe(0);
    expect(json.stderr).toBe("");
    expect(json.stdout).not.toContain("npm chatter");
    const report = JSON.parse(json.stdout) as {
      package: string;
      integrations: IntegrationReport;
      preserved: { projectHistory: boolean; repositoryIntegrations: boolean };
    };
    expect(report.package).toBe("removed");
    expect(report.integrations.removed).toContain(".empirical-sdd/integrations.json");
    expect(report.preserved).toEqual({ projectHistory: true, repositoryIntegrations: true });
    expect(await readFile(npmLog, "utf8")).toBe("uninstall\n-g\nempirical-sdd\n");
    expect(await readFile(join(cwd, ".empirical", "history.json"), "utf8")).toBe("preserve me\n");
    expect(await readFile(join(cwd, ".mcp.json"), "utf8")).toBe("preserve integration\n");

    const human = spawnSync(process.execPath, [cli, "uninstall", "-y"], {
      cwd,
      env,
      encoding: "utf8",
    });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("removed the global npm package and 0 managed global artifacts");
    expect(human.stdout).toContain("project .empirical histories and evidence");
    expect(human.stdout).toContain("repository MCP and agent configuration");
  });

  test("repeatable agent flags install the exact selection", async () => {
    const home = await temporaryDirectory("empirical-global-flags-");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const result = spawnSync(process.execPath, [
      cli, "install", "-a", "codex", "--agent", "gemini", "--json",
    ], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: "" },
    });
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as Awaited<ReturnType<typeof installGlobalAgentSkills>>;
    expect(report.entrypoints.map((entrypoint) => entrypoint.id)).toEqual(["codex", "gemini-cli"]);
  });

  test("yes mode preserves detected agents without prompting", async () => {
    const home = await temporaryDirectory("empirical-global-yes-");
    await mkdir(join(home, ".codex"), { recursive: true });
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const result = spawnSync(process.execPath, [cli, "install", "--yes", "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: "" },
    });
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as IntegrationReport).entrypoints.map((entrypoint) => entrypoint.id))
      .toEqual(["codex"]);
  });

  test("yes mode reuses a remembered broad selection without detecting it", async () => {
    const home = await temporaryDirectory("empirical-global-remembered-");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: "" };
    const selected = spawnSync(process.execPath, [cli, "install", "--agent", "codebuddy", "--json"], {
      encoding: "utf8", env,
    });
    expect(selected.status).toBe(0);
    const refreshed = spawnSync(process.execPath, [cli, "install", "--yes", "--json"], {
      encoding: "utf8", env,
    });
    expect(refreshed.status).toBe(0);
    expect((JSON.parse(refreshed.stdout) as IntegrationReport).selected).toEqual(["codebuddy"]);
  });
});
