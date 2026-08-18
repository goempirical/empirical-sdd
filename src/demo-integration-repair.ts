import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EmpiricalProject } from "./core.js";
import { doctorRepository, type DoctorFinding } from "./doctor.js";
import { refreshRepositoryKnowledge } from "./knowledge.js";
import { digestJson } from "./protocol.js";

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function findingSummary(entry: DoctorFinding): Pick<DoctorFinding, "code" | "message" | "remediation"> {
  return {
    code: entry.code,
    message: entry.message,
    remediation: entry.remediation,
  };
}

const temporary = await mkdtemp(join(tmpdir(), "empirical-integration-repair-demo-"));
const root = join(temporary, "repository");

try {
  await mkdir(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "demo@empirical.test"]);
  git(root, ["config", "user.name", "Empirical Demo"]);
  await writeFile(join(root, "README.md"), "# Integration repair demo\n", "utf8");
  await writeFile(join(root, "package.json"), '{"private":true}\n', "utf8");

  const initialized = await EmpiricalProject.initialize(root, {
    integrations: false,
    setupComplete: true,
  });
  await Promise.all(["overview", "architecture", "commands", "conventions"].map((page) =>
    writeFile(
      join(root, ".empirical", "context", `${page}.md`),
      `# ${page}\n\nVerified demo repository context.\n`,
      "utf8",
    )
  ));
  await refreshRepositoryKnowledge(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "completed setup without project integrations"]);

  const beforeConfigDigest = digestJson(await initialized.project.config());
  const beforeStateDigest = digestJson(await initialized.project.status());
  const before = await doctorRepository(root);
  const missing = before.findings.find((entry) => entry.code === "PROJECT_INTEGRATIONS_MISSING");
  if (!missing) throw new Error("Demo setup did not reproduce missing project integrations");

  const repaired = await EmpiricalProject.initialize(root);
  const after = await doctorRepository(root);
  const ready = after.findings.find((entry) => entry.code === "PROJECT_INTEGRATIONS_READY");
  if (!ready) throw new Error("Integration repair did not make automatic activation ready");

  const configPreserved = digestJson(await repaired.project.config()) === beforeConfigDigest;
  const workflowStatePreserved = digestJson(await repaired.project.status()) === beforeStateDigest;
  if (!configPreserved || !workflowStatePreserved) {
    throw new Error("Integration repair changed durable configuration or workflow state");
  }

  process.stdout.write(`${JSON.stringify({
    scenario: "completed Schema 5 repository with missing project integrations",
    before: {
      doctorStatus: before.status,
      automaticActivation: "blocked",
      finding: findingSummary(missing),
    },
    repair: {
      operation: "empirical-init",
      created: repaired.integrations.created.sort(),
      updated: repaired.integrations.updated.sort(),
      preserved: repaired.integrations.preserved.sort(),
    },
    after: {
      doctorStatus: after.status,
      automaticActivation: "ready",
      finding: findingSummary(ready),
    },
    durableState: {
      configPreserved,
      workflowStatePreserved,
    },
  }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
