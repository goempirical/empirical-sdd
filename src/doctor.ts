import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";

import {
  inspectCapabilityClaims,
  resolveGitRepositoryIdentity,
  verifyStoredIntegrationReceipt,
} from "./coordination.js";
import {
  verifyDeliveryReceipt,
  type GitHubDeliveryReceipt,
} from "./delivery.js";
import { inspectProjectIntegrations } from "./integrations.js";
import { readJournal } from "./journal.js";
import { inspectRepositoryKnowledge } from "./knowledge.js";
import { parsePolicy } from "./policy.js";
import { digestJson, verifyReceiptDigest, type EvidenceReceipt, type JsonValue } from "./protocol.js";
import {
  MIGRATION_MARKER_NAME,
  migrationScratchKind,
} from "./migration-scratch.js";
import { inspectTrackerRecords, loadTrackerPolicy, trackerStatus } from "./tracking.js";
import type { WorkflowState } from "./types.js";

export type DoctorSeverity = "ok" | "warning" | "error";

export interface DoctorFinding {
  severity: DoctorSeverity;
  code: string;
  scope: string;
  message: string;
  remediation: string | null;
}

export interface DoctorReport {
  schemaVersion: 1;
  root: string;
  status: "healthy" | "warnings" | "errors";
  readonly: true;
  findings: DoctorFinding[];
}

interface SchemaInspection {
  version: number | null;
  setupComplete: boolean | null;
}

function finding(
  severity: DoctorSeverity,
  code: string,
  scope: string,
  message: string,
  remediation: string | null = null,
): DoctorFinding {
  return { severity, code, scope, message, remediation };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function toolVersion(root: string, command: string, args: string[]): string | null {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function executablePath(command: string): Promise<string | null> {
  const names = process.platform === "win32"
    ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
    : [command];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Continue through the fixed PATH candidates without launching them.
      }
    }
  }
  return null;
}

