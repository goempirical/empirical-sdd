import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  assertSafeDeliveryArgv,
  deliverToGitHub,
  executePublicationPlan,
  githubCliConfigurationEnvironment,
  inspectPublication,
  localOnlyYoloAuthorization,
  planPublication,
  publicationRequestDigest,
  publishImmutable,
  verifyDeliveryReceipt,
  verifyPublicationReceipt,
  type DeliveryRunner,
  type PullRequestFact,
} from "../src/delivery.js";
import { createAuthorization, sha256 } from "../src/protocol.js";
import type {
  CapturedRuntimeResult,
  ProcessAdapter,
  ProcessOutcome,
} from "../src/runtime.js";

const sourceCommit = "1".repeat(40);
const evidenceCommit = "2".repeat(40);
const sourceMerge = "a".repeat(40);
const evidenceMerge = "b".repeat(40);

function captured(stdout = "", exitCode = 0, stderr = ""): CapturedRuntimeResult {
  return {
    stdout,
    stderr,
    result: {
      argv: ["fake"],
      cwd: ".",
      timeoutMs: 1,
      maxOutputBytes: 1,
      environmentKeys: [],
      exitCode,
      signal: null,
      timedOut: false,
      stdoutDigest: sha256(stdout),
      stderrDigest: sha256(stderr),
      stdoutTail: stdout,
      stderrTail: stderr,
      stdoutTruncated: false,
      stderrTruncated: false,
      startedAt: "2026-08-03T10:00:00.000Z",
      completedAt: "2026-08-03T10:00:00.001Z",
    },
  };
}

