import {
  createAuthorization,
  digestJson,
  verifyAuthorization,
  type StandingAuthorization,
} from "./protocol.js";
import {
  executeCommandCaptured,
  type CapturedRuntimeResult,
  type ProcessAdapter,
} from "./runtime.js";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface CommitPlan {
  branch: string;
  paths: string[];
  message: string;
  title: string;
  body: string;
}

export interface PullRequestFact {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeCommit: string | null;
}

export interface GitHubDeliveryReceipt {
  schemaVersion: 1;
  repositoryId: string;
  feature: string;
  targetBranch: string;
  source: PullRequestFact & { commit: string };
  evidence: PullRequestFact & { commit: string };
  requiredChecks: string[];
  commandReceiptDigests: string[];
  deliveredAt: string;
  digest: string;
}

export type DeliveryRunner = (
  root: string,
  argv: string[],
) => Promise<CapturedRuntimeResult>;

export interface DeliveryOptions {
  root: string;
  repositoryId: string;
  feature: string;
  authorization: StandingAuthorization;
  targetBranch: string;
  requiredChecks: string[];
  source: CommitPlan;
  evidence: CommitPlan;
  prepareEvidence: (mergedSourceCommit: string) => Promise<void>;
  runner?: DeliveryRunner;
  processAdapter?: ProcessAdapter;
  now?: () => Date;
  delay?: (milliseconds: number) => Promise<void>;
  checkAttempts?: number;
}

const BRANCH = /^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\\])[^\s]+$/;
const COMMIT = /^[a-f0-9]{7,64}$/;
const FEATURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const DIST_TAG = /^[a-z][a-z0-9._-]*$/;

function validateBranch(branch: string): void {
  if (!BRANCH.test(branch) || branch.endsWith(".") || branch.endsWith("/")) {
    throw new Error(`Unsafe Git branch name: ${branch}`);
  }
}

export function assertSafeDeliveryArgv(argv: readonly string[]): void {
  if (argv.length === 0 || argv.some((part) => !part || part.includes("\0"))) {
    throw new Error("Delivery command requires non-empty null-free argv.");
  }
  for (const part of argv) {
    const lower = part.toLowerCase();
    if (
      lower === "-f" ||
      lower.startsWith("--force") ||
      lower === "--admin" ||
      lower === "--delete" ||
      lower === "-d" ||
      lower === "-D" ||
      /(token|password|credential|authorization)=/i.test(part)
    ) {
      throw new Error(`Forbidden delivery argument: ${part}`);
    }
  }
  if (argv[0] === "git") {
    const verb = argv[1];
    if (
      verb === "reset" ||
      verb === "clean" ||
      verb === "branch" ||
      verb === "worktree" ||
      (verb === "push" && argv.some((part) => part.startsWith(":")))
    ) {
      throw new Error(`Forbidden delivery Git operation: ${String(verb)}`);
    }
  }
  if (argv[0] === "gh" && argv[1] === "pr" && argv[2] === "merge" && argv.includes("--admin")) {
    throw new Error("GitHub delivery may not bypass protected-branch policy.");
  }
}

export function githubCliConfigurationEnvironment(options: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
} = {}): { GH_CONFIG_DIR: string } {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const explicit = env.GH_CONFIG_DIR?.trim();
  if (explicit) return { GH_CONFIG_DIR: explicit };
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return { GH_CONFIG_DIR: join(xdg, "gh") };
  const appData = (env.APPDATA ?? env.AppData)?.trim();
  if (platform === "win32" && appData) {
    return { GH_CONFIG_DIR: join(appData, "GitHub CLI") };
  }
  if (!home.trim()) {
    throw new Error("GitHub CLI configuration requires an operating-system home directory.");
  }
  return { GH_CONFIG_DIR: join(home, ".config", "gh") };
}

function defaultRunner(adapter?: ProcessAdapter): DeliveryRunner {
  return (root, argv) =>
    executeCommandCaptured(
      root,
      {
        argv,
        cwd: ".",
        timeoutMs: 120_000,
        maxOutputBytes: 524_288,
        ...(argv[0] === "gh"
          ? { environment: githubCliConfigurationEnvironment() }
          : {}),
      },
      adapter,
    );
}

interface CommandContext {
  root: string;
  runner: DeliveryRunner;
  receipts: string[];
}

