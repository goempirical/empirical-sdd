import { randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { digestJson, sha256 } from "./protocol.js";
import { executeCommandCaptured, type ProcessAdapter } from "./runtime.js";
import {
  captureCapabilityBase,
  parseCapabilityDelta,
  replayCapabilityDeltas,
  type CapabilityBaseSnapshot,
  type CapabilityReplayResult,
} from "./specifications.js";
import type { CapabilityDelta } from "./types.js";

export interface GitRepositoryIdentity {
  root: string;
  commonDirectory: string;
  headCommit: string;
  headTree: string;
  repositoryId: string;
  worktreeId: string;
}

export interface CapabilityClaim {
  schemaVersion: 1;
  id: string;
  repositoryId: string;
  feature: string;
  worktree: string;
  worktreeId: string;
  baseCommit: string;
  baseTree: string;
  bases: Record<string, CapabilityBaseSnapshot>;
  capabilities: string[];
  status: "active" | "integrated";
  integrationReceiptDigest: string | null;
  createdAt: string;
  heartbeatAt: string;
  digest: string;
}

export interface ClaimInspection {
  active: CapabilityClaim[];
  stale: CapabilityClaim[];
  integrated: CapabilityClaim[];
}

export interface IntegrationReceipt {
  schemaVersion: 1;
  feature: string;
  claimId: string;
  repositoryId: string;
  baseCommit: string;
  baseTree: string;
  featureTree: string;
  targetCommit: string;
  targetTree: string;
  capabilityBaseDigests: Record<string, string>;
  deltaDigest: string;
  resultDigests: Record<string, string>;
  verificationReceiptDigests: string[];
  integratedAt: string;
  digest: string;
}

export interface NonBehavioralIntegrationReceipt {
  schemaVersion: 1;
  classification: "non-behavioral";
  feature: string;
  claimId: null;
  repositoryId: string;
  featureTree: string;
  targetCommit: string;
  targetTree: string;
  verificationReceiptDigests: string[];
  integratedAt: string;
  digest: string;
}

export type StoredIntegrationReceipt = IntegrationReceipt | NonBehavioralIntegrationReceipt;

interface IntegrationCandidate {
  capability: string;
  path: string;
  original: string | null;
  next: string;
  replay: CapabilityReplayResult;
}

const CAPABILITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FEATURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const GIT_OBJECT = /^[a-f0-9]{40,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isDigestArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === "string" && SHA256_DIGEST.test(entry));
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

async function writeExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

async function writeAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(path: string): Promise<T> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Coordination metadata must be a regular non-symbolic file: ${path}`);
  }
  return JSON.parse(await readFile(path, "utf8")) as T;
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

async function ensurePlainDirectory(path: string): Promise<void> {
  let metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) {
    await mkdir(path, { recursive: true });
    metadata = await lstat(path);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Coordination storage must be a regular directory: ${path}`);
  }
}

async function readCapabilityProjection(root: string, capability: string): Promise<string | null> {
  if (!CAPABILITY_ID.test(capability)) throw new Error(`Invalid capability id: ${capability}`);
  const canonicalRoot = await realpath(resolve(root));
  const empirical = join(canonicalRoot, ".empirical");
  const capabilities = join(empirical, "capabilities");
  const capabilityDirectory = join(capabilities, capability);
  const path = join(capabilityDirectory, "spec.md");
  for (const directory of [empirical, capabilities, capabilityDirectory]) {
    const metadata = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (metadata && (metadata.isSymbolicLink() || !metadata.isDirectory())) {
      throw new Error(`Capability storage must not use symbolic or special directories: ${directory}`);
    }
  }
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Capability projection must be a regular non-symbolic file: ${path}`);
  }
  const canonical = await realpath(path);
  const rel = relative(canonicalRoot, canonical);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Capability projection resolves outside the repository: ${path}`);
  }
  return readFile(canonical, "utf8");
}

async function gitText(
  root: string,
  args: string[],
  adapter?: ProcessAdapter,
): Promise<string> {
  const command = await executeCommandCaptured(
    root,
    {
      argv: ["git", ...args],
      cwd: ".",
      timeoutMs: 30_000,
      maxOutputBytes: 262_144,
    },
    adapter,
  );
  if (command.result.exitCode !== 0 || command.result.timedOut) {
    throw new Error(
      `Git ${args.join(" ")} failed: ${command.stderr.trim() || command.result.exitCode}`,
    );
  }
  return command.stdout.trim();
}

