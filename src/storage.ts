import { chmod, lstat, open, readFile, readdir, rename, rm, rmdir, stat, mkdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { EmpiricalError } from "./errors.js";
import { deriveCompletion, digestJson, type JsonValue } from "./protocol.js";
import { appendJournalEvent, compactJournal, readJournal, recoverCompaction } from "./journal.js";
import { migrateSchema4To5 } from "./migration.js";
import { defaultPolicy, parsePolicy } from "./policy.js";
import { readCheckoutSelection, writeCheckoutSelection } from "./checkouts.js";
import {
  SCHEMA_VERSION,
  type ProjectPolicy,
  type Profile,
  type ProjectConfig,
  type WorkflowState,
} from "./types.js";

const EMPIRICAL_DIR = ".empirical";
const LOCK_STALE_AFTER_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

interface LockSnapshot {
  dev: number;
  ino: number;
  mtimeMs: number;
  token: string | null;
  pid: number | null;
}

export class ProjectStore {
  readonly root: string;
  readonly feature: string | null;

  constructor(root: string, feature: string | null = null) {
    this.root = resolve(root);
    if (feature !== null) assertFeatureId(feature);
    this.feature = feature;
  }

  get directory(): string {
    return join(this.root, EMPIRICAL_DIR);
  }

  get configPath(): string {
    return join(this.directory, "config.json");
  }

  get policyPath(): string {
    return join(this.directory, "policy.json");
  }

  get stateDirectory(): string {
    return this.specDirectory(this.requireFeature());
  }

  get statePath(): string {
    return join(this.stateDirectory, "state.json");
  }

  get eventsDirectory(): string {
    return join(this.stateDirectory, "events");
  }

  get capabilitiesDirectory(): string {
    return join(this.directory, "capabilities");
  }

  forFeature(feature: string): ProjectStore {
    return new ProjectStore(this.root, feature);
  }

  capabilityDirectory(capability: string): string {
    assertCapabilityId(capability);
    return join(this.capabilitiesDirectory, capability);
  }

  capabilitySpecPath(capability: string): string {
    return join(this.capabilityDirectory(capability), "spec.md");
  }

  specDirectory(feature: string): string {
    assertFeatureId(feature);
    return join(this.directory, "specs", feature);
  }

  specPath(feature: string): string {
    return join(this.specDirectory(feature), "spec.md");
  }

  evidencePath(feature: string): string {
    return join(this.specDirectory(feature), "evidence.json");
  }

  deltaDirectory(feature: string): string {
    return join(this.specDirectory(feature), "deltas");
  }

  async exists(): Promise<boolean> {
    return isFile(this.configPath);
  }

  async ensureLayout(): Promise<void> {
    await this.assertProjectPathSafe();
    if (this.feature) {
      await this.assertFeaturePathSafe(this.feature, [this.statePath, this.eventsDirectory]);
    }
    await mkdir(join(this.directory, "specs"), { recursive: true });
    await mkdir(this.capabilitiesDirectory, { recursive: true });
    if (this.feature) await mkdir(this.eventsDirectory, { recursive: true });
  }

  async loadPolicy(): Promise<ProjectPolicy> {
    if (!(await isFile(this.policyPath))) return defaultPolicy();
    try {
      return parsePolicy(await readJson<unknown>(this.policyPath, "INVALID_POLICY"), this.root) as ProjectPolicy;
    } catch (error) {
      throw new EmpiricalError(
        "INVALID_POLICY",
        `Could not validate strict Policy v2 at ${this.policyPath}`,
        error,
      );
    }
  }

  async writePolicy(policy: ProjectPolicy): Promise<void> {
    await this.withResourceLock("policy", async () => {
      await writeJsonAtomic(this.policyPath, parsePolicy(policy, this.root));
    });
  }

  async loadConfig(): Promise<ProjectConfig> {
    const config = await readJson<ProjectConfig>(this.configPath, "PROJECT_NOT_INITIALIZED");
    return normalizeConfig(config);
  }

  async loadState(recover = true): Promise<WorkflowState> {
    if (!this.feature) {
      const active = await this.activeFeature(recover);
      if (active) return this.forFeature(active).loadState(recover);
      const config = await this.loadConfig();
      return idleState(config.profile);
    }
    await this.assertFeaturePathSafe(this.feature, [this.statePath, this.eventsDirectory]);
    const projected = normalizeState(
      await readJson<WorkflowState>(this.statePath, "PROJECT_NOT_INITIALIZED"),
    );
    const journal = await this.latestJournalState();
    if (journal && journal.revision > projected.revision) {
      if (recover) await writeJsonAtomic(this.statePath, journal);
      return journal;
    }
    return projected;
  }

  async writeConfig(config: ProjectConfig): Promise<void> {
    await this.ensureLayout();
    await writeJsonAtomic(this.configPath, normalizeConfig(config));
    await this.ensureProjectMetadata();
  }

  async writeInitial(config: ProjectConfig): Promise<void> {
    await this.writeConfig(config);
  }

  async writeInitialFeature(state: WorkflowState, actor = "empirical-start", summary?: string): Promise<void> {
    if (!this.feature) throw new EmpiricalError("FEATURE_REQUIRED", "Feature-scoped state needs a feature store");
    if (await isFile(this.statePath)) {
      throw new EmpiricalError("FEATURE_EXISTS", `Feature ${this.feature} already has workflow state`);
    }
    await this.ensureLayout();
    await this.commitInitialState(state, actor, summary ?? `Started ${this.feature}`);
    if (state.phase === "done" && state.status === "done") {
      await this.compactTerminalJournal(actor);
      await writeCheckoutSelection(this.root, null);
    } else {
      await writeCheckoutSelection(this.root, this.feature);
    }
  }

  async configure(update: Partial<ProjectConfig>): Promise<ProjectConfig> {
    return this.withResourceLock("policy", async () => {
      const current = await this.loadConfig();
      const next = normalizeConfig({
        ...current,
        ...update,
        evidence: { ...current.evidence, ...update.evidence },
        isolation: { ...current.isolation, ...update.isolation },
        decisions: { ...current.decisions, ...update.decisions },
      } as ProjectConfig);
      await writeJsonAtomic(this.configPath, next);
      return next;
    });
  }

  async activeFeature(recover = true): Promise<string | null> {
    const active: string[] = [];
    for (const feature of await this.listFeatureIds()) {
      const scoped = this.forFeature(feature);
      await scoped.assertFeaturePathSafe(feature, [scoped.statePath, scoped.eventsDirectory]);
      if (!(await isFile(scoped.statePath))) continue;
      const state = await scoped.loadState(recover);
      if (
        state.phase !== "done"
        && (state.status === "waiting" || state.status === "awaiting_human" || state.status === "blocked")
      ) {
        active.push(feature);
      }
    }
    const checkout = await readCheckoutSelection(this.root);
    if (checkout.feature) {
      if (!active.includes(checkout.feature)) {
        if (recover) await writeCheckoutSelection(this.root, null);
      } else {
        if (checkout.claimedElsewhere.has(checkout.feature)) {
          throw new EmpiricalError(
            "FEATURE_CLAIMED_BY_MULTIPLE_CHECKOUTS",
            `Feature ${checkout.feature} is selected by more than one checkout`,
          );
        }
        return checkout.feature;
      }
    }

    const available = active.filter((feature) => !checkout.claimedElsewhere.has(feature));
    if (available.length > 1) {
      throw new EmpiricalError(
        "MULTIPLE_ACTIVE_FEATURES",
        `This checkout has multiple unclaimed active features: ${available.join(", ")}`,
        { features: available },
      );
    }
    const feature = available[0] ?? null;
    if (feature && recover) await writeCheckoutSelection(this.root, feature);
    return feature;
  }

  async listFeatureIds(): Promise<string[]> {
    const directory = join(this.directory, "specs");
    if (await isSymbolicLink(directory)) {
      throw new EmpiricalError("UNSAFE_SPEC_PATH", `Feature storage cannot use symbolic links: ${directory}`);
    }
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const unsafe = entries.find((entry) => entry.isSymbolicLink() && isFeatureId(entry.name));
    if (unsafe) {
      throw new EmpiricalError(
        "UNSAFE_SPEC_PATH",
        `Feature storage cannot use symbolic links: ${join(directory, unsafe.name)}`,
      );
    }
    return entries
      .filter((entry) => entry.isDirectory() && isFeatureId(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  async transition(
    expectedRevision: number,
    actor: string,
    summary: string,
    mutate: (state: WorkflowState) => WorkflowState,
  ): Promise<WorkflowState> {
    const committed = await this.transaction(async (current) => {
      if (current.revision !== expectedRevision) {
        throw new EmpiricalError(
          "STALE_REVISION",
          `Expected revision ${expectedRevision}, but the project is at ${current.revision}`,
          { expectedRevision, actualRevision: current.revision },
        );
      }
      return {
        actor,
        summary,
        state: mutate(structuredClone(current)),
        value: undefined,
      };
    });
    return committed.state;
  }

  async transaction<T>(
    prepare: (current: WorkflowState) => Promise<{
      actor: string;
      summary: string;
      state: WorkflowState;
      value: T;
      validate?: () => Promise<void>;
      effect?: () => Promise<() => Promise<void>>;
    }>,
  ): Promise<{ state: WorkflowState; value: T }> {
    this.requireFeature();
    await this.ensureProjectMetadata();
    return this.withLock(async () => {
      const current = await this.loadState();
      const prepared = await prepare(structuredClone(current));
      const now = new Date().toISOString();
      const next = prepared.state;
      next.schemaVersion = SCHEMA_VERSION;
      next.revision = current.revision + 1;
      next.updatedAt = now;
      await this.ensureCurrentConfigSchema();
      await prepared.validate?.();
      let rollback: (() => Promise<void>) | undefined;
      let eventWritten = false;
      try {
        rollback = await prepared.effect?.();
        if (next.phase === "done" && next.status === "done") {
          await writeCheckoutSelection(this.root, null);
        }
        const event = await appendJournalEvent({
          directory: this.eventsDirectory,
          feature: this.requireFeature(),
          actor: prepared.actor,
          summary: prepared.summary,
          state: next as unknown as import("./protocol.js").JsonValue,
          now: () => new Date(now),
        });
        eventWritten = true;
        await writeJsonAtomic(this.statePath, next);
        return { state: next, value: prepared.value };
      } catch (error) {
        if (eventWritten) {
          try {
            const latest = await readJournal(
              this.eventsDirectory,
              this.requireFeature(),
            );
            await rm(this.eventPath(latest.lastSequence), { force: true });
          } catch (cleanupError) {
            throw new EmpiricalError(
              "TRANSACTION_RECOVERY_REQUIRED",
              "The transition event committed but its state projection failed; the next read will recover it",
              { error: errorMessage(error), cleanupError: errorMessage(cleanupError) },
            );
          }
        }
        if (rollback) {
          try {
            await rollback();
          } catch (rollbackError) {
            throw new EmpiricalError(
              "TRANSACTION_ROLLBACK_FAILED",
              "The state transition failed and its external effect could not be fully rolled back",
              { error: errorMessage(error), rollbackError: errorMessage(rollbackError) },
            );
          }
        }
        throw error;
      }
    });
  }

  async compactTerminalJournal(actor = "empirical-compaction"): Promise<void> {
    this.requireFeature();
    await this.withLock(async () => {
      await recoverCompaction<JsonValue>(this.eventsDirectory);
      const state = await this.loadState();
      if (state.phase !== "done" || state.status !== "done") {
        throw new EmpiricalError(
          "COMPACTION_NOT_READY",
          "Only a terminal workflow journal can be compacted",
        );
      }
      const journal = await readJournal<JsonValue>(
        this.eventsDirectory,
        this.requireFeature(),
      );
      const alreadyCompacted = journal.snapshot !== null
        && journal.snapshot.stateDigest === journal.events.at(-1)?.stateAfterDigest
        && journal.snapshot.stateDigest === digestJson(state)
        && journal.events.length === 1
        && journal.events[0]?.type === "compaction-boundary";
      if (alreadyCompacted) return;
      await compactJournal<JsonValue>({
        directory: this.eventsDirectory,
        feature: this.requireFeature(),
        actor,
      });
    });
  }

  async migrateSchema(): Promise<Record<string, unknown>> {
    const project = new ProjectStore(this.root);
    const rawVersion = schemaVersion(
      await readJson<ProjectConfig>(project.configPath, "PROJECT_NOT_INITIALIZED"),
    );
    if (rawVersion === 4) {
      return { ...(await migrateSchema4To5(this.root)) };
    }
    if (rawVersion !== SCHEMA_VERSION) {
      throw new EmpiricalError(
        "MIGRATION_REQUIRED",
        `Schema ${rawVersion} is unsupported; Empirical 0.25 migrates only Schema 4 to Schema 5`,
      );
    }
    await project.ensureProjectMetadata();
    return project.withResourceLock("specs", async () => {
      const legacyStatePath = join(project.directory, "state.json");
      const legacyEvents = join(project.directory, "events");
      if (await pathExists(legacyStatePath) || await pathExists(legacyEvents)) {
        throw new EmpiricalError(
          "MIGRATION_CONFLICT",
          "Schema 5 cannot contain legacy root workflow state; restore the Schema-4 backup and rerun the atomic migrator",
        );
      }
      for (const feature of await project.listFeatureIds()) {
        const scoped = project.forFeature(feature);
        await scoped.assertFeaturePathSafe(feature, [scoped.statePath, scoped.eventsDirectory]);
        if (!(await isFile(scoped.statePath))) continue;
        const raw = await readJson<WorkflowState>(scoped.statePath, "PROJECT_NOT_INITIALIZED");
        if (raw.schemaVersion !== SCHEMA_VERSION) {
          throw new EmpiricalError(
            "MIGRATION_CONFLICT",
            `Schema-5 project contains mixed feature state for ${feature}`,
          );
        }
        await scoped.latestJournalState();
      }
      return {
        changed: false,
        from: { config: SCHEMA_VERSION, state: SCHEMA_VERSION },
        to: SCHEMA_VERSION,
        migratedFeature: null,
      };
    });
  }

  async writeSpec(feature: string, contents: string): Promise<void> {
    const path = this.specPath(feature);
    await this.assertFeaturePathSafe(feature, [path]);
    await mkdir(dirname(path), { recursive: true });
    await writeTextAtomic(path, contents);
  }

  async readSpec(feature: string): Promise<string> {
    await this.assertFeaturePathSafe(feature, [this.specPath(feature)]);
    try {
      return await readFile(this.specPath(feature), "utf8");
    } catch (error) {
      throw new EmpiricalError("SPEC_NOT_FOUND", `Missing specification for ${feature}`, error);
    }
  }

  async writeEvidence(feature: string, evidence: unknown): Promise<void> {
    await this.assertFeaturePathSafe(feature, [this.evidencePath(feature)]);
    await writeJsonAtomic(this.evidencePath(feature), evidence);
  }

  async readEvidence<T>(feature: string): Promise<T[]> {
    await this.assertFeaturePathSafe(feature, [this.evidencePath(feature)]);
    if (!(await isFile(this.evidencePath(feature)))) return [];
    return readJson<T[]>(this.evidencePath(feature), "INVALID_EVIDENCE");
  }

  async listCapabilityNames(): Promise<string[]> {
    await this.assertCapabilityPathSafe();
    let entries: Dirent[];
    try {
      entries = await readdir(this.capabilitiesDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isDirectory() && isCapabilityId(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  async readCapability(capability: string): Promise<string | null> {
    await this.assertCapabilityPathSafe(capability);
    const path = this.capabilitySpecPath(capability);
    return await isFile(path) ? readFile(path, "utf8") : null;
  }

  async writeCapability(capability: string, contents: string): Promise<void> {
    await this.assertCapabilityPathSafe(capability);
    await writeTextAtomic(this.capabilitySpecPath(capability), contents);
  }

  async removeCapability(capability: string): Promise<void> {
    await this.assertCapabilityPathSafe(capability);
    await rm(this.capabilitySpecPath(capability), { force: true });
    await rmdir(this.capabilityDirectory(capability)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
    });
  }

  async withResourceLock<T>(resource: "specs" | "capabilities" | "policy", operation: () => Promise<T>): Promise<T> {
    return withFileLock(join(this.directory, `${resource}.lock`), operation);
  }

  async assertCurrentSchemaReadOnly(): Promise<void> {
    await this.assertProjectPathSafe();
    const config = await readJson<ProjectConfig>(this.configPath, "PROJECT_NOT_INITIALIZED");
    if (config.schemaVersion !== SCHEMA_VERSION || await pathExists(join(this.directory, "state.json")) || await pathExists(join(this.directory, "events"))) {
      throw new EmpiricalError(
        "MIGRATION_REQUIRED",
        "This read-only operation requires Schema 5; migrate through an installed Empirical agent skill first",
      );
    }
    for (const feature of await this.listFeatureIds()) {
      const scoped = this.forFeature(feature);
      if (!(await isFile(scoped.statePath))) continue;
      const state = await readJson<WorkflowState>(scoped.statePath, "PROJECT_NOT_INITIALIZED");
      if (state.schemaVersion !== SCHEMA_VERSION) {
        throw new EmpiricalError(
          "MIGRATION_REQUIRED",
          `Read-only access found mixed Schema-${String(state.schemaVersion)} state for ${feature}`,
        );
      }
      await scoped.latestJournalState();
    }
  }

  private eventPath(revision: number): string {
    return join(this.eventsDirectory, `${String(revision).padStart(8, "0")}.json`);
  }

  private async latestJournalState(): Promise<WorkflowState | null> {
    try {
      const journal = await readJournal<import("./protocol.js").JsonValue>(
        this.eventsDirectory,
        this.requireFeature(),
      );
      return journal.state
        ? normalizeState(journal.state as unknown as WorkflowState)
        : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new EmpiricalError(
        "INVALID_EVENT",
        `Could not verify ${this.eventsDirectory}`,
        error,
      );
    }
  }

  private async commitInitialState(
    state: WorkflowState,
    actor: string,
    summary: string,
  ): Promise<void> {
    await appendJournalEvent({
      directory: this.eventsDirectory,
      feature: this.requireFeature(),
      actor,
      summary,
      state: state as unknown as import("./protocol.js").JsonValue,
      now: () => new Date(state.updatedAt),
    });
    await writeJsonAtomic(this.statePath, state);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withFileLock(join(this.stateDirectory, "state.lock"), operation);
  }

  private requireFeature(): string {
    if (!this.feature) {
      throw new EmpiricalError("FEATURE_REQUIRED", "This operation requires a feature-scoped store");
    }
    return this.feature;
  }

  private async assertCapabilityPathSafe(capability?: string): Promise<void> {
    const paths = [
      this.capabilitiesDirectory,
      ...(capability
        ? [this.capabilityDirectory(capability), this.capabilitySpecPath(capability)]
        : []),
    ];
    for (const path of paths) {
      if (await isSymbolicLink(path)) {
        throw new EmpiricalError(
          "UNSAFE_CAPABILITY_PATH",
          `Capability storage cannot use symbolic links: ${path}`,
        );
      }
    }
  }

  async assertFeaturePathSafe(feature: string, additional: string[] = []): Promise<void> {
    assertFeatureId(feature);
    const paths = [
      this.directory,
      join(this.directory, "specs"),
      this.specDirectory(feature),
      ...additional,
    ];
    for (const path of paths) {
      if (await isSymbolicLink(path)) {
        throw new EmpiricalError(
          "UNSAFE_SPEC_PATH",
          `Feature storage cannot use symbolic links: ${path}`,
        );
      }
    }
  }

  private async assertProjectPathSafe(): Promise<void> {
    const paths = [
      this.directory,
      join(this.directory, "specs"),
      this.capabilitiesDirectory,
      this.configPath,
      this.policyPath,
    ];
    for (const path of paths) {
      if (await isSymbolicLink(path)) {
        throw new EmpiricalError("UNSAFE_PROJECT_PATH", `Empirical storage cannot use symbolic links: ${path}`);
      }
    }
  }

  private async ensureProjectMetadata(): Promise<void> {
    await this.assertProjectPathSafe();
    await mkdir(this.directory, { recursive: true });
    if (!(await isFile(this.policyPath))) {
      await this.withResourceLock("policy", async () => {
        if (!(await isFile(this.policyPath))) await writeJsonAtomic(this.policyPath, defaultPolicy());
      });
    }
  }

  private async ensureCurrentConfigSchema(): Promise<void> {
    const raw = await readJson<ProjectConfig>(this.configPath, "PROJECT_NOT_INITIALIZED");
    schemaVersion(raw);
    const normalized = normalizeConfig(raw);
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      await writeJsonAtomic(this.configPath, normalized);
    }
  }
}

async function withFileLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  const token = randomUUID();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let lastError: unknown;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, token })}\n`, "utf8");
      await handle.sync();
      break;
    } catch (error) {
      lastError = error;
      if (handle) {
        const incomplete = handle;
        handle = undefined;
        const details = await incomplete.stat().catch(() => null);
        const observed = details
          ? await inspectLock(lockPath).catch(() => null)
          : null;
        await incomplete.close().catch(() => undefined);
        if (details && observed && details.dev === observed.dev && details.ino === observed.ino) {
          await removeLockIfUnchanged(lockPath, observed);
        }
        throw error;
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (!isRetryableLockOpenError(error)) throw error;
      if (code === "EEXIST") {
        try {
          const observed = await inspectLock(lockPath);
          if (
            observed
            && Date.now() - observed.mtimeMs > LOCK_STALE_AFTER_MS
            && (observed.pid === null || !processIsAlive(observed.pid))
            && await recoverStaleLock(lockPath, observed)
          ) {
            continue;
          }
        } catch {
          // The lock changed while it was inspected; retry through the same bounded wait.
        }
      }
      if (Date.now() >= deadline) {
        throw new EmpiricalError(
          "PROJECT_BUSY",
          "Another Empirical client is updating this repository; retry shortly",
          lastError,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    void handle?.utimes(now, now).catch(() => undefined);
  }, LOCK_STALE_AFTER_MS / 3);
  heartbeat.unref();
  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
    const owned = await handle.stat().catch(() => null);
    await handle.close();
    if (owned) {
      await removeLockIfUnchanged(lockPath, {
        dev: owned.dev,
        ino: owned.ino,
        mtimeMs: owned.mtimeMs,
        token,
        pid: process.pid,
      });
    }
  }
}

export async function withOwnedFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withFileLock(lockPath, operation);
}

export function isRetryableLockOpenError(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EEXIST"
    || (platform === "win32" && (code === "EPERM" || code === "EACCES"));
}

async function inspectLock(path: string): Promise<LockSnapshot | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const details = await handle.stat();
    const raw = await handle.readFile("utf8");
    let token: string | null = null;
    let pid: number | null = null;
    try {
      const owner = JSON.parse(raw) as { token?: unknown; pid?: unknown };
      if (typeof owner.token === "string") token = owner.token;
      if (typeof owner.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        pid = owner.pid;
      }
    } catch {
      // Old lock files had no ownership payload and are recoverable only after they become stale.
    }
    return { dev: details.dev, ino: details.ino, mtimeMs: details.mtimeMs, token, pid };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function removeLockIfUnchanged(path: string, expected: LockSnapshot): Promise<boolean> {
  const current = await inspectLock(path);
  if (!current || !sameLock(current, expected)) return false;
  await rm(path, { force: true });
  return true;
}

async function recoverStaleLock(path: string, expected: LockSnapshot): Promise<boolean> {
  const recoveryPath = `${path}.recovery`;
  const recoveryToken = randomUUID();
  let recoveryHandle: Awaited<ReturnType<typeof open>>;
  try {
    recoveryHandle = await open(recoveryPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const abandoned = await inspectLock(recoveryPath);
      if (
        abandoned
        && Date.now() - abandoned.mtimeMs > LOCK_STALE_AFTER_MS
        && (abandoned.pid === null || !processIsAlive(abandoned.pid))
      ) {
        await removeLockIfUnchanged(recoveryPath, abandoned);
      }
      return false;
    }
    throw error;
  }

  let recoveryOwner: LockSnapshot | null = null;
  try {
    await recoveryHandle.writeFile(
      `${JSON.stringify({ pid: process.pid, token: recoveryToken })}\n`,
      "utf8",
    );
    await recoveryHandle.sync();
    const details = await recoveryHandle.stat();
    recoveryOwner = {
      dev: details.dev,
      ino: details.ino,
      mtimeMs: details.mtimeMs,
      token: recoveryToken,
      pid: process.pid,
    };

    const current = await inspectLock(path);
    if (
      !current
      || !sameLock(current, expected)
      || Date.now() - current.mtimeMs <= LOCK_STALE_AFTER_MS
      || (current.pid !== null && processIsAlive(current.pid))
    ) {
      return false;
    }
    await rm(path, { force: true });
    return true;
  } finally {
    await recoveryHandle.close().catch(() => undefined);
    if (recoveryOwner) await removeLockIfUnchanged(recoveryPath, recoveryOwner);
    else await rm(recoveryPath, { force: true });
  }
}

function sameLock(left: LockSnapshot, right: LockSnapshot): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.token === right.token
    && left.pid === right.pid;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function discoverProject(start: string): Promise<ProjectStore> {
  let current = resolve(start);
  while (true) {
    const store = new ProjectStore(current);
    if (await store.exists()) return store;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new EmpiricalError(
    "PROJECT_NOT_INITIALIZED",
    "No .empirical project found; initialize or adopt it through an installed Empirical agent skill",
  );
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const existingMode = await stat(path).then(
    (details) => details.mode & 0o7777,
    () => null,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx", existingMode ?? 0o600);
    await handle.writeFile(contents, "utf8");
    if (existingMode !== null) await chmod(temporary, existingMode);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (process.platform === "win32" && ["EISDIR", "EPERM", "EACCES"].includes(String((error as NodeJS.ErrnoException).code))) return;
    throw error;
  }
  try {
    await handle.sync().catch((error: NodeJS.ErrnoException) => {
      if (process.platform === "win32" && ["EINVAL", "ENOTSUP", "EBADF", "EPERM"].includes(String(error.code))) return;
      throw error;
    });
  } finally {
    await handle.close();
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readJson<T>(path: string, code = "INVALID_JSON"): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new EmpiricalError(code, `Could not read ${path}`, error);
  }
}

export function assertFeatureId(feature: string): void {
  if (!isFeatureId(feature)) {
    throw new EmpiricalError("INVALID_FEATURE", `Invalid feature id: ${feature}`);
  }
}

function isFeatureId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value) && value.length <= 80;
}

export function assertCapabilityId(capability: string): void {
  if (!isCapabilityId(capability)) {
    throw new EmpiricalError(
      "INVALID_CAPABILITY",
      `Invalid capability '${capability}'; use lowercase kebab-case`,
    );
  }
}

function isCapabilityId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConfig(config: ProjectConfig): ProjectConfig {
  assertSupportedSchema(config);
  const value = config as unknown as Record<string, unknown>;
  const isolation = isRecord(value.isolation) ? value.isolation : {};
  const decisions = isRecord(value.decisions) ? value.decisions : {};
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const mode = isolation.mode === "off" ? "off" : "ask";
  const baseBranch = typeof isolation.baseBranch === "string" && isolation.baseBranch.trim()
    ? isolation.baseBranch.trim()
    : "auto";
  const worktreePath = typeof isolation.worktreePath === "string" && isolation.worktreePath.trim()
    ? isolation.worktreePath.trim()
    : "../{repo}-{feature}";
  const branchPattern = typeof isolation.branchPattern === "string" && isolation.branchPattern.trim()
    ? isolation.branchPattern.trim()
    : "{type}/{feature}";
  validateWorktreeTemplates(worktreePath, branchPattern);
  return {
    ...config,
    schemaVersion: SCHEMA_VERSION,
    profile: normalizeProfile((config as { profile?: unknown }).profile),
    evidence: {
      required: typeof evidence.required === "boolean" ? evidence.required : true,
      browserForUi: typeof evidence.browserForUi === "boolean" ? evidence.browserForUi : true,
      screenshotForUi: typeof evidence.screenshotForUi === "boolean" ? evidence.screenshotForUi : true,
      codeReview: typeof evidence.codeReview === "boolean" ? evidence.codeReview : true,
    },
    isolation: { mode, baseBranch, worktreePath, branchPattern },
    decisions: { complexRecords: decisions.complexRecords === "off" ? "off" : "required" },
    setupComplete: typeof value.setupComplete === "boolean" ? value.setupComplete : false,
  };
}

function normalizeState(state: WorkflowState): WorkflowState {
  assertSupportedSchema(state);
  const persistedCompletion: Record<string, unknown> = isRecord(state.completion)
    ? state.completion
    : {};
  const completion = deriveCompletion({
    implemented: persistedCompletion.implemented === true,
    verified: persistedCompletion.verified === true,
    integrated: persistedCompletion.integrated === true,
    delivered: persistedCompletion.delivered === true,
    published: persistedCompletion.published === true,
  });
  return {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    profile: normalizeProfile((state as { profile?: unknown }).profile),
    workflow: state.workflow === "complex" || state.profile === "complex" ? "complex" : "fast",
    phase: state.phase === "archive" ? "integrate" : state.phase,
    mode: state.mode === "yolo" ? "yolo" : "normal",
    specDigest: typeof state.specDigest === "string" ? state.specDigest : null,
    approvedSpecRevision: Number.isSafeInteger(state.approvedSpecRevision)
      ? state.approvedSpecRevision
      : null,
    capabilityArchiveRequired: typeof state.capabilityArchiveRequired === "boolean"
      ? state.capabilityArchiveRequired
      : false,
    capabilityDeltaDigest: typeof state.capabilityDeltaDigest === "string"
      ? state.capabilityDeltaDigest
      : null,
    impactDigest: typeof state.impactDigest === "string" ? state.impactDigest : null,
    capabilityClaimId: typeof state.capabilityClaimId === "string"
      ? state.capabilityClaimId
      : null,
    authorizationDigest: typeof state.authorizationDigest === "string"
      ? state.authorizationDigest
      : null,
    evidence: Array.isArray(state.evidence) ? state.evidence : [],
    evidenceReceiptIds: Array.isArray(state.evidenceReceiptIds)
      ? state.evidenceReceiptIds
      : [],
    legacyEvidenceCount: Number.isSafeInteger(state.legacyEvidenceCount)
      ? state.legacyEvidenceCount
      : Array.isArray(state.evidence)
        ? state.evidence.length
        : 0,
    completion,
  };
}

function validateWorktreeTemplates(worktreePath: string, branchPattern: string): void {
  if (!worktreePath.includes("{feature}")) {
    throw new EmpiricalError("INVALID_CONFIG", "Worktree path template must contain {feature}");
  }
  if (!branchPattern.includes("{feature}") || !branchPattern.includes("{type}")) {
    throw new EmpiricalError("INVALID_CONFIG", "Branch pattern must contain {type} and {feature}");
  }
  const allowed = (value: string) => value.replaceAll("{repo}", "").replaceAll("{feature}", "").replaceAll("{type}", "");
  if (/[\0\r\n]/.test(worktreePath) || /[\0\r\n]/.test(branchPattern) || /[{}]/.test(allowed(worktreePath)) || /[{}]/.test(allowed(branchPattern))) {
    throw new EmpiricalError("INVALID_CONFIG", "Worktree templates contain unsupported placeholders or control characters");
  }
}

function idleState(profile: Profile): WorkflowState {
  const workflow = profile === "complex" ? "complex" : "fast";
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    activeFeature: null,
    request: null,
    profile,
    workflow,
    mode: "normal",
    phase: "idle",
    status: "idle",
    repairAttempts: 0,
    message: null,
    implementationActor: null,
    specDigest: null,
    approvedSpecRevision: null,
    capabilityArchiveRequired: false,
    capabilityDeltaDigest: null,
    impactDigest: null,
    capabilityClaimId: null,
    authorizationDigest: null,
    evidence: [],
    evidenceReceiptIds: [],
    legacyEvidenceCount: 0,
    completion: deriveCompletion({
      implemented: false,
      verified: false,
      integrated: false,
      delivered: false,
      published: false,
    }),
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeProfile(profile: unknown): Profile {
  if (profile === "strong") return "complex";
  if (profile === "fast" || profile === "complex" || profile === "quick") return profile;
  throw new EmpiricalError("INVALID_PROFILE", `Unknown persisted workflow '${String(profile)}'`);
}

function assertSupportedSchema(value: { schemaVersion: number }): void {
  if (
    value.schemaVersion !== 4
    && value.schemaVersion !== SCHEMA_VERSION
  ) {
    throw new EmpiricalError(
      "MIGRATION_REQUIRED",
      `Project schema ${String(value.schemaVersion)} is not supported; migrate it through an installed Empirical agent skill`,
    );
  }
}

function schemaVersion(value: { schemaVersion: number }): number {
  assertSupportedSchema(value);
  return value.schemaVersion;
}