async function run(
  context: CommandContext,
  argv: string[],
  allowFailure = false,
): Promise<CapturedRuntimeResult> {
  assertSafeDeliveryArgv(argv);
  const result = await context.runner(context.root, argv);
  context.receipts.push(digestJson(result.result));
  if (!allowFailure && (result.result.exitCode !== 0 || result.result.timedOut)) {
    throw new Error(
      `Delivery command failed (${argv.join(" ")}): ${result.stderr.trim() || result.result.exitCode}`,
    );
  }
  return result;
}

function markerPrefix(repositoryId: string, feature: string, kind: "source" | "evidence"): string {
  return `<!-- empirical-delivery:${repositoryId}:${feature}:${kind}:commit=`;
}

function marker(prefix: string, commit: string): string {
  if (!COMMIT.test(commit)) throw new Error("Delivery idempotency marker requires an exact commit.");
  return `${prefix}${commit} -->`;
}

function parsePullRequest(value: unknown): PullRequestFact {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub returned a malformed pull request.");
  }
  const record = value as Record<string, unknown>;
  const mergeCommitValue = record.mergeCommit;
  const mergeCommit =
    typeof mergeCommitValue === "object" && mergeCommitValue !== null
      ? (mergeCommitValue as Record<string, unknown>).oid
      : mergeCommitValue;
  if (
    !Number.isSafeInteger(record.number) ||
    Number(record.number) <= 0 ||
    typeof record.url !== "string" ||
    !["OPEN", "MERGED", "CLOSED"].includes(String(record.state)) ||
    (mergeCommit !== null && mergeCommit !== undefined && typeof mergeCommit !== "string")
  ) {
    throw new Error("GitHub returned incomplete pull request facts.");
  }
  return {
    number: Number(record.number),
    url: record.url,
    state: String(record.state) as PullRequestFact["state"],
    mergeCommit: typeof mergeCommit === "string" && mergeCommit ? mergeCommit : null,
  };
}