async function featureDirectories(root: string): Promise<string[]> {
  const specs = join(root, ".empirical", "specs");
  if (!(await exists(specs))) return [];
  return (await readdir(specs, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function inspectSchema(root: string, findings: DoctorFinding[]): Promise<SchemaInspection> {
  const configPath = join(root, ".empirical", "config.json");
  if (!(await exists(configPath))) {
    findings.push(
      finding(
        "error",
        "SCHEMA_CONFIG_MISSING",
        "schema",
        "The repository has no .empirical/config.json.",
        "Invoke the empirical skill to complete repository setup before starting workflow work.",
      ),
    );
    return { version: null, setupComplete: null };
  }
  try {
    const config = await readJson<Record<string, unknown>>(configPath);
    const version = typeof config.schemaVersion === "number" ? config.schemaVersion : null;
    const setupComplete = typeof config.setupComplete === "boolean" ? config.setupComplete : null;
    if (version === 5) {
      findings.push(finding("ok", "SCHEMA_CURRENT", "schema", "Repository state uses Schema 5."));
    } else if (version === 4) {
      findings.push(
        finding(
          "warning",
          "SCHEMA_MIGRATION_REQUIRED",
          "schema",
          "Repository state still uses Schema 4.",
          "Run the tested local Schema-5 migration before using Schema-5 mutating operations.",
        ),
      );
    } else {
      findings.push(
        finding(
          "error",
          "SCHEMA_UNSUPPORTED",
          "schema",
          `Unsupported repository schema ${String(version)}.`,
          "Restore a supported repository snapshot or use a compatible migrator.",
        ),
      );
    }
    return { version, setupComplete };
  } catch (error) {
    findings.push(
      finding(
        "error",
        "SCHEMA_CONFIG_INVALID",
        "schema",
        error instanceof Error ? error.message : String(error),
        "Repair config.json from a trusted repository snapshot.",
      ),
    );
    return { version: null, setupComplete: null };
  }
}

async function inspectProjectIntegrationReadiness(
  root: string,
  schema: SchemaInspection,
  findings: DoctorFinding[],
): Promise<void> {
  if (schema.version !== 5) return;
  if (schema.setupComplete === false) {
    findings.push(
      finding(
        "warning",
        "PROJECT_SETUP_INCOMPLETE",
        "integrations",
        "Repository setup is incomplete, so automatic Empirical activation is disabled.",
        "Invoke empirical-init explicitly to review and complete repository setup.",
      ),
    );
    return;
  }
  if (schema.setupComplete !== true) {
    findings.push(
      finding(
        "error",
        "PROJECT_SETUP_STATE_INVALID",
        "integrations",
        "Schema 5 config does not contain a valid setupComplete boolean.",
        "Repair .empirical/config.json from trusted state, then invoke empirical-init explicitly.",
      ),
    );
    return;
  }
  try {
    const inspection = await inspectProjectIntegrations(root);
    if (inspection.missing.length > 0) {
      findings.push(
        finding(
          "error",
          "PROJECT_INTEGRATIONS_MISSING",
          "integrations",
          `Automatic activation is not ready; required project integrations are missing: ${inspection.missing.join(", ")}.`,
          "Invoke empirical-init explicitly to reconcile project integrations, then rerun Doctor.",
        ),
      );
    }
    if (inspection.drifted.length > 0) {
      findings.push(
        finding(
          "error",
          "PROJECT_INTEGRATIONS_DRIFTED",
          "integrations",
          `Automatic activation is not ready; required project integrations are drifted or unsafe: ${inspection.drifted.join(", ")}.`,
          "Invoke empirical-init explicitly to repair Empirical-owned content. Resolve any reported unmanaged or unsafe collision, then rerun Doctor.",
        ),
      );
    }
    if (inspection.ready) {
      findings.push(
        finding(
          "ok",
          "PROJECT_INTEGRATIONS_READY",
          "integrations",
          `${inspection.required.length} required project integrations are current; automatic activation is ready.`,
        ),
      );
    }
  } catch (error) {
    findings.push(
      finding(
        "error",
        "PROJECT_INTEGRATIONS_INSPECTION_FAILED",
        "integrations",
        error instanceof Error ? error.message : String(error),
        "Inspect repository path permissions and safety, then rerun Doctor; Doctor did not change any file.",
      ),
    );
  }
}

async function inspectMigration(root: string, findings: DoctorFinding[]): Promise<void> {
  const marker = join(root, MIGRATION_MARKER_NAME);
  if (await exists(marker)) {
    findings.push(
      finding(
        "warning",
        "MIGRATION_TRANSACTION_PENDING",
        "migration",
        "A Schema-5 migration transaction marker is present.",
        "Resume the Schema-5 migrator; do not remove staged or backup directories manually.",
      ),
    );
    return;
  }
  const orphans = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => {
      const kind = migrationScratchKind(entry.name);
      return kind === "stage" || kind === "backup";
    })
    .map((entry) => entry.name)
    .sort();
  if (orphans.length > 0) {
    findings.push(
      finding(
        "warning",
        "MIGRATION_ORPHANED_SCRATCH",
        "migration",
        `Migration scratch exists without an active transaction: ${orphans.join(", ")}.`,
        "Inspect the paths and migration receipt, then move or remove only confirmed orphan scratch manually; Doctor will not change it.",
      ),
    );
  } else {
    findings.push(finding("ok", "MIGRATION_IDLE", "migration", "No migration transaction is pending."));
  }
}

async function inspectPolicy(root: string, findings: DoctorFinding[]): Promise<void> {
  const path = join(root, ".empirical", "policy.json");
  if (!(await exists(path))) {
    findings.push(
      finding(
        "error",
        "POLICY_MISSING",
        "policy",
        "Project policy is missing.",
        "Invoke the empirical skill to create strict Policy v2 defaults.",
      ),
    );
    return;
  }
  try {
    const value = await readJson<unknown>(path);
    const version = (value as { schemaVersion?: unknown }).schemaVersion;
    if (version === 1) {
      findings.push(
        finding(
          "warning",
          "POLICY_MIGRATION_REQUIRED",
          "policy",
          "Project policy still uses Schema 1.",
          "Migrate repository state to create Policy v2 without granting authority.",
        ),
      );
      return;
    }
    const policy = parsePolicy(value, root);
    findings.push(
      finding(
        "ok",
        "POLICY_VALID",
        "policy",
        `Policy v2 defines ${policy.verification.commands.length} exact verification command(s).`,
      ),
    );
  } catch (error) {
    findings.push(
      finding(
        "error",
        "POLICY_INVALID",
        "policy",
        error instanceof Error ? error.message : String(error),
        "Correct Policy v2 fields; do not weaken mandatory gates.",
      ),
    );
  }
}

async function inspectTracker(root: string, findings: DoctorFinding[]): Promise<void> {
  let policy: Awaited<ReturnType<typeof loadTrackerPolicy>> = null;
  let policyValid = true;
  try {
    policy = await loadTrackerPolicy(root);
  } catch (error) {
    policyValid = false;
    findings.push(finding(
      "error",
      "TRACKER_POLICY_INVALID",
      "tracker",
      error instanceof Error ? error.message : String(error),
      "Correct or disable .empirical/tracker.json through the empirical skill; never add credential values.",
    ));
  }
  if (policyValid && !policy) {
    findings.push(finding(
      "ok",
      "TRACKER_LOCAL_ONLY",
      "tracker",
      "External ticket tracking is not configured; workflow progress remains local-only.",
    ));
  }
  if (policy) {
    const credentialNames = Object.values(policy.credentialEnv);
    const missing = credentialNames.filter((name) => !(process.env[name]?.trim()));
    findings.push(finding(
      missing.length > 0 ? "warning" : "ok",
      missing.length > 0 ? "TRACKER_CREDENTIALS_MISSING" : "TRACKER_READY",
      "tracker",
      missing.length > 0
        ? `${policy.provider} tracking is configured, but credential environment variables are missing: ${missing.join(", ")}.`
        : `${policy.provider} tracking is configured and its credential environment variables are present.`,
      missing.length > 0
        ? "Provide the named variables through the host secret store; never write credential values to .empirical/."
        : null,
    ));
  }
  let inspected = 0;
  let invalid = false;
  for (const feature of await featureDirectories(root)) {
    try {
      const records = await inspectTrackerRecords(root, feature);
      if (records.binding || records.pending) inspected += 1;
    } catch (error) {
      invalid = true;
      findings.push(finding(
        "error",
        "TRACKER_STATE_INVALID",
        `tracker:${feature}`,
        error instanceof Error ? error.message : String(error),
        "Repair the checksummed feature tracker files from a trusted copy or explicitly rebind through the empirical skill; Doctor will not mutate them.",
      ));
      continue;
    }
    if (!policy) continue;
    const statePath = join(root, ".empirical", "specs", feature, "state.json");
    if (!(await exists(statePath))) continue;
    try {
      const state = await readJson<WorkflowState>(statePath);
      const status = await trackerStatus(root, state);
      if (status.health !== "failed") continue;
      const code = status.failure?.code ?? "TRACKER_FAILED";
      const structural = code.startsWith("INVALID_TRACKER_")
        || code === "UNSAFE_TRACKER_PATH"
        || code === "UNSAFE_SPEC_PATH"
        || code === "TRACKER_PROVIDER_MISMATCH"
        || code === "TRACKER_TARGET_MISMATCH";
      findings.push(finding(
        structural ? "error" : "warning",
        structural ? "TRACKER_STATE_INVALID" : "TRACKER_SYNC_FAILED",
        `tracker:${feature}`,
        status.failure?.summary ?? "Tracker synchronization failed without a diagnostic summary.",
        structural
          ? "Repair the checksummed feature tracker files from a trusted copy or explicitly rebind through the empirical skill."
          : "Keep local progress and retry the durable pending projection when provider access is available.",
      ));
      invalid ||= structural;
    } catch (error) {
      invalid = true;
      findings.push(finding(
        "error",
        "TRACKER_STATE_INVALID",
        `tracker:${feature}`,
        error instanceof Error ? error.message : String(error),
        "Repair the feature state or tracker files from a trusted copy; Doctor will not mutate them.",
      ));
    }
  }
  if (!invalid) {
    findings.push(finding(
      "ok",
      "TRACKER_STATE_VALID",
      "tracker",
      `${inspected} feature tracker record set${inspected === 1 ? "" : "s"} passed local validation.`,
    ));
  }
}

async function inspectKnowledge(root: string, findings: DoctorFinding[]): Promise<void> {
  try {
    const inspection = await inspectRepositoryKnowledge(root);
    if (inspection.issues.length > 0) {
      findings.push(
        finding(
          "error",
          "KNOWLEDGE_MANIFEST_INVALID",
          "knowledge",
          inspection.issues.join("; "),
          "Run explicit repository-context refresh after reviewing the manifest error.",
        ),
      );
    }
    if (inspection.missing.length > 0) {
      findings.push(
        finding(
          "warning",
          "KNOWLEDGE_PAGES_MISSING",
          "knowledge",
          `Missing context pages: ${inspection.missing.join(", ")}.`,
          "Run empirical context refresh.",
        ),
      );
    }
    if (inspection.stale.length > 0) {
      findings.push(
        finding(
          "warning",
          "KNOWLEDGE_PAGES_STALE",
          "knowledge",
          `Stale context pages: ${inspection.stale.join(", ")}.`,
          "Refresh repository context before relying on those pages.",
        ),
      );
    }
    if (inspection.refinementRequired.length > 0) {
      findings.push(
        finding(
          "warning",
          "KNOWLEDGE_REFINEMENT_REQUIRED",
          "knowledge",
          `Context pages require evidence-backed refinement: ${inspection.refinementRequired.join(", ")}.`,
          "Inspect repository evidence, replace placeholder topics, remove the managed marker, and refresh context again.",
        ),
      );
    }
    if (inspection.valid) {
      findings.push(
        finding(
          "ok",
          "KNOWLEDGE_CURRENT",
          "knowledge",
          `${inspection.fresh.length} context page(s) are source-fingerprint current.`,
        ),
      );
    }
  } catch (error) {
    findings.push(
      finding(
        "error",
        "KNOWLEDGE_INSPECTION_FAILED",
        "knowledge",
        error instanceof Error ? error.message : String(error),
        "Review context path safety and Manifest v2 before refreshing.",
      ),
    );
  }
}

async function inspectJournals(
  root: string,
  schema: number | null,
  findings: DoctorFinding[],
): Promise<void> {
  const features = await featureDirectories(root);
  if (schema !== 5) {
    findings.push(
      finding(
        "warning",
        "JOURNAL_LEGACY",
        "journal",
        `${features.length} feature histor${features.length === 1 ? "y" : "ies"} require Schema-5 chain migration.`,
        "Run Schema-5 migration before journal verification.",
      ),
    );
    return;
  }
  let checked = 0;
  for (const feature of features) {
    const statePath = join(root, ".empirical", "specs", feature, "state.json");
    if (!(await exists(statePath))) continue;
    try {
      const [state, journal] = await Promise.all([
        readJson<Record<string, JsonValue>>(statePath),
        readJournal<Record<string, JsonValue>>(
        join(root, ".empirical", "specs", feature, "events"),
        feature,
        ),
      ]);
      if (digestJson(journal.state) !== digestJson(state)) {
        throw new Error("State projection does not match the verified journal head.");
      }
      if (state.phase === "done" && state.status === "done") {
        const terminalBoundary = journal.snapshot !== null
          && journal.events.length === 1
          && journal.events[0]?.type === "compaction-boundary";
        if (!terminalBoundary) {
          findings.push(
            finding(
              "error",
              "JOURNAL_TERMINAL_UNCOMPACTED",
              `journal:${feature}`,
              "Terminal feature history has no verified snapshot and compaction boundary.",
              "Resume the trusted terminal-compaction operation; do not delete or rewrite journal events.",
            ),
          );
        }
      }
      checked += 1;
    } catch (error) {
      findings.push(
        finding(
          "error",
          "JOURNAL_CHAIN_INVALID",
          `journal:${feature}`,
          error instanceof Error ? error.message : String(error),
          "Restore the feature journal from a trusted snapshot; do not rewrite receipt history.",
        ),
      );
    }
  }
  if (!findings.some((entry) => entry.severity === "error" && entry.scope.startsWith("journal"))) {
    findings.push(
      finding("ok", "JOURNAL_CHAINS_VALID", "journal", `${checked} feature journal chain(s) validated.`),
    );
  }
}

async function findNamedFiles(root: string, pattern: RegExp): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && pattern.test(entry.name)) found.push(path);
    }
  }
  return found.sort();
}