export async function resolveGitRepositoryIdentity(
  root: string,
  adapter?: ProcessAdapter,
): Promise<GitRepositoryIdentity> {
  const checkoutRoot = await realpath(await gitText(root, ["rev-parse", "--show-toplevel"], adapter));
  const commonOutput = await gitText(root, ["rev-parse", "--git-common-dir"], adapter);
  const commonDirectory = await realpath(
    resolve(checkoutRoot, commonOutput),
  );
  const [headCommit, headTree] = await Promise.all([
    gitText(root, ["rev-parse", "--verify", "HEAD^{commit}"], adapter),
    gitText(root, ["rev-parse", "--verify", "HEAD^{tree}"], adapter),
  ]);
  return {
    root: checkoutRoot,
    commonDirectory,
    headCommit,
    headTree,
    repositoryId: sha256(commonDirectory),
    worktreeId: sha256(checkoutRoot),
  };
}

function coordinationDirectory(identity: GitRepositoryIdentity): string {
  return join(identity.commonDirectory, "empirical");
}

async function withCoordinationLock<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  await ensurePlainDirectory(directory);
  const lockPath = join(directory, "coordination.lock");
  const deadline = Date.now() + 5_000;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error("Repository capability coordination is busy; retry shortly.");
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  const owner = { pid: process.pid, id: randomUUID() };
  await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
  await handle.sync();
  await syncDirectory(directory);
  try {
    return await operation();
  } finally {
    await handle.close();
    const current = await readFile(lockPath, "utf8").catch(() => "");
    if (current === `${JSON.stringify(owner)}\n`) {
      await rm(lockPath, { force: true });
      await syncDirectory(directory);
    }
  }
}

function verifyClaim(claim: CapabilityClaim): void {
  if (claim.schemaVersion !== 1 || !FEATURE_ID.test(claim.feature)) {
    throw new Error("Capability claim has an invalid schema or feature id.");
  }
  if (claim.capabilities.length === 0 || claim.capabilities.some((name) => !CAPABILITY_ID.test(name))) {
    throw new Error(`Capability claim ${claim.id} has invalid capabilities.`);
  }
  if (
    claim.id !== claimId(claim.feature, claim.worktreeId)
    || !/^sha256:[a-f0-9]{64}$/.test(claim.repositoryId)
    || !/^sha256:[a-f0-9]{64}$/.test(claim.worktreeId)
    || !isAbsolute(claim.worktree)
    || !/^[a-f0-9]{40,64}$/.test(claim.baseCommit)
    || !/^[a-f0-9]{40,64}$/.test(claim.baseTree)
    || !["active", "integrated"].includes(claim.status)
    || !Number.isFinite(Date.parse(claim.createdAt))
    || !Number.isFinite(Date.parse(claim.heartbeatAt))
    || Date.parse(claim.heartbeatAt) < Date.parse(claim.createdAt)
  ) {
    throw new Error(`Capability claim ${claim.id} has invalid identity or lifecycle metadata.`);
  }
  const capabilities = [...new Set(claim.capabilities)].sort();
  if (
    JSON.stringify(capabilities) !== JSON.stringify(claim.capabilities)
    || JSON.stringify(Object.keys(claim.bases).sort()) !== JSON.stringify(capabilities)
  ) {
    throw new Error(`Capability claim ${claim.id} has inconsistent capability bases.`);
  }
  for (const capability of capabilities) {
    const base = claim.bases[capability];
    if (
      !base
      || base.capability !== capability
      || !/^sha256:[a-f0-9]{64}$/.test(base.digest)
      || Object.values(base.requirements).some((value) => value !== null && !/^sha256:[a-f0-9]{64}$/.test(value))
    ) {
      throw new Error(`Capability claim ${claim.id} has an invalid base for ${capability}.`);
    }
  }
  if (
    (claim.status === "active" && claim.integrationReceiptDigest !== null)
    || (claim.status === "integrated" && !/^sha256:[a-f0-9]{64}$/.test(claim.integrationReceiptDigest ?? ""))
  ) {
    throw new Error(`Capability claim ${claim.id} has inconsistent integration metadata.`);
  }
  const { digest, ...body } = claim;
  if (digestJson(body) !== digest) {
    throw new Error(`Capability claim ${claim.id} failed its digest check.`);
  }
}

async function registeredWorktrees(root: string, adapter?: ProcessAdapter): Promise<Set<string>> {
  const output = await gitText(root, ["worktree", "list", "--porcelain"], adapter);
  const paths = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));
  return new Set(paths);
}