function parseJson(stdout: string, label: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${String(error)}`);
  }
}

async function findPullRequest(
  context: CommandContext,
  branch: string,
  targetBranch: string,
  expectedMarkerPrefix: string,
): Promise<{ pullRequest: PullRequestFact; markerCommit: string } | null> {
  const result = await run(context, [
    "gh",
    "pr",
    "list",
    "--head",
    branch,
    "--base",
    targetBranch,
    "--state",
    "all",
    "--json",
    "number,url,state,mergeCommit,body",
  ]);
  const parsed = parseJson(result.stdout, "gh pr list");
  if (!Array.isArray(parsed)) throw new Error("gh pr list did not return an array.");
  if (parsed.length === 0) return null;
  if (parsed.length > 1) {
    throw new Error(`GitHub has multiple pull requests for ${branch}; delivery is ambiguous.`);
  }
  const value = parsed[0];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub returned a malformed pull request.");
  }
  const body = String((value as Record<string, unknown>).body ?? "");
  const start = body.indexOf(expectedMarkerPrefix);
  const end = start < 0 ? -1 : body.indexOf(" -->", start + expectedMarkerPrefix.length);
  const markerCommit = end < 0
    ? ""
    : body.slice(start + expectedMarkerPrefix.length, end);
  if (!COMMIT.test(markerCommit)) {
    throw new Error(`Existing pull request for ${branch} is not owned by this delivery intent.`);
  }
  return { pullRequest: parsePullRequest(value), markerCommit };
}

async function viewPullRequest(
  context: CommandContext,
  number: number,
): Promise<PullRequestFact> {
  const result = await run(context, [
    "gh",
    "pr",
    "view",
    String(number),
    "--json",
    "number,url,state,mergeCommit",
  ]);
  return parsePullRequest(parseJson(result.stdout, "gh pr view"));
}

async function prepareCommit(
  context: CommandContext,
  plan: CommitPlan,
): Promise<string> {
  validateBranch(plan.branch);
  const repositoryRoot = resolve(context.root);
  if (plan.paths.length === 0 || plan.paths.some((path) => {
    if (!path || path === "." || path === ".git" || path.startsWith(".git/") || path.includes("\0") || isAbsolute(path)) return true;
    const rel = relative(repositoryRoot, resolve(repositoryRoot, path));
    return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  })) {
    throw new Error("Delivery commit requires explicit repository-contained paths.");
  }
  if (!plan.message.trim() || !plan.title.trim() || !plan.body.trim()) {
    throw new Error("Delivery commit and pull request text must be non-empty.");
  }
  const branch = await run(context, ["git", "symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.stdout.trim() !== plan.branch) {
    throw new Error(
      `Delivery commit requires checked-out branch ${plan.branch}, got ${branch.stdout.trim() || "detached HEAD"}.`,
    );
  }
  const assertStagedPaths = async (): Promise<void> => {
    const staged = await run(context, [
      "git",
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "-z",
    ]);
    const planned = plan.paths.map((path) => path.replaceAll("\\", "/").replace(/\/$/, ""));
    const outside = staged.stdout
      .split("\0")
      .filter(Boolean)
      .filter((path) => !planned.some((allowed) => path === allowed || path.startsWith(`${allowed}/`)));
    if (outside.length > 0) {
      throw new Error(`Delivery refuses staged paths outside the commit plan: ${outside.join(", ")}`);
    }
  };
  await assertStagedPaths();
  const status = await run(context, [
    "git",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...plan.paths,
  ]);
  if (status.stdout.trim()) {
    await run(context, ["git", "add", "--", ...plan.paths]);
    await assertStagedPaths();
    await run(context, ["git", "commit", "--only", "-m", plan.message, "--", ...plan.paths]);
  }
  const head = await run(context, ["git", "rev-parse", "--verify", "HEAD^{commit}"]);
  const commit = head.stdout.trim();
  if (!COMMIT.test(commit)) throw new Error("Git did not return a valid commit id.");
  return commit;
}

async function pushAndOpen(
  context: CommandContext,
  plan: CommitPlan,
  targetBranch: string,
  idempotencyMarkerPrefix: string,
): Promise<{ commit: string; pullRequest: PullRequestFact }> {
  const commit = await prepareCommit(context, plan);
  const idempotencyMarker = marker(idempotencyMarkerPrefix, commit);
  await run(context, [
    "git",
    "push",
    "--set-upstream",
    "origin",
    `${plan.branch}:refs/heads/${plan.branch}`,
  ]);
  await run(context, [
    "gh",
    "pr",
    "create",
    "--head",
    plan.branch,
    "--base",
    targetBranch,
    "--title",
    plan.title,
    "--body",
    `${plan.body.trim()}\n\n${idempotencyMarker}`,
  ]);
  const observed = await findPullRequest(context, plan.branch, targetBranch, idempotencyMarkerPrefix);
  if (!observed) throw new Error("GitHub did not expose the newly created pull request.");
  if (observed.markerCommit !== commit) {
    throw new Error("GitHub pull request head does not match the delivery idempotency marker.");
  }
  return { commit, pullRequest: observed.pullRequest };
}

interface CheckFact {
  name: string;
  state: string;
  bucket: string;
}

function checksFrom(value: unknown): CheckFact[] {
  if (!Array.isArray(value)) throw new Error("gh pr checks did not return an array.");
  return value.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("GitHub returned a malformed check result.");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.name !== "string") throw new Error("GitHub check is missing its name.");
    return {
      name: item.name,
      state: String(item.state ?? ""),
      bucket: String(item.bucket ?? ""),
    };
  });
}

async function waitForRequiredChecks(
  context: CommandContext,
  pullRequest: PullRequestFact,
  required: string[],
  attempts: number,
  delay: (milliseconds: number) => Promise<void>,
): Promise<void> {
  if (required.length === 0) return;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await run(
      context,
      [
        "gh",
        "pr",
        "checks",
        String(pullRequest.number),
        "--required",
        "--json",
        "name,state,bucket,link",
      ],
      true,
    );
    const checks = checksFrom(parseJson(result.stdout || "[]", "gh pr checks"));
    const byName = new Map(checks.map((check) => [check.name, check]));
    const missing = required.filter((name) => !byName.has(name));
    const failed = checks.filter((check) =>
      ["fail", "failed", "cancel", "cancelled", "skipping"].includes(check.bucket.toLowerCase()) ||
      ["failure", "error", "cancelled"].includes(check.state.toLowerCase()),
    );
    if (failed.length > 0) {
      throw new Error(
        `Required GitHub checks failed: ${failed.map((check) => check.name).join(", ")}`,
      );
    }
    const pending = checks.filter(
      (check) =>
        !["pass", "success", "skipped"].includes(check.bucket.toLowerCase()) &&
        !["success", "completed"].includes(check.state.toLowerCase()),
    );
    if (missing.length === 0 && pending.length === 0 && result.result.exitCode === 0) return;
    if (attempt < attempts) await delay(Math.min(1_000 * 2 ** (attempt - 1), 10_000));
  }
  throw new Error(`Required GitHub checks did not become green for PR #${pullRequest.number}.`);
}