async function inspectLocks(root: string, findings: DoctorFinding[]): Promise<void> {
  const locks = await findNamedFiles(join(root, ".empirical"), /\.lock$/);
  if (locks.length === 0) {
    findings.push(finding("ok", "LOCKS_CLEAR", "locks", "No repository-local lock files are present."));
  } else {
    findings.push(
      finding(
        "warning",
        "LOCKS_PRESENT",
        "locks",
        `Lock files present: ${locks.map((path) => relative(root, path)).join(", ")}.`,
        "Confirm the owning process and lease before using the normal retry path; do not delete live locks.",
      ),
    );
  }
}

async function inspectClaimsAndWorktrees(root: string, findings: DoctorFinding[]): Promise<void> {
  const git = toolVersion(root, "git", ["--version"]);
  if (!git) {
    findings.push(
      finding(
        "warning",
        "GIT_UNAVAILABLE",
        "toolchain",
        "Git is unavailable; claims and worktrees could not be inspected.",
        "Install Git before integration or delivery.",
      ),
    );
    return;
  }
  findings.push(finding("ok", "GIT_AVAILABLE", "toolchain", git));
  try {
    const identity = await resolveGitRepositoryIdentity(root);
    const coordinationLock = join(identity.commonDirectory, "empirical", "coordination.lock");
    if (await exists(coordinationLock)) {
      findings.push(
        finding(
          "warning",
          "COORDINATION_LOCK_PRESENT",
          "locks",
          `A shared capability-coordination lock is present at ${coordinationLock}.`,
          "Confirm the owning process before retrying coordination; Doctor will not remove the lock.",
        ),
      );
    } else {
      findings.push(finding("ok", "COORDINATION_LOCK_CLEAR", "locks", "No shared coordination lock is present."));
    }
    const claims = await inspectCapabilityClaims(root);
    if (claims.stale.length > 0) {
      findings.push(
        finding(
          "warning",
          "CAPABILITY_CLAIMS_STALE",
          "claims",
          `Stale capability claims: ${claims.stale.map((claim) => claim.id).join(", ")}.`,
          "Inspect worktree ownership and resolve claims explicitly; Doctor will not remove them.",
        ),
      );
    } else {
      findings.push(
        finding(
          "ok",
          "CAPABILITY_CLAIMS_VALID",
          "claims",
          `${claims.active.length} active and ${claims.integrated.length} integrated shared claim(s).`,
        ),
      );
    }
  } catch (error) {
    findings.push(
      finding(
        "error",
        "CAPABILITY_CLAIMS_INVALID",
        "claims",
        error instanceof Error ? error.message : String(error),
        "Repair claim metadata from a trusted receipt without deleting real worktrees.",
      ),
    );
  }
  const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 5_000,
  });
  if (worktrees.status !== 0) {
    findings.push(
      finding(
        "warning",
        "WORKTREE_INSPECTION_FAILED",
        "worktrees",
        worktrees.stderr.trim() || "Git worktree registrations could not be inspected.",
        "Run `git worktree list --porcelain` from a valid repository before integration.",
      ),
    );
  } else if (/^prunable\b/m.test(worktrees.stdout)) {
    findings.push(
      finding(
        "warning",
        "WORKTREE_REGISTRATION_PRUNABLE",
        "worktrees",
        "Git reports one or more prunable worktree registrations.",
        "Review `git worktree list --porcelain`, then prune manually only if the paths are truly abandoned.",
      ),
    );
  } else {
    findings.push(finding("ok", "WORKTREES_REGISTERED", "worktrees", "Git worktree registrations are inspectable."));
  }
}