async function readClaims(
  identity: GitRepositoryIdentity,
  adapter?: ProcessAdapter,
): Promise<ClaimInspection> {
  const directory = join(coordinationDirectory(identity), "claims");
  const worktrees = await registeredWorktrees(identity.root, adapter);
  const result: ClaimInspection = { active: [], stale: [], integrated: [] };
  if (!(await exists(directory))) return result;
  await ensurePlainDirectory(directory);
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile()) {
      throw new Error(`Capability claim must be a regular non-symbolic file: ${join(directory, entry.name)}`);
    }
    const claim = await readJson<CapabilityClaim>(join(directory, entry.name));
    verifyClaim(claim);
    if (claim.repositoryId !== identity.repositoryId) {
      throw new Error(`Capability claim ${claim.id} belongs to another repository.`);
    }
    if (claim.status === "integrated") {
      result.integrated.push(claim);
    } else if (!worktrees.has(resolve(claim.worktree)) || !(await exists(claim.worktree))) {
      result.stale.push(claim);
    } else {
      result.active.push(claim);
    }
  }
  return result;
}

export async function inspectCapabilityClaims(
  root: string,
  adapter?: ProcessAdapter,
): Promise<ClaimInspection> {
  return readClaims(await resolveGitRepositoryIdentity(root, adapter), adapter);
}

function claimId(feature: string, worktreeId: string): string {
  return `${feature}-${sha256(worktreeId).slice("sha256:".length, "sha256:".length + 12)}`;
}

export async function captureCapabilityBases(input: {
  root: string;
  feature: string;
  deltas: CapabilityDelta[];
}): Promise<Record<string, CapabilityBaseSnapshot>> {
  const byCapability = new Map<string, CapabilityDelta[]>();
  for (const delta of input.deltas) {
    const current = byCapability.get(delta.capability) ?? [];
    current.push(delta);
    byCapability.set(delta.capability, current);
  }
  const bases: Record<string, CapabilityBaseSnapshot> = {};
  for (const [capability, deltas] of [...byCapability].sort(([left], [right]) => left.localeCompare(right))) {
    const current = await readCapabilityProjection(input.root, capability);
    bases[capability] = captureCapabilityBase(capability, current, deltas);
  }
  return bases;
}

export async function claimCapabilities(input: {
  root: string;
  feature: string;
  bases: Record<string, CapabilityBaseSnapshot>;
  now?: () => Date;
  adapter?: ProcessAdapter;
}): Promise<{ claim: CapabilityClaim; stale: CapabilityClaim[]; converged: boolean }> {
  if (!FEATURE_ID.test(input.feature)) throw new Error(`Invalid feature id: ${input.feature}`);
  const capabilities = Object.keys(input.bases).sort();
  if (capabilities.length === 0 || capabilities.some((name) => !CAPABILITY_ID.test(name))) {
    throw new Error("A behavioral feature must claim at least one valid capability.");
  }
  const identity = await resolveGitRepositoryIdentity(input.root, input.adapter);
  const directory = coordinationDirectory(identity);
  return withCoordinationLock(directory, async () => {
    const inspection = await readClaims(identity, input.adapter);
    const id = claimId(input.feature, identity.worktreeId);
    const existing = [...inspection.active, ...inspection.stale, ...inspection.integrated].find(
      (claim) => claim.id === id,
    );
    if (existing) {
      if (
        existing.feature === input.feature &&
        existing.worktreeId === identity.worktreeId &&
        digestJson(existing.bases) === digestJson(input.bases)
      ) {
        return { claim: existing, stale: inspection.stale, converged: true };
      }
      throw new Error(`Capability claim id ${id} already exists with different contents.`);
    }
    const requested = new Set(capabilities);
    const overlaps = inspection.active.filter((claim) =>
      claim.capabilities.some((capability) => requested.has(capability)),
    );
    if (overlaps.length > 0) {
      const details = overlaps
        .map((claim) => `${claim.feature} in ${claim.worktree}`)
        .join(", ");
      throw new Error(`Live capability claim conflict: ${details}`);
    }
    const timestamp = (input.now ?? (() => new Date()))().toISOString();
    const body = {
      schemaVersion: 1 as const,
      id,
      repositoryId: identity.repositoryId,
      feature: input.feature,
      worktree: identity.root,
      worktreeId: identity.worktreeId,
      baseCommit: identity.headCommit,
      baseTree: identity.headTree,
      bases: input.bases,
      capabilities,
      status: "active" as const,
      integrationReceiptDigest: null,
      createdAt: timestamp,
      heartbeatAt: timestamp,
    };
    const claim: CapabilityClaim = { ...body, digest: digestJson(body) };
    await writeExclusive(join(directory, "claims", `${id}.json`), claim);
    return { claim, stale: inspection.stale, converged: false };
  });
}