async function mergePullRequest(
  context: CommandContext,
  pullRequest: PullRequestFact,
): Promise<PullRequestFact> {
  if (pullRequest.state === "MERGED") {
    if (!pullRequest.mergeCommit) throw new Error("Merged pull request has no remote merge commit.");
    return pullRequest;
  }
  if (pullRequest.state !== "OPEN") {
    throw new Error(`Pull request #${pullRequest.number} is closed without merge.`);
  }
  await run(context, ["gh", "pr", "merge", String(pullRequest.number), "--merge"]);
  const merged = await viewPullRequest(context, pullRequest.number);
  if (merged.state !== "MERGED" || !merged.mergeCommit) {
    throw new Error(`GitHub did not confirm a merged commit for PR #${pullRequest.number}.`);
  }
  return merged;
}

async function deliverOne(
  context: CommandContext,
  plan: CommitPlan,
  targetBranch: string,
  requiredChecks: string[],
  idempotencyMarkerPrefix: string,
  attempts: number,
  delay: (milliseconds: number) => Promise<void>,
): Promise<{ commit: string; pullRequest: PullRequestFact }> {
  let observed = await findPullRequest(context, plan.branch, targetBranch, idempotencyMarkerPrefix);
  let pullRequest = observed?.pullRequest ?? null;
  let commit: string;
  if (!pullRequest) {
    const opened = await pushAndOpen(
      context,
      plan,
      targetBranch,
      idempotencyMarkerPrefix,
    );
    commit = opened.commit;
    pullRequest = opened.pullRequest;
  } else {
    const head = await run(context, [
      "gh",
      "pr",
      "view",
      String(pullRequest.number),
      "--json",
      "headRefOid",
    ]);
    const parsed = parseJson(head.stdout, "gh pr view headRefOid") as Record<string, unknown>;
    commit = String(parsed.headRefOid ?? "");
    if (!COMMIT.test(commit)) throw new Error("GitHub pull request has no valid head commit.");
    if (commit !== observed!.markerCommit) {
      throw new Error(`Pull request #${pullRequest.number} head changed after delivery intent was recorded.`);
    }
  }
  if (pullRequest.state !== "MERGED") {
    await waitForRequiredChecks(context, pullRequest, requiredChecks, attempts, delay);
    pullRequest = await mergePullRequest(context, pullRequest);
  } else if (!pullRequest.mergeCommit) {
    pullRequest = await viewPullRequest(context, pullRequest.number);
  }
  if (pullRequest.state !== "MERGED" || !pullRequest.mergeCommit) {
    throw new Error(`Pull request #${pullRequest.number} is not durably merged.`);
  }
  return { commit, pullRequest };
}

function completionRank(level: StandingAuthorization["ceiling"]): number {
  return ["implemented", "verified", "integrated", "delivered", "published"].indexOf(level);
}

function validateDeliveryAuthorization(options: DeliveryOptions): void {
  verifyAuthorization(options.authorization);
  if (
    options.authorization.repositoryId !== options.repositoryId ||
    options.authorization.feature !== options.feature
  ) {
    throw new Error("Standing authorization does not match this repository feature.");
  }
  if (completionRank(options.authorization.ceiling) < completionRank("delivered")) {
    throw new Error("Standing authorization does not include GitHub delivery.");
  }
  if (
    options.authorization.targetBranch !== null &&
    options.authorization.targetBranch !== options.targetBranch
  ) {
    throw new Error("Standing authorization targets a different protected branch.");
  }
  validateBranch(options.targetBranch);
  validateBranch(options.source.branch);
  validateBranch(options.evidence.branch);
  if (options.source.branch === options.evidence.branch) {
    throw new Error("Source and evidence delivery require distinct branches.");
  }
}