async function inspectToolchain(root: string, findings: DoctorFinding[]): Promise<void> {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) {
    findings.push(
      finding("ok", "NODE_SUPPORTED", "toolchain", `Node ${process.versions.node} satisfies Node >=22.`),
    );
  } else {
    findings.push(
      finding(
        "error",
        "NODE_UNSUPPORTED",
        "toolchain",
        `Node ${process.versions.node} is below the supported Node 22 floor.`,
        "Use maintained Node 22, 24, or 26.",
      ),
    );
  }
  const bun = toolVersion(root, "bun", ["--version"]);
  findings.push(
    bun
      ? finding("ok", "BUN_AVAILABLE", "toolchain", `Bun ${bun} is available.`)
      : finding(
          "warning",
          "BUN_UNAVAILABLE",
          "toolchain",
          "Bun is unavailable for this repository's configured commands.",
          "Install the repository-pinned Bun version before verification.",
        ),
  );
  const gh = await executablePath("gh");
  findings.push(
    gh
      ? finding("ok", "GH_AVAILABLE", "toolchain", `GitHub CLI is available at ${gh}.`)
      : finding(
          "warning",
          "GH_UNAVAILABLE",
          "toolchain",
          "GitHub CLI is unavailable; authorized GitHub delivery cannot run.",
          "Install and authenticate `gh` through the host before delivery; do not copy credentials into policy.",
        ),
  );
}

