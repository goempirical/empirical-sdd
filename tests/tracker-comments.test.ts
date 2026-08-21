import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createTrackerMilestoneView,
  inspectTrackerMilestoneMarker,
  legacyTrackerMilestoneMarker,
  renderTrackerMilestone,
} from "../src/tracker-comments.js";
import type {
  TrackerArtifact,
  TrackerProjection,
  TrackerProvider,
} from "../src/types.js";

const effectKey = `sha256:${"a".repeat(64)}`;

function projection(overrides: Partial<TrackerProjection> = {}): TrackerProjection {
  return {
    schemaVersion: 2,
    feature: "human-first-tracker-comments",
    phase: "implement",
    status: "waiting",
    revision: 7,
    completionLevel: "none",
    progress: "in-progress",
    summary: "Made tracker updates easier to scan.",
    blocker: null,
    receiptIds: [],
    receiptDigest: `sha256:${"b".repeat(64)}`,
    artifacts: [],
    marker: "empirical-sdd:human-first-tracker-comments:r7",
    digest: `sha256:${"c".repeat(64)}`,
    ...overrides,
  };
}

function artifact(overrides: Partial<TrackerArtifact> = {}): TrackerArtifact {
  return {
    receiptId: "collected-review-evidence",
    path: "private/review.png",
    mediaType: "image/png",
    digest: `sha256:${"d".repeat(64)}`,
    size: 128,
    url: "https://github.com/goempirical/empirical-sdd/blob/abc/review.png",
    ...overrides,
  };
}

function jiraText(value: unknown): string[] {
  if (typeof value === "string") return [];
  if (Array.isArray(value)) return value.flatMap(jiraText);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.type === "text" && typeof record.text === "string" ? [record.text] : []),
    ...Object.values(record).flatMap(jiraText),
  ];
}