export async function deliverToGitHub(
  options: DeliveryOptions,
): Promise<GitHubDeliveryReceipt> {
  validateDeliveryAuthorization(options);
  const commandReceiptDigests: string[] = [];
  const context: CommandContext = {
    root: options.root,
    runner: options.runner ?? defaultRunner(options.processAdapter),
    receipts: commandReceiptDigests,
  };
  const attempts = options.checkAttempts ?? 12;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 60) {
    throw new Error("GitHub check attempts must be between 1 and 60.");
  }
  const delay =
    options.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  const requiredChecks = [...new Set(options.requiredChecks.map((check) => check.trim()).filter(Boolean))].sort();
  const source = await deliverOne(
    context,
    options.source,
    options.targetBranch,
    requiredChecks,
    markerPrefix(options.repositoryId, options.feature, "source"),
    attempts,
    delay,
  );
  let existingEvidence = await findPullRequest(
    context,
    options.evidence.branch,
    options.targetBranch,
    markerPrefix(options.repositoryId, options.feature, "evidence"),
  );
  if (!existingEvidence) {
    await options.prepareEvidence(source.pullRequest.mergeCommit!);
    const local = await run(
      context,
      ["git", "switch", options.evidence.branch],
      true,
    );
    if (local.result.exitCode !== 0) {
      await run(context, ["git", "fetch", "origin", options.targetBranch]);
      await run(context, [
        "git",
        "switch",
        "--create",
        options.evidence.branch,
        "--track",
        `origin/${options.targetBranch}`,
      ]);
    }
  }
  const evidence = await deliverOne(
    context,
    options.evidence,
    options.targetBranch,
    requiredChecks,
    markerPrefix(options.repositoryId, options.feature, "evidence"),
    attempts,
    delay,
  );
  const evidencePullRequest = evidence.pullRequest;
  const body = {
    schemaVersion: 1 as const,
    repositoryId: options.repositoryId,
    feature: options.feature,
    targetBranch: options.targetBranch,
    source: { ...source.pullRequest, commit: source.commit },
    evidence: { ...evidencePullRequest, commit: evidence.commit },
    requiredChecks,
    commandReceiptDigests,
    deliveredAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  return { ...body, digest: digestJson(body) };
}

export function verifyDeliveryReceipt(receipt: GitHubDeliveryReceipt): void {
  const { digest, ...body } = receipt;
  if (digestJson(body) !== digest) {
    throw new Error(`Delivery receipt for ${receipt.feature} failed its digest check.`);
  }
  if (
    receipt.schemaVersion !== 1 ||
    !FEATURE_ID.test(receipt.feature) ||
    !receipt.repositoryId ||
    !BRANCH.test(receipt.targetBranch) ||
    receipt.source.state !== "MERGED" ||
    receipt.evidence.state !== "MERGED" ||
    !Number.isSafeInteger(receipt.source.number) ||
    !Number.isSafeInteger(receipt.evidence.number) ||
    receipt.source.number <= 0 ||
    receipt.evidence.number <= 0 ||
    !receipt.source.url ||
    !receipt.evidence.url ||
    !COMMIT.test(receipt.source.commit) ||
    !COMMIT.test(receipt.evidence.commit) ||
    !receipt.source.mergeCommit ||
    !receipt.evidence.mergeCommit ||
    !COMMIT.test(receipt.source.mergeCommit) ||
    !COMMIT.test(receipt.evidence.mergeCommit) ||
    receipt.commandReceiptDigests.length === 0 ||
    receipt.commandReceiptDigests.some((value) => !/^sha256:[a-f0-9]{64}$/.test(value)) ||
    !Number.isFinite(Date.parse(receipt.deliveredAt))
  ) {
    throw new Error(`Delivery receipt for ${receipt.feature} is incomplete.`);
  }
}

export interface PublicationObservation {
  tagCommit: string | null;
  releaseCommit: string | null;
  npmVersion: string | null;
  distTagVersion: string | null;
}

export interface PublicationInspection {
  observed: PublicationObservation;
  commandReceiptDigests: string[];
}

export type PublicationAction =
  | "create-tag"
  | "push-tag"
  | "create-github-release"
  | "publish-npm"
  | "set-dist-tag";

export interface PublicationPlan {
  packageName: string;
  version: string;
  tag: string;
  distTag: string;
  commit: string;
  actions: PublicationAction[];
  converged: boolean;
  digest: string;
}

export interface PublicationReceipt {
  schemaVersion: 1;
  repositoryId: string;
  feature: string;
  authorizationDigest: string;
  planDigest: string;
  packageName: string;
  version: string;
  tag: string;
  distTag: string;
  commit: string;
  commandReceiptDigests: string[];
  publishedAt: string;
  digest: string;
}