function processOutcome(stdout = "", exitCode = 0, stderr = ""): ProcessOutcome {
  return {
    exitCode,
    signal: null,
    timedOut: false,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

interface FakePr extends PullRequestFact {
  branch: string;
  head: string;
  body: string;
}

class FakeGitHub {
  readonly commands: string[][] = [];
  readonly pullRequests = new Map<string, FakePr>();
  currentBranch = "feature/source";
  localTagCommit: string | null = null;
  remoteTagCommit: string | null = null;
  releaseExists = false;
  npmVersions = new Set<string>();
  distTags: Record<string, string> = {};
  checkResponses: Array<{ exitCode: number; checks: unknown[] }> = [
    { exitCode: 0, checks: [{ name: "ci", state: "SUCCESS", bucket: "pass", link: "" }] },
  ];

  runner: DeliveryRunner = async (_root, argv) => {
    this.commands.push([...argv]);
    if (argv[0] === "git") return this.git(argv);
    if (argv[0] === "gh") return this.gh(argv);
    if (argv[0] === "npm") return this.npm(argv);
    return captured("", 1, "unexpected executable");
  };

  private git(argv: string[]): CapturedRuntimeResult {
    if (argv[1] === "symbolic-ref") return captured(`${this.currentBranch}\n`);
    if (argv[1] === "diff") return captured("");
    if (argv[1] === "status") return captured(" M tracked-file\n");
    if (argv[1] === "ls-remote") {
      return captured(this.remoteTagCommit ? `${this.remoteTagCommit}\trefs/tags/v0.23.0\n` : "");
    }
    if (argv[1] === "tag") {
      this.localTagCommit = argv[4] ?? null;
      return captured("");
    }
    if (argv[1] === "push" && argv.some((part) => part.startsWith("refs/tags/"))) {
      this.remoteTagCommit = this.localTagCommit;
      return captured("");
    }
    if (argv[1] === "add" || argv[1] === "commit" || argv[1] === "push" || argv[1] === "fetch") {
      return captured("");
    }
    if (argv[1] === "rev-parse") {
      if (argv.some((part) => part.startsWith("refs/tags/"))) {
        return this.localTagCommit
          ? captured(`${this.localTagCommit}\n`)
          : captured("", 1, "unknown revision");
      }
      return captured(`${this.currentBranch === "feature/evidence" ? evidenceCommit : sourceCommit}\n`);
    }
    if (argv[1] === "switch" && argv[2] === "feature/evidence") {
      return captured("", 1, "branch not found");
    }
    if (argv[1] === "switch" && argv.includes("--create")) {
      this.currentBranch = "feature/evidence";
      return captured("");
    }
    return captured("", 1, `unexpected git command: ${argv.join(" ")}`);
  }

  private gh(argv: string[]): CapturedRuntimeResult {
    if (argv[1] === "pr" && argv[2] === "list") {
      const branch = argv[argv.indexOf("--head") + 1]!;
      const pr = this.pullRequests.get(branch);
      return captured(`${JSON.stringify(pr ? [pr] : [])}\n`);
    }
    if (argv[1] === "pr" && argv[2] === "create") {
      const branch = argv[argv.indexOf("--head") + 1]!;
      const number = branch === "feature/source" ? 11 : 12;
      const head = branch === "feature/source" ? sourceCommit : evidenceCommit;
      const body = argv[argv.indexOf("--body") + 1]!;
      this.pullRequests.set(branch, {
        branch,
        number,
        url: `https://github.example/pr/${number}`,
        state: "OPEN",
        mergeCommit: null,
        head,
        body,
      });
      return captured(`https://github.example/pr/${number}\n`);
    }
    if (argv[1] === "pr" && argv[2] === "checks") {
      const response = this.checkResponses.length > 1
        ? this.checkResponses.shift()!
        : this.checkResponses[0]!;
      return captured(`${JSON.stringify(response.checks)}\n`, response.exitCode);
    }
    if (argv[1] === "pr" && argv[2] === "merge") {
      const number = Number(argv[3]);
      const pr = [...this.pullRequests.values()].find((value) => value.number === number)!;
      pr.state = "MERGED";
      pr.mergeCommit = number === 11 ? sourceMerge : evidenceMerge;
      return captured("");
    }
    if (argv[1] === "pr" && argv[2] === "view") {
      const number = Number(argv[3]);
      const pr = [...this.pullRequests.values()].find((value) => value.number === number)!;
      if (argv[argv.indexOf("--json") + 1] === "headRefOid") {
        return captured(`${JSON.stringify({ headRefOid: pr.head })}\n`);
      }
      return captured(`${JSON.stringify(pr)}\n`);
    }
    if (argv[1] === "release" && argv[2] === "view") {
      return this.releaseExists
        ? captured(`${JSON.stringify({ tagName: "v0.23.0" })}\n`)
        : captured("", 1, "release not found (404)");
    }
    if (argv[1] === "release" && argv[2] === "create") {
      this.releaseExists = true;
      return captured("");
    }
    return captured("", 1, `unexpected gh command: ${argv.join(" ")}`);
  }

  private npm(argv: string[]): CapturedRuntimeResult {
    if (argv[1] === "view" && argv[3] === "version") {
      const version = argv[2]?.split("@").at(-1) ?? "";
      return this.npmVersions.has(version)
        ? captured(`${JSON.stringify(version)}\n`)
        : captured("", 1, "npm error E404 version not found");
    }
    if (argv[1] === "view" && argv[3] === "dist-tags") {
      return this.npmVersions.size > 0
        ? captured(`${JSON.stringify(this.distTags)}\n`)
        : captured("", 1, "npm error E404 package not found");
    }
    if (argv[1] === "publish") {
      this.npmVersions.add("0.23.0");
      this.distTags[argv[argv.indexOf("--tag") + 1] ?? "latest"] = "0.23.0";
      return captured("ok\n");
    }
    if (argv[1] === "dist-tag" && argv[2] === "add") {
      this.distTags[argv[4] ?? "latest"] = argv[3]?.split("@").at(-1) ?? "";
      return captured("ok\n");
    }
    return captured("", 1, `unexpected npm command: ${argv.join(" ")}`);
  }
}

function deliveryAuthorization(ceiling: "integrated" | "delivered" | "published" = "delivered") {
  return createAuthorization({
    repositoryId: "repo-1",
    feature: "delivery-feature",
    requestDigest: sha256("request"),
    ceiling,
    targetBranch: "main",
    allowExternalAgent: false,
    createdAt: "2026-08-03T09:00:00.000Z",
    expiresAt: null,
  });
}

function publicationAuthorization() {
  return createAuthorization({
    repositoryId: "repo-1",
    feature: "delivery-feature",
    requestDigest: publicationRequestDigest({
      repositoryId: "repo-1",
      feature: "delivery-feature",
      packageName: "empirical-sdd",
      version: "0.23.0",
      distTag: "latest",
      commit: sourceMerge,
    }),
    ceiling: "published",
    targetBranch: "main",
    allowExternalAgent: false,
    createdAt: "2026-08-03T09:00:00.000Z",
    expiresAt: null,
  });
}

function deliveryOptions(fake: FakeGitHub) {
  return {
    root: "/tmp/fake-repository",
    repositoryId: "repo-1",
    feature: "delivery-feature",
    authorization: deliveryAuthorization(),
    targetBranch: "main",
    requiredChecks: ["ci"],
    source: {
      branch: "feature/source",
      paths: ["src", "tests"],
      message: "feat: source",
      title: "Source change",
      body: "Implement the approved source change.",
    },
    evidence: {
      branch: "feature/evidence",
      paths: [".empirical"],
      message: "docs: evidence",
      title: "Evidence and specifications",
      body: "Integrate evidence and living specifications.",
    },
    prepareEvidence: async (_commit: string) => undefined,
    runner: fake.runner,
    delay: async () => undefined,
    checkAttempts: 3,
    now: () => new Date("2026-08-03T12:00:00Z"),
  } as const;
}

describe("bounded GitHub delivery", () => {
  test("uses two protected pull requests and derives delivery from remote merge facts", async () => {
    const fake = new FakeGitHub();
    let preparedFrom = "";
    const receipt = await deliverToGitHub({
      ...deliveryOptions(fake),
      prepareEvidence: async (commit) => {
        preparedFrom = commit;
      },
    });
    expect(preparedFrom).toBe(sourceMerge);
    expect(receipt).toMatchObject({
      source: { number: 11, state: "MERGED", commit: sourceCommit, mergeCommit: sourceMerge },
      evidence: { number: 12, state: "MERGED", commit: evidenceCommit, mergeCommit: evidenceMerge },
      targetBranch: "main",
      requiredChecks: ["ci"],
    });
    expect(() => verifyDeliveryReceipt(receipt)).not.toThrow();
    expect(fake.commands.filter((argv) => argv.slice(0, 3).join(" ") === "gh pr create")).toHaveLength(2);
    expect(fake.commands.filter((argv) => argv.slice(0, 3).join(" ") === "gh pr merge")).toHaveLength(2);
    expect(fake.commands.flat()).not.toContain("--force");
    expect(fake.commands.flat()).not.toContain("--admin");
    expect(fake.commands.some((argv) => argv.some((part) => part.includes("empirical-delivery:repo-1:delivery-feature:source")))).toBe(true);
    expect(fake.commands.some((argv) => argv.some((part) => part.includes("empirical-delivery:repo-1:delivery-feature:evidence")))).toBe(true);
  });

  test("resumes from matching merged remote PRs without duplicate mutations", async () => {
    const fake = new FakeGitHub();
    fake.pullRequests.set("feature/source", {
      branch: "feature/source",
      number: 11,
      url: "https://github.example/pr/11",
      state: "MERGED",
      mergeCommit: sourceMerge,
      head: sourceCommit,
      body: `source\n\n<!-- empirical-delivery:repo-1:delivery-feature:source:commit=${sourceCommit} -->`,
    });
    fake.pullRequests.set("feature/evidence", {
      branch: "feature/evidence",
      number: 12,
      url: "https://github.example/pr/12",
      state: "MERGED",
      mergeCommit: evidenceMerge,
      head: evidenceCommit,
      body: `evidence\n\n<!-- empirical-delivery:repo-1:delivery-feature:evidence:commit=${evidenceCommit} -->`,
    });
    let prepared = false;
    const receipt = await deliverToGitHub({
      ...deliveryOptions(fake),
      prepareEvidence: async () => {
        prepared = true;
      },
    });
    expect(receipt.evidence.state).toBe("MERGED");
    expect(prepared).toBe(false);
    expect(fake.commands.some((argv) => argv[0] === "git" && argv[1] === "push")).toBe(false);
    expect(fake.commands.some((argv) => argv[0] === "gh" && argv[2] === "create")).toBe(false);
    expect(fake.commands.some((argv) => argv[0] === "gh" && argv[2] === "merge")).toBe(false);
  });

  test("waits for pending checks and stops on failed checks before merge", async () => {
    const pending = new FakeGitHub();
    pending.checkResponses = [
      { exitCode: 1, checks: [{ name: "ci", state: "PENDING", bucket: "pending" }] },
      { exitCode: 0, checks: [{ name: "ci", state: "SUCCESS", bucket: "pass" }] },
    ];
    const receipt = await deliverToGitHub(deliveryOptions(pending));
    expect(receipt.source.state).toBe("MERGED");
    expect(pending.commands.filter((argv) => argv[2] === "checks").length).toBeGreaterThanOrEqual(3);

    const failed = new FakeGitHub();
    failed.checkResponses = [
      { exitCode: 1, checks: [{ name: "ci", state: "FAILURE", bucket: "fail" }] },
    ];
    await expect(deliverToGitHub(deliveryOptions(failed))).rejects.toThrow(
      "Required GitHub checks failed",
    );
    expect(failed.commands.some((argv) => argv[2] === "merge")).toBe(false);
    expect(failed.pullRequests.has("feature/evidence")).toBe(false);
  });

  test("requires matching explicit delivery authority before any command", async () => {
    const fake = new FakeGitHub();
    await expect(
      deliverToGitHub({
        ...deliveryOptions(fake),
        authorization: deliveryAuthorization("integrated"),
      }),
    ).rejects.toThrow("does not include GitHub delivery");
    expect(fake.commands).toHaveLength(0);
    await expect(
      deliverToGitHub({
        ...deliveryOptions(fake),
        authorization: createAuthorization({
          repositoryId: "other",
          feature: "delivery-feature",
          requestDigest: sha256("request"),
          ceiling: "delivered",
          targetBranch: "main",
          allowExternalAgent: false,
          createdAt: "2026-08-03T09:00:00.000Z",
          expiresAt: null,
        }),
      }),
    ).rejects.toThrow("does not match");
    expect(fake.commands).toHaveLength(0);
  });

  test("binds new commits to the exact branch and repository-contained paths", async () => {
    const wrongBranch = new FakeGitHub();
    wrongBranch.currentBranch = "feature/other";
    await expect(deliverToGitHub(deliveryOptions(wrongBranch))).rejects.toThrow(
      "requires checked-out branch feature/source",
    );
    expect(wrongBranch.commands.some((argv) => argv[1] === "commit")).toBe(false);

    for (const path of ["../outside", "/tmp/outside", "src/../../outside"]) {
      const fake = new FakeGitHub();
      await expect(deliverToGitHub({
        ...deliveryOptions(fake),
        source: { ...deliveryOptions(fake).source, paths: [path] },
      })).rejects.toThrow("repository-contained paths");
      expect(fake.commands.some((argv) => argv[1] === "status" || argv[1] === "commit")).toBe(false);
    }

    const stagedOutside = new FakeGitHub();
    const baseRunner = stagedOutside.runner;
    stagedOutside.runner = async (root, argv) => argv[0] === "git" && argv[1] === "diff"
      ? captured("unrelated.txt\0")
      : baseRunner(root, argv);
    await expect(deliverToGitHub(deliveryOptions(stagedOutside))).rejects.toThrow(
      "staged paths outside",
    );
    expect(stagedOutside.commands.some((argv) => argv[1] === "commit")).toBe(false);
  });

  test("rejects foreign or moved pull requests before checks or merge", async () => {
    const foreign = new FakeGitHub();
    foreign.pullRequests.set("feature/source", {
      branch: "feature/source",
      number: 11,
      url: "https://github.example/pr/11",
      state: "OPEN",
      mergeCommit: null,
      head: sourceCommit,
      body: "An unrelated pull request.",
    });
    await expect(deliverToGitHub(deliveryOptions(foreign))).rejects.toThrow("not owned");
    expect(foreign.commands.some((argv) => argv[2] === "checks" || argv[2] === "merge")).toBe(false);

    const moved = new FakeGitHub();
    moved.pullRequests.set("feature/source", {
      branch: "feature/source",
      number: 11,
      url: "https://github.example/pr/11",
      state: "OPEN",
      mergeCommit: null,
      head: evidenceCommit,
      body: `source\n\n<!-- empirical-delivery:repo-1:delivery-feature:source:commit=${sourceCommit} -->`,
    });
    await expect(deliverToGitHub(deliveryOptions(moved))).rejects.toThrow("head changed");
    expect(moved.commands.some((argv) => argv[2] === "checks" || argv[2] === "merge")).toBe(false);
  });

  test("an explicitly empty required-check policy performs no check polling", async () => {
    const fake = new FakeGitHub();
    const receipt = await deliverToGitHub({ ...deliveryOptions(fake), requiredChecks: [] });
    expect(receipt.requiredChecks).toEqual([]);
    expect(fake.commands.some((argv) => argv[2] === "checks")).toBe(false);
  });

  test("structurally rejects force, admin, deletion, credential, and worktree operations", () => {
    for (const argv of [
      ["git", "push", "--force", "origin", "main"],
      ["gh", "pr", "merge", "1", "--admin"],
      ["git", "branch", "-D", "main"],
      ["git", "worktree", "remove", "/tmp/real"],
      ["git", "push", "origin", ":main"],
      ["gh", "api", "x", "--header", "token=secret"],
    ]) {
      expect(() => assertSafeDeliveryArgv(argv)).toThrow("Forbidden");
    }
    expect(() =>
      assertSafeDeliveryArgv(["gh", "pr", "merge", "1", "--merge"]),
    ).not.toThrow();
  });
});

describe("GitHub CLI authentication boundary", () => {
  test("resolves the documented configuration-directory precedence without token access", () => {
    expect(githubCliConfigurationEnvironment({
      env: { GH_CONFIG_DIR: " /explicit/gh " },
      platform: "linux",
      home: "/home/tester",
    })).toEqual({ GH_CONFIG_DIR: "/explicit/gh" });
    expect(githubCliConfigurationEnvironment({
      env: { XDG_CONFIG_HOME: "/xdg" },
      platform: "linux",
      home: "/home/tester",
    })).toEqual({ GH_CONFIG_DIR: join("/xdg", "gh") });
    expect(githubCliConfigurationEnvironment({
      env: { APPDATA: "C:/Users/tester/AppData/Roaming" },
      platform: "win32",
      home: "C:/Users/tester",
    })).toEqual({
      GH_CONFIG_DIR: join("C:/Users/tester/AppData/Roaming", "GitHub CLI"),
    });
    expect(githubCliConfigurationEnvironment({
      env: {},
      platform: "linux",
      home: "/home/tester",
    })).toEqual({ GH_CONFIG_DIR: join("/home/tester", ".config", "gh") });
    expect(() => githubCliConfigurationEnvironment({
      env: {},
      platform: "linux",
      home: " ",
    })).toThrow("operating-system home");
  });

  test("passes only the non-secret configuration locator to built-in gh commands", async () => {
    const invocations: Parameters<ProcessAdapter>[0][] = [];
    const adapter: ProcessAdapter = async (invocation) => {
      invocations.push(invocation);
      if (invocation.executable === "git") return processOutcome("");
      if (invocation.executable === "gh") {
        return processOutcome("", 1, "release not found (404)");
      }
      if (invocation.executable === "npm" && invocation.args.includes("dist-tags")) {
        return processOutcome('{"latest":"0.23.0"}\n');
      }
      if (invocation.executable === "npm") {
        return processOutcome("", 1, "npm error E404 version not found");
      }
      return processOutcome("", 1, "unexpected executable");
    };
    const configDirectory = join("/private", "host-gh-config");
    const previous = process.env.GH_CONFIG_DIR;
    process.env.GH_CONFIG_DIR = configDirectory;
    try {
      const inspection = await inspectPublication({
        root: process.cwd(),
        packageName: "empirical-sdd",
        version: "0.24.0",
        distTag: "latest",
        processAdapter: adapter,
      });
      const gh = invocations.find((entry) => entry.executable === "gh");
      expect(gh?.env.GH_CONFIG_DIR).toBe(configDirectory);
      expect(gh?.env.HOME).toBeUndefined();
      expect(gh?.env.GH_TOKEN).toBeUndefined();
      expect(gh?.env.GITHUB_TOKEN).toBeUndefined();
      expect(invocations.filter((entry) => entry.executable !== "gh").every(
        (entry) => entry.env.GH_CONFIG_DIR === undefined,
      )).toBe(true);
      expect(JSON.stringify(inspection)).not.toContain(configDirectory);
      expect(inspection.commandReceiptDigests).toHaveLength(4);
    } finally {
      if (previous === undefined) delete process.env.GH_CONFIG_DIR;
      else process.env.GH_CONFIG_DIR = previous;
    }
  });

  test("reports an unusable stored login without credential fallback", async () => {
    const adapter: ProcessAdapter = async (invocation) => {
      if (invocation.executable === "git") return processOutcome("");
      if (invocation.executable === "gh") {
        expect(invocation.env.GH_CONFIG_DIR).toBeTruthy();
        expect(invocation.env.HOME).toBeUndefined();
        return processOutcome("", 1, "You are not logged into any GitHub hosts.");
      }
      return processOutcome("", 1, "must stop before npm inspection");
    };
    await expect(inspectPublication({
      root: process.cwd(),
      packageName: "empirical-sdd",
      version: "0.24.0",
      distTag: "latest",
      processAdapter: adapter,
    })).rejects.toThrow("Could not inspect GitHub release state");
  });
});

describe("explicit immutable publication", () => {
  test("ordinary YOLO remains local/integrated and cannot infer publication", () => {
    const local = localOnlyYoloAuthorization({
      repositoryId: "repo-1",
      feature: "delivery-feature",
      requestDigest: sha256("request"),
      createdAt: "2026-08-03T09:00:00.000Z",
    });
    expect(local.ceiling).toBe("integrated");
    expect(() =>
      planPublication({
        authorization: local,
        repositoryId: "repo-1",
        feature: "delivery-feature",
        packageName: "empirical-sdd",
        version: "0.23.0",
        distTag: "latest",
        commit: sourceMerge,
        observed: {
          tagCommit: null,
          releaseCommit: null,
          npmVersion: null,
          distTagVersion: null,
        },
      }),
    ).toThrow("exact standing authorization");
  });

  test("plans only absent immutable artifacts and converges identical retries", () => {
    const authorization = publicationAuthorization();
    const missing = planPublication({
      authorization,
      repositoryId: "repo-1",
      feature: "delivery-feature",
      packageName: "empirical-sdd",
      version: "0.23.0",
      distTag: "latest",
      commit: sourceMerge,
      observed: {
        tagCommit: null,
        releaseCommit: null,
        npmVersion: null,
        distTagVersion: null,
      },
    });
    expect(missing.actions).toEqual([
      "create-tag",
      "push-tag",
      "create-github-release",
      "publish-npm",
      "set-dist-tag",
    ]);
    const converged = planPublication({
      authorization,
      repositoryId: "repo-1",
      feature: "delivery-feature",
      packageName: "empirical-sdd",
      version: "0.23.0",
      distTag: "latest",
      commit: sourceMerge,
      observed: {
        tagCommit: sourceMerge,
        releaseCommit: sourceMerge,
        npmVersion: "0.23.0",
        distTagVersion: "0.23.0",
      },
    });
    expect(converged).toMatchObject({ actions: [], converged: true });
  });

  test("stops on immutable conflicts and executes an approved plan without replacement flags", async () => {
    const authorization = publicationAuthorization();
    expect(() =>
      planPublication({
        authorization,
        repositoryId: "repo-1",
        feature: "delivery-feature",
        packageName: "empirical-sdd",
        version: "0.23.0",
        distTag: "latest",
        commit: sourceMerge,
        observed: {
          tagCommit: evidenceMerge,
          releaseCommit: null,
          npmVersion: null,
          distTagVersion: null,
        },
      }),
    ).toThrow("immutable and conflicts");
    const fake = new FakeGitHub();
    const plan = planPublication({
      authorization,
      repositoryId: "repo-1",
      feature: "delivery-feature",
      packageName: "empirical-sdd",
      version: "0.23.0",
      distTag: "latest",
      commit: sourceMerge,
      observed: {
        tagCommit: null,
        releaseCommit: null,
        npmVersion: null,
        distTagVersion: null,
      },
    });
    const receipts = await executePublicationPlan({
      root: "/tmp/fake-repository",
      plan,
      runner: fake.runner,
    });
    expect(receipts).toHaveLength(6);
    expect(fake.commands.flat()).not.toContain("--force");
    expect(fake.commands.flat()).not.toContain("--delete");
    expect(fake.commands).toContainEqual([
      "npm",
      "publish",
      "--access",
      "public",
      "--tag",
      "latest",
    ]);
  });

  test("queries remote publication state and verifies convergence independently", async () => {
    const fake = new FakeGitHub();
    const receipt = await publishImmutable({
      root: "/tmp/fake-repository",
      authorization: publicationAuthorization(),
      repositoryId: "repo-1",
      feature: "delivery-feature",
      packageName: "empirical-sdd",
      version: "0.23.0",
      distTag: "latest",
      commit: sourceMerge,
      runner: fake.runner,
      now: () => new Date("2026-08-03T12:00:00Z"),
    });
    expect(() => verifyPublicationReceipt(receipt)).not.toThrow();
    expect(receipt).toMatchObject({ version: "0.23.0", commit: sourceMerge });
    expect(fake.remoteTagCommit).toBe(sourceMerge);
    expect(fake.releaseExists).toBe(true);
    expect(fake.npmVersions.has("0.23.0")).toBe(true);
    expect(fake.distTags.latest).toBe("0.23.0");
    expect(fake.commands.filter((argv) => argv[1] === "view").length).toBeGreaterThanOrEqual(4);
  });
});