async function inspectEvidenceAndDelivery(root: string, findings: DoctorFinding[]): Promise<void> {
  const receiptFiles = await findNamedFiles(join(root, ".empirical", "specs"), /^(?:executed|collected)-[a-z0-9-]+\.json$/);
  let validReceipts = 0;
  for (const path of receiptFiles) {
    try {
      verifyReceiptDigest(await readJson<EvidenceReceipt>(path));
      validReceipts += 1;
    } catch (error) {
      findings.push(
        finding(
          "error",
          "EVIDENCE_RECEIPT_INVALID",
          `evidence:${relative(root, path)}`,
          error instanceof Error ? error.message : String(error),
          "Re-run the exact evidence command or recollect the artifact; do not edit receipts.",
        ),
      );
    }
  }
  findings.push(
    finding("ok", "EVIDENCE_RECEIPTS_INSPECTED", "evidence", `${validReceipts} immutable receipt(s) passed digest validation.`),
  );
  for (const feature of await featureDirectories(root)) {
    const directory = join(root, ".empirical", "specs", feature);
    const integrationPath = join(directory, "integration-receipt.json");
    if (await exists(integrationPath)) {
      try {
        verifyStoredIntegrationReceipt(await readJson<unknown>(integrationPath));
      } catch (error) {
        findings.push(
          finding(
            "error",
            "INTEGRATION_RECEIPT_INVALID",
            `integration:${feature}`,
            error instanceof Error ? error.message : String(error),
            "Re-run integration from the preserved claim and target; do not edit the receipt.",
          ),
        );
      }
    }
    const deliveryPath = join(directory, "delivery-receipt.json");
    if (await exists(deliveryPath)) {
      try {
        verifyDeliveryReceipt(await readJson<GitHubDeliveryReceipt>(deliveryPath));
      } catch (error) {
        findings.push(
          finding(
            "error",
            "DELIVERY_RECEIPT_INVALID",
            `delivery:${feature}`,
            error instanceof Error ? error.message : String(error),
            "Query GitHub remote state and resume the delivery state machine.",
          ),
        );
      }
    }
  }
}

export async function doctorRepository(rootInput: string): Promise<DoctorReport> {
  const root = resolve(rootInput);
  const findings: DoctorFinding[] = [];
  const schema = await inspectSchema(root, findings);
  await inspectProjectIntegrationReadiness(root, schema, findings);
  await inspectMigration(root, findings);
  await inspectPolicy(root, findings);
  await inspectTracker(root, findings);
  await inspectKnowledge(root, findings);
  await inspectJournals(root, schema.version, findings);
  await inspectLocks(root, findings);
  await inspectToolchain(root, findings);
  await inspectClaimsAndWorktrees(root, findings);
  await inspectEvidenceAndDelivery(root, findings);
  findings.sort((left, right) =>
    left.scope.localeCompare(right.scope) || left.code.localeCompare(right.code),
  );
  return {
    schemaVersion: 1,
    root,
    status: findings.some((entry) => entry.severity === "error")
      ? "errors"
      : findings.some((entry) => entry.severity === "warning")
        ? "warnings"
        : "healthy",
    readonly: true,
    findings,
  };
}