export function publicationRequestDigest(input: {
  repositoryId: string;
  feature: string;
  packageName: string;
  version: string;
  distTag: string;
  commit: string;
}): string {
  return digestJson({ operation: "publish", ...input });
}

export function planPublication(input: {
  authorization: StandingAuthorization;
  repositoryId: string;
  feature: string;
  packageName: string;
  version: string;
  distTag: string;
  commit: string;
  observed: PublicationObservation;
}): PublicationPlan {
  verifyAuthorization(input.authorization);
  if (
    input.authorization.repositoryId !== input.repositoryId ||
    input.authorization.feature !== input.feature ||
    input.authorization.ceiling !== "published"
  ) {
    throw new Error("Publication requires exact standing authorization through published.");
  }
  if (!PACKAGE.test(input.packageName)) throw new Error(`Invalid npm package name: ${input.packageName}`);
  if (!SEMVER.test(input.version)) throw new Error(`Publication requires an exact semantic version: ${input.version}`);
  if (!DIST_TAG.test(input.distTag) || SEMVER.test(input.distTag)) {
    throw new Error(`Invalid npm dist-tag: ${input.distTag}`);
  }
  if (!COMMIT.test(input.commit)) throw new Error("Publication requires an exact merged commit.");
  if (input.authorization.requestDigest !== publicationRequestDigest({
    repositoryId: input.repositoryId,
    feature: input.feature,
    packageName: input.packageName,
    version: input.version,
    distTag: input.distTag,
    commit: input.commit,
  })) {
    throw new Error("Publication authorization is not bound to this exact version, tag, and commit.");
  }
  const tag = `v${input.version}`;
  const conflicts = [
    ["Git tag", input.observed.tagCommit, input.commit],
    ["GitHub release", input.observed.releaseCommit, input.commit],
    ["npm version", input.observed.npmVersion, input.version],
    ["npm dist-tag", input.observed.distTagVersion, input.version],
  ] as const;
  for (const [label, actual, expected] of conflicts) {
    if (actual !== null && actual !== expected) {
      throw new Error(`${label} is immutable and conflicts with the requested publication.`);
    }
  }
  const actions: PublicationAction[] = [];
  if (input.observed.tagCommit === null) actions.push("create-tag", "push-tag");
  if (input.observed.releaseCommit === null) actions.push("create-github-release");
  if (input.observed.npmVersion === null) actions.push("publish-npm");
  if (input.observed.distTagVersion === null) actions.push("set-dist-tag");
  const body = {
    packageName: input.packageName,
    version: input.version,
    tag,
    distTag: input.distTag,
    commit: input.commit,
    actions,
    converged: actions.length === 0,
  };
  return { ...body, digest: digestJson(body) };
}

export async function executePublicationPlan(input: {
  root: string;
  plan: PublicationPlan;
  runner?: DeliveryRunner;
  processAdapter?: ProcessAdapter;
}): Promise<string[]> {
  verifyPublicationPlan(input.plan);
  const receipts: string[] = [];
  const context: CommandContext = {
    root: input.root,
    runner: input.runner ?? defaultRunner(input.processAdapter),
    receipts,
  };
  for (const action of input.plan.actions) {
    if (action === "create-tag") {
      const localTag = await run(
        context,
        ["git", "rev-parse", "--verify", "--quiet", `refs/tags/${input.plan.tag}^{commit}`],
        true,
      );
      if (localTag.result.exitCode === 0) {
        if (localTag.stdout.trim() !== input.plan.commit) {
          throw new Error("Local Git tag is immutable and conflicts with the publication plan.");
        }
      } else if (localTag.result.exitCode === 1 && !localTag.stdout.trim()) {
        await run(context, [
          "git",
          "tag",
          "--annotate",
          input.plan.tag,
          input.plan.commit,
          "--message",
          `Empirical ${input.plan.version}`,
        ]);
      } else {
        throw new Error(`Could not inspect local Git tag state: ${localTag.stderr.trim() || localTag.result.exitCode}`);
      }
    } else if (action === "push-tag") {
      await run(context, ["git", "push", "origin", `refs/tags/${input.plan.tag}`]);
    } else if (action === "create-github-release") {
      await run(context, [
        "gh",
        "release",
        "create",
        input.plan.tag,
        "--verify-tag",
        "--title",
        input.plan.tag,
        "--generate-notes",
      ]);
    } else if (action === "publish-npm") {
      await run(context, ["npm", "publish", "--access", "public", "--tag", input.plan.distTag]);
    } else {
      await run(context, [
        "npm",
        "dist-tag",
        "add",
        `${input.plan.packageName}@${input.plan.version}`,
        input.plan.distTag,
      ]);
    }
  }
  return receipts;
}