function visibleMarkdown(body: string): string {
  return body
    .replace(/<!--[^]*?-->/g, "")
    .replace(/\[([^\]]+)]\(<[^>]+>\)/g, "$1")
    .replace(/[\\*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("human-first tracker milestone comments", () => {
  test("derives deterministic truthful headlines for progress, stops, and final proof", () => {
    const cases: Array<[Partial<TrackerProjection>, string]> = [
      [{ phase: "specify", progress: "specification" }, "Defining the work"],
      [{ phase: "plan", progress: "planned" }, "Plan ready"],
      [{ phase: "implement" }, "Implementation in progress"],
      [{ phase: "verify", progress: "verification" }, "Verification in progress"],
      [{ phase: "review", progress: "review" }, "Ready for review"],
      [{ phase: "integrate", progress: "review" }, "Integration in progress"],
      [{ phase: "deliver", progress: "review" }, "Delivery in progress"],
      [{ phase: "publish", progress: "review" }, "Publication in progress"],
      [{ phase: "archive", progress: "review" }, "Wrapping up"],
      [{ status: "awaiting_human", progress: "blocked" }, "Input needed"],
      [{ status: "blocked", progress: "blocked" }, "Work is blocked"],
      [{ phase: "done", status: "done", completionLevel: "none", progress: "done" }, "Workflow complete"],
      [{ phase: "done", status: "done", completionLevel: "implemented", progress: "done" }, "Implementation complete"],
      [{ phase: "done", status: "done", completionLevel: "verified", progress: "done" }, "Verification complete"],
      [{ phase: "done", status: "done", completionLevel: "integrated", progress: "done" }, "Integration complete"],
      [{ phase: "done", status: "done", completionLevel: "delivered", progress: "done" }, "Delivery complete"],
      [{ phase: "done", status: "done", completionLevel: "published", progress: "done" }, "Publication complete"],
    ];
    for (const [overrides, headline] of cases) {
      expect(createTrackerMilestoneView(projection(overrides)).headline).toBe(headline);
    }
  });

  test("humanizes work and shows stop details once with distinct action labels", () => {
    const awaiting = createTrackerMilestoneView(projection({
      status: "awaiting_human",
      progress: "blocked",
      summary: "Choose the rollout audience.",
      blocker: "Choose the rollout audience.",
    }));
    expect(awaiting).toMatchObject({
      work: "Human first tracker comments",
      summary: null,
      action: { label: "Action needed", text: "Choose the rollout audience." },
    });

    const blocked = createTrackerMilestoneView(projection({
      status: "blocked",
      progress: "blocked",
      summary: "Provider setup is incomplete.",
      blocker: "Missing project permission.",
    }));
    expect(blocked).toMatchObject({
      summary: "Provider setup is incomplete.",
      action: { label: "Blocker", text: "Missing project permission." },
    });

    const noSummary = createTrackerMilestoneView(projection({ summary: null }));
    expect(noSummary.summary).toBeNull();
    expect(noSummary.action).toBeNull();
  });

  test("serializes one human hierarchy as Markdown or native Jira ADF", () => {
    const source = projection({ phase: "review", progress: "review" });
    const github = renderTrackerMilestone("github", source, effectKey);
    const linear = renderTrackerMilestone("linear", source, effectKey);
    const jira = renderTrackerMilestone("jira", source, effectKey);
    expect(github.provider).toBe("github");
    expect(linear.provider).toBe("linear");
    expect(jira.provider).toBe("jira");
    if (github.provider !== "github" || linear.provider !== "linear" || jira.provider !== "jira") {
      throw new Error("Provider payload narrowing failed");
    }

    for (const body of [github.body, linear.body]) {
      const visible = visibleMarkdown(body);
      expect(visible).toContain("Ready for review");
      expect(visible).toContain("Human first tracker comments");
      expect(visible).toContain("Made tracker updates easier to scan.");
      expect(visible).not.toContain(source.feature);
      expect(visible).not.toContain("Revision:");
      expect(visible).not.toContain("Completion:");
      expect(visible).not.toContain("sha256:");
    }
    expect(github.body).toContain(`<!-- empirical-sdd-effect:${effectKey} -->`);
    expect(linear.body).toContain("_[Managed by Empirical]");

    const text = jiraText(jira.body).join(" ");
    expect(text).toContain("Ready for review");
    expect(text).toContain("Human first tracker comments");
    expect(text).toContain("Made tracker updates easier to scan.");
    expect(text).not.toContain(source.feature);
    expect(text).not.toContain("sha256:");
    expect(JSON.stringify(jira.body)).toContain('"type":"heading"');
    expect(JSON.stringify(jira.body)).toContain(`empirical-milestone:${effectKey}`);
    expect(jira.property).toEqual({ key: "empirical-sdd-effect", value: effectKey });
  });

  test("shows only safe durable evidence with friendly deterministic labels", () => {
    const view = createTrackerMilestoneView(projection({
      artifacts: [
        artifact(),
        artifact({
          receiptId: "collected-second-screenshot",
          path: "another/raw/path.webp",
          mediaType: "image/webp",
          url: "https://github.com/goempirical/empirical-sdd/blob/abc/second.webp",
        }),
        artifact({
          receiptId: "collected-report",
          path: "raw/report.json",
          mediaType: "application/json",
          url: "https://github.com/goempirical/empirical-sdd/blob/abc/report.json",
        }),
        artifact({ receiptId: "collected-native-upload", url: null }),
        artifact({ receiptId: "collected-insecure", url: "http://example.com/review.png" }),
        artifact({ receiptId: "collected-secret-link", url: "https://example.com/review?token=private" }),
        artifact({ receiptId: "collected-encoded-secret-link", url: "https://example.com/review?to%6Ben%3Dprivate" }),
        artifact({ receiptId: "collected-marker-link", url: `https://example.com/${effectKey}` }),
        artifact({
          receiptId: "collected-encoded-marker-link",
          url: `https://example.com/empirical-milestone%3A${encodeURIComponent(effectKey)}`,
        }),
      ],
    }));
    expect(view.evidence).toEqual([
      { label: "Screenshot 1", url: "https://github.com/goempirical/empirical-sdd/blob/abc/review.png" },
      { label: "Screenshot 2", url: "https://github.com/goempirical/empirical-sdd/blob/abc/second.webp" },
      { label: "Report", url: "https://github.com/goempirical/empirical-sdd/blob/abc/report.json" },
    ]);

    for (const provider of ["github", "linear", "jira"] as const) {
      const payload = renderTrackerMilestone(provider, projection({ artifacts: [artifact()] }), effectKey);
      const serialized = JSON.stringify(payload.body);
      expect(serialized).toContain("Screenshot");
      expect(serialized).not.toContain("private/review.png");
      expect(serialized).not.toContain("collected-review-evidence");
      expect(serialized).not.toContain("pending or unsupported");
    }
  });

  test("bounds and neutralizes adversarial human content for every provider", () => {
    const digest = `sha256:${"e".repeat(64)}`;
    const malicious = [
      "# Urgent <!-- empirical-sdd-effect:",
      effectKey,
      "--> [@all](https://evil.example) token=private",
      "executed-secret-receipt",
      digest,
      "\u202e",
      "x".repeat(600),
    ].join("\n");
    const source = projection({ summary: malicious });
    const view = createTrackerMilestoneView(source);
    expect(view.summary).not.toBeNull();
    expect([...(view.summary ?? "")].length).toBeLessThanOrEqual(320);
    expect(view.summary).not.toContain("\n");
    expect(view.summary).not.toContain("<!--");
    expect(view.summary).not.toContain("@");
    expect(view.summary).toContain("＠all");
    expect(view.summary).not.toContain(effectKey);
    expect(view.summary).not.toContain(digest);
    expect(view.summary).not.toContain("executed-secret-receipt");
    expect(view.summary).not.toContain("token=private");

    for (const provider of ["github", "linear", "jira"] as TrackerProvider[]) {
      const payload = renderTrackerMilestone(provider, source, effectKey);
      const human = provider === "jira"
        ? jiraText(payload.body).join(" ")
        : visibleMarkdown(payload.body as string);
      expect(human).not.toContain("https://evil.example");
      expect(human).not.toContain("token=private");
      expect(human).not.toContain(digest);
      expect(human).not.toContain("executed-secret-receipt");
      if (provider === "jira") {
        const headings = ((payload.body as Record<string, unknown>).content as Record<string, unknown>[])
          .filter((node) => node.type === "heading")
          .flatMap(jiraText);
        expect(headings).toEqual(["Implementation in progress"]);
      } else {
        expect(payload.body as string).toContain("\\# Urgent");
        expect(payload.body as string).not.toContain("\n# Urgent");
      }
    }
  });

  test("recognizes exact current and legacy markers for every provider", () => {
    const legacy = legacyTrackerMilestoneMarker(effectKey);
    for (const provider of ["github", "linear"] as const) {
      const current = renderTrackerMilestone(provider, projection(), effectKey);
      expect(inspectTrackerMilestoneMarker(provider, { body: current.body }, effectKey)).toBe("match");
      expect(inspectTrackerMilestoneMarker(provider, { body: `Older update\n${legacy}` }, effectKey)).toBe("match");
      expect(inspectTrackerMilestoneMarker(provider, { body: "An unrelated comment" }, effectKey)).toBe("absent");
    }

    const jira = renderTrackerMilestone("jira", projection(), effectKey);
    expect(inspectTrackerMilestoneMarker("jira", {
      body: jira.body,
      properties: [jira.property],
    }, effectKey)).toBe("match");
    expect(inspectTrackerMilestoneMarker("jira", {
      body: { version: 1, type: "doc", content: [{
        type: "paragraph",
        content: [{ type: "text", text: legacy }],
      }] },
    }, effectKey)).toBe("match");
    expect(inspectTrackerMilestoneMarker("jira", {
      properties: { "empirical-sdd-effect": effectKey },
    }, effectKey)).toBe("match");
  });

  test("fails closed on partial, surrounded, duplicated, or malformed expected markers", () => {
    const legacy = legacyTrackerMilestoneMarker(effectKey);
    for (const provider of ["github", "linear"] as const) {
      const current = renderTrackerMilestone(provider, projection(), effectKey);
      expect(inspectTrackerMilestoneMarker(provider, { body: `quoted ${legacy}` }, effectKey)).toBe("malformed");
      expect(inspectTrackerMilestoneMarker(provider, { body: `${current.body}\n${legacy}` }, effectKey)).toBe("malformed");
      expect(inspectTrackerMilestoneMarker(provider, { body: `unowned ${effectKey}` }, effectKey)).toBe("malformed");
    }

    const jira = renderTrackerMilestone("jira", projection(), effectKey);
    if (jira.provider !== "jira") throw new Error("Expected Jira payload");
    const wrongText = JSON.parse(JSON.stringify(jira.body)) as Record<string, any>;
    const footer = wrongText.content.at(-1).content[0];
    footer.text = "Unowned marker";
    expect(inspectTrackerMilestoneMarker("jira", { body: wrongText }, effectKey)).toBe("malformed");
    expect(inspectTrackerMilestoneMarker("jira", {
      body: jira.body,
      properties: [jira.property, jira.property],
    }, effectKey)).toBe("malformed");
  });

  test("rejects non-digest effect identities before building machine metadata", () => {
    expect(() => renderTrackerMilestone("github", projection(), "not-a-digest"))
      .toThrow("Tracker milestone identity requires one exact effect digest");
  });

  test("keeps the browser fixture aligned with representative semantic views", async () => {
    const html = await readFile(resolve(import.meta.dir, "fixtures/human-first-tracker-comments.html"), "utf8");
    const representatives = [
      projection({ phase: "implement" }),
      projection({ status: "awaiting_human", progress: "blocked", blocker: "Choose the rollout audience." }),
      projection({ status: "blocked", progress: "blocked", blocker: "Missing project permission." }),
      projection({ phase: "review", progress: "review" }),
      projection({ phase: "done", status: "done", completionLevel: "verified", progress: "done" }),
    ];
    for (const source of representatives) {
      const view = createTrackerMilestoneView(source);
      expect(html).toContain(view.headline);
      expect(html).toContain(view.work);
      if (view.action) expect(html).toContain(view.action.label);
    }
    for (const forbidden of [
      "human-first-tracker-comments",
      "sha256:",
      "receiptId",
      "Revision:",
      "Completion:",
      "provider upload/link pending or unsupported",
    ]) expect(html).not.toContain(forbidden);
  });
});