export async function refreshCapabilityClaim(input: {
  root: string;
  claimId: string;
  now?: () => Date;
  adapter?: ProcessAdapter;
}): Promise<CapabilityClaim> {
  const identity = await resolveGitRepositoryIdentity(input.root, input.adapter);
  const directory = coordinationDirectory(identity);
  return withCoordinationLock(directory, async () => {
    const path = join(directory, "claims", `${input.claimId}.json`);
    const claim = await readJson<CapabilityClaim>(path);
    verifyClaim(claim);
    if (claim.worktreeId !== identity.worktreeId || claim.status !== "active") {
      throw new Error(`Capability claim ${claim.id} is not active in this worktree.`);
    }
    const { digest: _digest, ...body } = claim;
    const nextBody = {
      ...body,
      heartbeatAt: (input.now ?? (() => new Date()))().toISOString(),
    };
    const next = { ...nextBody, digest: digestJson(nextBody) };
    await writeJsonAtomic(path, next);
    return next;
  });
}

async function loadFeatureDeltas(root: string, feature: string): Promise<CapabilityDelta[]> {
  const directory = join(root, ".empirical", "specs", feature, "deltas");
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Capability delta storage must be a regular directory: ${directory}`);
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const deltas = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile()) {
      throw new Error(`Capability delta must be a regular non-symbolic file: ${join(directory, entry.name)}`);
    }
    const capability = entry.name.slice(0, -3);
    deltas.push(
      parseCapabilityDelta(
        capability,
        await readFile(join(directory, entry.name), "utf8"),
        `.empirical/specs/${feature}/deltas/${entry.name}`,
      ),
    );
  }
  return deltas;
}

async function integrationCandidates(
  targetRoot: string,
  claim: CapabilityClaim,
  deltas: CapabilityDelta[],
): Promise<{ candidates: IntegrationCandidate[]; issues: string[] }> {
  const grouped = new Map<string, CapabilityDelta[]>();
  for (const delta of deltas) {
    const group = grouped.get(delta.capability) ?? [];
    group.push(delta);
    grouped.set(delta.capability, group);
  }
  const candidates: IntegrationCandidate[] = [];
  const issues: string[] = [];
  for (const capability of claim.capabilities) {
    const path = join(targetRoot, ".empirical", "capabilities", capability, "spec.md");
    const current = await readCapabilityProjection(targetRoot, capability);
    const base = claim.bases[capability];
    if (!base) {
      issues.push(`${capability}: claim is missing its base snapshot`);
      continue;
    }
    const replay = replayCapabilityDeltas(
      capability,
      current,
      grouped.get(capability) ?? [],
      base,
    );
    issues.push(...replay.issues);
    candidates.push({ capability, path, original: current, next: replay.next, replay });
  }
  for (const capability of grouped.keys()) {
    if (!claim.capabilities.includes(capability)) {
      issues.push(`${capability}: delta is not covered by the capability claim`);
    }
  }
  return { candidates, issues };
}

export interface IntegrationValidationResult {
  featureTree: string;
  verificationReceiptDigests: string[];
}

export type IntegrationValidator = (
  targetRoot: string,
  candidates: ReadonlyArray<{ capability: string; next: string; resultDigest: string }>,
) => Promise<IntegrationValidationResult>;

export async function integrateCapabilities(input: {
  root: string;
  targetRoot: string;
  feature: string;
  claimId: string;
  validator: IntegrationValidator;
  now?: () => Date;
  adapter?: ProcessAdapter;
}): Promise<IntegrationReceipt> {
  const [identity, targetIdentity] = await Promise.all([
    resolveGitRepositoryIdentity(input.root, input.adapter),
    resolveGitRepositoryIdentity(input.targetRoot, input.adapter),
  ]);
  if (identity.repositoryId !== targetIdentity.repositoryId) {
    throw new Error("Integration target belongs to a different Git repository.");
  }
  if (identity.worktreeId === targetIdentity.worktreeId) {
    throw new Error("Integration validation requires an independent target worktree.");
  }
  const directory = coordinationDirectory(identity);
  return withCoordinationLock(directory, async () => {
    const claimPath = join(directory, "claims", `${input.claimId}.json`);
    const claim = await readJson<CapabilityClaim>(claimPath);
    verifyClaim(claim);
    if (
      claim.feature !== input.feature ||
      claim.worktreeId !== identity.worktreeId ||
      claim.status !== "active"
    ) {
      throw new Error(`Capability claim ${input.claimId} is not active for this feature worktree.`);
    }
    const deltas = await loadFeatureDeltas(input.root, input.feature);
    const { candidates, issues } = await integrationCandidates(input.targetRoot, claim, deltas);
    if (issues.length > 0) {
      throw new Error(`Capability integration conflict: ${issues.join("; ")}`);
    }
    const validation = await input.validator(
      input.targetRoot,
      candidates.map((candidate) => ({
        capability: candidate.capability,
        next: candidate.next,
        resultDigest: candidate.replay.resultDigest,
      })),
    );
    const confirmedTarget = await resolveGitRepositoryIdentity(
      input.targetRoot,
      input.adapter,
    );
    if (
      confirmedTarget.repositoryId !== targetIdentity.repositoryId
      || confirmedTarget.worktreeId !== targetIdentity.worktreeId
      || confirmedTarget.headCommit !== targetIdentity.headCommit
      || confirmedTarget.headTree !== targetIdentity.headTree
    ) {
      throw new Error("Integration target changed during independent validation.");
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(validation.featureTree)) {
      throw new Error("Integration validator returned an invalid feature tree digest.");
    }
    const verificationReceiptDigests = [...new Set(validation.verificationReceiptDigests)].sort();
    if (
      verificationReceiptDigests.length === 0 ||
      verificationReceiptDigests.some((digest) => !/^sha256:[a-f0-9]{64}$/.test(digest))
    ) {
      throw new Error("Integration validation requires at least one valid receipt digest.");
    }
    const deltaDigest = digestJson(
      deltas.map((delta) => ({
        capability: delta.capability,
        purpose: delta.purpose,
        requirements: delta.requirements,
      })),
    );
    const capabilityBaseDigests = Object.fromEntries(
      Object.entries(claim.bases).map(([capability, base]) => [capability, base.digest]),
    );
    const resultDigests = Object.fromEntries(
      candidates.map((candidate) => [candidate.capability, candidate.replay.resultDigest]),
    );
    const body = {
      schemaVersion: 1 as const,
      feature: input.feature,
      claimId: claim.id,
      repositoryId: identity.repositoryId,
      baseCommit: claim.baseCommit,
      baseTree: claim.baseTree,
      featureTree: validation.featureTree,
      targetCommit: targetIdentity.headCommit,
      targetTree: targetIdentity.headTree,
      capabilityBaseDigests,
      deltaDigest,
      resultDigests,
      verificationReceiptDigests,
      integratedAt: (input.now ?? (() => new Date()))().toISOString(),
    };
    const receipt: IntegrationReceipt = { ...body, digest: digestJson(body) };
    const applied: Array<{ path: string; original: string | null }> = [];
    let receiptPath: string | null = null;
    let receiptWritten = false;
    try {
      for (const candidate of candidates) {
        const destination = join(
          input.root,
          ".empirical",
          "capabilities",
          candidate.capability,
          "spec.md",
        );
        const original = await readCapabilityProjection(input.root, candidate.capability);
        await writeAtomic(destination, candidate.next);
        applied.push({ path: destination, original });
      }
      receiptPath = join(
        input.root,
        ".empirical",
        "specs",
        input.feature,
        "integration-receipt.json",
      );
      await writeExclusive(receiptPath, receipt);
      receiptWritten = true;
      const { digest: _claimDigest, ...claimBody } = claim;
      const integratedBody = {
        ...claimBody,
        status: "integrated" as const,
        integrationReceiptDigest: receipt.digest,
        heartbeatAt: receipt.integratedAt,
      };
      await writeJsonAtomic(claimPath, {
        ...integratedBody,
        digest: digestJson(integratedBody),
      });
      return receipt;
    } catch (error) {
      for (const candidate of [...applied].reverse()) {
        if (candidate.original === null) {
          await rm(candidate.path, { force: true });
          await rm(dirname(candidate.path), { recursive: false, force: true }).catch(() => undefined);
        } else {
          await writeAtomic(candidate.path, candidate.original);
        }
      }
      if (receiptWritten && receiptPath) {
        await rm(receiptPath, { force: true });
      }
      throw error;
    }
  });
}

export function verifyIntegrationReceipt(receipt: IntegrationReceipt): void {
  const candidate: unknown = receipt;
  if (!isRecord(candidate)) {
    throw new Error("Integration receipt is incomplete.");
  }
  const feature = typeof candidate.feature === "string" ? candidate.feature : "unknown";
  if (
    candidate.schemaVersion !== 1
    || "classification" in candidate
    || !FEATURE_ID.test(feature)
    || typeof candidate.claimId !== "string"
    || !candidate.claimId.startsWith(`${feature}-`)
    || typeof candidate.repositoryId !== "string"
    || !SHA256_DIGEST.test(candidate.repositoryId)
    || typeof candidate.baseCommit !== "string"
    || !GIT_OBJECT.test(candidate.baseCommit)
    || typeof candidate.baseTree !== "string"
    || !GIT_OBJECT.test(candidate.baseTree)
    || typeof candidate.featureTree !== "string"
    || !SHA256_DIGEST.test(candidate.featureTree)
    || typeof candidate.targetCommit !== "string"
    || !GIT_OBJECT.test(candidate.targetCommit)
    || typeof candidate.targetTree !== "string"
    || !GIT_OBJECT.test(candidate.targetTree)
    || typeof candidate.integratedAt !== "string"
    || !Number.isFinite(Date.parse(candidate.integratedAt))
    || !isStringRecord(candidate.capabilityBaseDigests)
    || !isStringRecord(candidate.resultDigests)
    || Object.keys(candidate.resultDigests).length === 0
    || typeof candidate.deltaDigest !== "string"
    || !isDigestArray(candidate.verificationReceiptDigests)
    || typeof candidate.digest !== "string"
  ) {
    throw new Error(`Integration receipt for ${feature} is incomplete.`);
  }
  const { digest, ...body } = candidate;
  if (digestJson(body) !== digest) {
    throw new Error(`Integration receipt for ${feature} failed its digest check.`);
  }
  for (const value of [
    candidate.featureTree,
    candidate.deltaDigest,
    ...Object.values(candidate.capabilityBaseDigests),
    ...Object.values(candidate.resultDigests),
    ...candidate.verificationReceiptDigests,
  ]) {
    if (!SHA256_DIGEST.test(value)) {
      throw new Error(`Integration receipt for ${feature} has an invalid digest.`);
    }
  }
}

export function verifyStoredIntegrationReceipt(
  receipt: unknown,
): asserts receipt is StoredIntegrationReceipt {
  if (!isRecord(receipt)) {
    throw new Error("Integration receipt is incomplete.");
  }
  if (receipt.classification !== "non-behavioral") {
    verifyIntegrationReceipt(receipt as unknown as IntegrationReceipt);
    return;
  }
  const feature = typeof receipt.feature === "string" ? receipt.feature : "unknown";
  const behavioralFields = [
    "baseCommit",
    "baseTree",
    "capabilityBaseDigests",
    "deltaDigest",
    "resultDigests",
  ];
  if (
    receipt.schemaVersion !== 1
    || !FEATURE_ID.test(feature)
    || receipt.claimId !== null
    || typeof receipt.repositoryId !== "string"
    || !SHA256_DIGEST.test(receipt.repositoryId)
    || typeof receipt.featureTree !== "string"
    || !SHA256_DIGEST.test(receipt.featureTree)
    || typeof receipt.targetCommit !== "string"
    || !GIT_OBJECT.test(receipt.targetCommit)
    || typeof receipt.targetTree !== "string"
    || !GIT_OBJECT.test(receipt.targetTree)
    || !isDigestArray(receipt.verificationReceiptDigests)
    || typeof receipt.integratedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.integratedAt))
    || typeof receipt.digest !== "string"
    || behavioralFields.some((field) => field in receipt)
  ) {
    throw new Error(`Integration receipt for ${feature} is incomplete.`);
  }
  const { digest, ...body } = receipt;
  if (digestJson(body) !== digest) {
    throw new Error(`Integration receipt for ${feature} failed its digest check.`);
  }
}

export async function commonCoordinationPath(
  root: string,
  adapter?: ProcessAdapter,
): Promise<string> {
  const identity = await resolveGitRepositoryIdentity(root, adapter);
  return relative(identity.root, coordinationDirectory(identity)).replaceAll("\\", "/");
}