function verifyPublicationPlan(plan: PublicationPlan): void {
  const { digest, ...body } = plan;
  if (digestJson(body) !== digest) throw new Error("Publication plan failed its digest check.");
  const order: PublicationAction[] = [
    "create-tag",
    "push-tag",
    "create-github-release",
    "publish-npm",
    "set-dist-tag",
  ];
  if (
    !PACKAGE.test(plan.packageName)
    || !SEMVER.test(plan.version)
    || plan.tag !== `v${plan.version}`
    || !DIST_TAG.test(plan.distTag)
    || !COMMIT.test(plan.commit)
    || new Set(plan.actions).size !== plan.actions.length
    || plan.actions.some((action) => !order.includes(action))
    || plan.actions.some((action, index) => index > 0 && order.indexOf(action) <= order.indexOf(plan.actions[index - 1]!))
    || plan.converged !== (plan.actions.length === 0)
    || (plan.actions.includes("push-tag") && !plan.actions.includes("create-tag"))
  ) {
    throw new Error("Publication plan has invalid or unsafe lifecycle metadata.");
  }
}

function absentRemoteFact(result: CapturedRuntimeResult): boolean {
  return result.result.exitCode !== 0 && /(?:\b404\b|e404|not found|no release found)/i.test(
    `${result.stdout}\n${result.stderr}`,
  );
}

export async function inspectPublication(input: {
  root: string;
  packageName: string;
  version: string;
  distTag: string;
  runner?: DeliveryRunner;
  processAdapter?: ProcessAdapter;
}): Promise<PublicationInspection> {
  if (!PACKAGE.test(input.packageName)) throw new Error(`Invalid npm package name: ${input.packageName}`);
  if (!SEMVER.test(input.version)) throw new Error(`Publication requires an exact semantic version: ${input.version}`);
  if (!DIST_TAG.test(input.distTag) || SEMVER.test(input.distTag)) {
    throw new Error(`Invalid npm dist-tag: ${input.distTag}`);
  }
  const receipts: string[] = [];
  const context: CommandContext = {
    root: input.root,
    runner: input.runner ?? defaultRunner(input.processAdapter),
    receipts,
  };
  const tag = `v${input.version}`;
  const tagResult = await run(context, [
    "git",
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  let tagCommit: string | null = null;
  for (const line of tagResult.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const [commit, ref] = line.split(/\s+/, 2);
    if (!commit || !ref || !COMMIT.test(commit)) {
      throw new Error("Git returned malformed remote tag state.");
    }
    if (ref === `refs/tags/${tag}^{}` || tagCommit === null) tagCommit = commit;
  }

  const releaseResult = await run(
    context,
    ["gh", "release", "view", tag, "--json", "tagName"],
    true,
  );
  let releaseCommit: string | null = null;
  if (releaseResult.result.exitCode === 0) {
    const release = parseJson(releaseResult.stdout, "gh release view") as Record<string, unknown>;
    if (release.tagName !== tag || tagCommit === null) {
      throw new Error("GitHub release state is not bound to the requested remote tag.");
    }
    releaseCommit = tagCommit;
  } else if (!absentRemoteFact(releaseResult)) {
    throw new Error(`Could not inspect GitHub release state: ${releaseResult.stderr.trim() || releaseResult.result.exitCode}`);
  }

  const versionResult = await run(
    context,
    ["npm", "view", `${input.packageName}@${input.version}`, "version", "--json"],
    true,
  );
  let npmVersion: string | null = null;
  if (versionResult.result.exitCode === 0) {
    const value = parseJson(versionResult.stdout, "npm view version");
    if (typeof value !== "string") throw new Error("npm returned malformed version state.");
    npmVersion = value;
  } else if (!absentRemoteFact(versionResult)) {
    throw new Error(`Could not inspect npm version state: ${versionResult.stderr.trim() || versionResult.result.exitCode}`);
  }

  const tagsResult = await run(
    context,
    ["npm", "view", input.packageName, "dist-tags", "--json"],
    true,
  );
  let distTagVersion: string | null = null;
  if (tagsResult.result.exitCode === 0) {
    const value = parseJson(tagsResult.stdout, "npm view dist-tags");
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("npm returned malformed dist-tag state.");
    }
    const selected = (value as Record<string, unknown>)[input.distTag];
    if (selected !== undefined && typeof selected !== "string") {
      throw new Error("npm returned a malformed selected dist-tag.");
    }
    distTagVersion = typeof selected === "string" ? selected : null;
  } else if (!absentRemoteFact(tagsResult)) {
    throw new Error(`Could not inspect npm dist-tag state: ${tagsResult.stderr.trim() || tagsResult.result.exitCode}`);
  }
  return {
    observed: { tagCommit, releaseCommit, npmVersion, distTagVersion },
    commandReceiptDigests: receipts,
  };
}

export function verifyPublicationReceipt(receipt: PublicationReceipt): void {
  const { digest, ...body } = receipt;
  if (digestJson(body) !== digest) throw new Error("Publication receipt failed its digest check.");
  if (
    receipt.schemaVersion !== 1
    || !FEATURE_ID.test(receipt.feature)
    || !/^sha256:[a-f0-9]{64}$/.test(receipt.authorizationDigest)
    || !/^sha256:[a-f0-9]{64}$/.test(receipt.planDigest)
    || !PACKAGE.test(receipt.packageName)
    || !SEMVER.test(receipt.version)
    || receipt.tag !== `v${receipt.version}`
    || !DIST_TAG.test(receipt.distTag)
    || !COMMIT.test(receipt.commit)
    || receipt.commandReceiptDigests.length === 0
    || receipt.commandReceiptDigests.some((value) => !/^sha256:[a-f0-9]{64}$/.test(value))
    || !Number.isFinite(Date.parse(receipt.publishedAt))
  ) {
    throw new Error("Publication receipt is incomplete.");
  }
}

export async function publishImmutable(input: {
  root: string;
  authorization: StandingAuthorization;
  repositoryId: string;
  feature: string;
  packageName: string;
  version: string;
  distTag: string;
  commit: string;
  runner?: DeliveryRunner;
  processAdapter?: ProcessAdapter;
  now?: () => Date;
}): Promise<PublicationReceipt> {
  planPublication({
    ...input,
    observed: {
      tagCommit: null,
      releaseCommit: null,
      npmVersion: null,
      distTagVersion: null,
    },
  });
  const inspection = await inspectPublication(input);
  const plan = planPublication({ ...input, observed: inspection.observed });
  const mutationReceipts = await executePublicationPlan({
    root: input.root,
    plan,
    ...(input.runner ? { runner: input.runner } : {}),
    ...(input.processAdapter ? { processAdapter: input.processAdapter } : {}),
  });
  const confirmed = await inspectPublication(input);
  const convergence = planPublication({ ...input, observed: confirmed.observed });
  if (!convergence.converged) {
    throw new Error(`Publication did not converge after execution: ${convergence.actions.join(", ")}`);
  }
  const body = {
    schemaVersion: 1 as const,
    repositoryId: input.repositoryId,
    feature: input.feature,
    authorizationDigest: input.authorization.digest,
    planDigest: plan.digest,
    packageName: input.packageName,
    version: input.version,
    tag: plan.tag,
    distTag: input.distTag,
    commit: input.commit,
    commandReceiptDigests: [
      ...inspection.commandReceiptDigests,
      ...mutationReceipts,
      ...confirmed.commandReceiptDigests,
    ],
    publishedAt: (input.now ?? (() => new Date()))().toISOString(),
  };
  const receipt = { ...body, digest: digestJson(body) };
  verifyPublicationReceipt(receipt);
  return receipt;
}

export function localOnlyYoloAuthorization(input: {
  repositoryId: string;
  feature: string;
  requestDigest: string;
  createdAt: string;
}): StandingAuthorization {
  return createAuthorization({
    repositoryId: input.repositoryId,
    feature: input.feature,
    requestDigest: input.requestDigest,
    ceiling: "integrated",
    targetBranch: null,
    allowExternalAgent: false,
    createdAt: input.createdAt,
    expiresAt: null,
  });
}
