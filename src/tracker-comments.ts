import { EmpiricalError } from "./errors.js";
import type {
  TrackerArtifact,
  TrackerProjection,
  TrackerProvider,
} from "./types.js";

export const TRACKER_MARKER_ORIGIN = "https://github.com/goempirical/empirical-sdd";

const EFFECT_KEY = /^sha256:[a-f0-9]{64}$/;
const HUMAN_TEXT_LIMIT = 320;
const WORK_LABEL_LIMIT = 96;
const EVIDENCE_LIMIT = 10;
const JIRA_SCAN_LIMIT = 10_000;
const COMMENT_PROPERTY = "empirical-sdd-effect";

export type TrackerMilestoneMarkerInspection = "absent" | "match" | "malformed";

export interface TrackerMilestoneAction {
  label: "Action needed" | "Blocker";
  text: string;
}

export interface TrackerMilestoneEvidence {
  label: string;
  url: string;
}

export interface TrackerMilestoneView {
  headline: string;
  work: string;
  summary: string | null;
  action: TrackerMilestoneAction | null;
  evidence: TrackerMilestoneEvidence[];
}

export interface MarkdownTrackerMilestone {
  provider: "github" | "linear";
  body: string;
}

export interface JiraTrackerMilestone {
  provider: "jira";
  body: Record<string, unknown>;
  property: {
    key: typeof COMMENT_PROPERTY;
    value: string;
  };
}

export type TrackerMilestonePayload = MarkdownTrackerMilestone | JiraTrackerMilestone;

interface TrackerMilestoneIdentity {
  effectKey: string;
  url: string;
  legacyMarkdown: string;
  github: string;
  linear: string;
}

interface JiraMarkerScan {
  related: number;
  recognized: number;
}

/** Build the provider payload for one already-committed tracker projection. */
export function renderTrackerMilestone(
  provider: TrackerProvider,
  projection: TrackerProjection,
  effectKey: string,
): TrackerMilestonePayload {
  const identity = trackerMilestoneIdentity(effectKey);
  const view = createTrackerMilestoneView(projection);
  if (provider === "github") {
    return {
      provider,
      body: [...renderMarkdownSections(view), "", identity.github].join("\n"),
    };
  }
  if (provider === "linear") {
    return {
      provider,
      body: [...renderMarkdownSections(view), "", identity.linear].join("\n"),
    };
  }
  return {
    provider,
    body: renderJiraMilestone(view, identity),
    property: { key: COMMENT_PROPERTY, value: identity.effectKey },
  };
}

/** Derive one provider-neutral, human-first milestone view. */
export function createTrackerMilestoneView(projection: TrackerProjection): TrackerMilestoneView {
  const summary = humanText(projection.summary, HUMAN_TEXT_LIMIT);
  const stopped = projection.status === "blocked" || projection.status === "awaiting_human";
  const actionText = stopped
    ? humanText(projection.blocker ?? projection.summary, HUMAN_TEXT_LIMIT)
      ?? (projection.status === "awaiting_human"
        ? "A decision or input is required before work can continue."
        : "Work cannot continue until this blocker is resolved.")
    : null;
  return {
    headline: milestoneHeadline(projection),
    work: humanizeFeature(projection.feature),
    summary: summary === actionText ? null : summary,
    action: actionText
      ? {
        label: projection.status === "awaiting_human" ? "Action needed" : "Blocker",
        text: actionText,
      }
      : null,
    evidence: milestoneEvidence(projection.artifacts ?? []),
  };
}

/**
 * Classify only exact machine-owned marker representations. Expected-key text
 * in any partial or duplicated representation is malformed and must fail closed.
 */
export function inspectTrackerMilestoneMarker(
  provider: TrackerProvider,
  comment: { body?: unknown; properties?: unknown },
  effectKey: string,
): TrackerMilestoneMarkerInspection {
  const identity = trackerMilestoneIdentity(effectKey);
  if (provider === "github" || provider === "linear") {
    if (typeof comment.body !== "string") return "absent";
    return inspectMarkdownMarker(
      comment.body,
      provider === "github" ? identity.github : identity.linear,
      identity,
    );
  }
  const body = inspectJiraBodyMarker(comment.body, identity);
  const property = inspectJiraPropertyMarker(comment.properties, identity);
  if (body === "malformed" || property === "malformed") return "malformed";
  return body === "match" || property === "match" ? "match" : "absent";
}

/** Exact pre-change marker retained for recovery tests and compatibility. */
export function legacyTrackerMilestoneMarker(effectKey: string): string {
  return trackerMilestoneIdentity(effectKey).legacyMarkdown;
}

function trackerMilestoneIdentity(effectKey: string): TrackerMilestoneIdentity {
  if (!EFFECT_KEY.test(effectKey)) {
    throw new EmpiricalError(
      "TRACKER_MARKER_INVALID",
      "Tracker milestone identity requires one exact effect digest",
    );
  }
  const url = `${TRACKER_MARKER_ORIGIN}#empirical-milestone:${effectKey}`;
  return {
    effectKey,
    url,
    legacyMarkdown: `[Empirical milestone](<${url}>)`,
    github: `<!-- empirical-sdd-effect:${effectKey} -->`,
    linear: `_[Managed by Empirical](<${url}>)_`,
  };
}

function milestoneHeadline(projection: TrackerProjection): string {
  if (projection.status === "awaiting_human") return "Input needed";
  if (projection.status === "blocked") return "Work is blocked";
  if (projection.status === "done" || projection.phase === "done") {
    switch (projection.completionLevel) {
      case "implemented": return "Implementation complete";
      case "verified": return "Verification complete";
      case "integrated": return "Integration complete";
      case "delivered": return "Delivery complete";
      case "published": return "Publication complete";
      default: return "Workflow complete";
    }
  }
  switch (projection.phase) {
    case "idle":
    case "shape":
    case "specify":
    case "design":
      return "Defining the work";
    case "plan": return "Plan ready";
    case "implement":
    case "context":
      return "Implementation in progress";
    case "verify": return "Verification in progress";
    case "review": return "Ready for review";
    case "integrate": return "Integration in progress";
    case "deliver": return "Delivery in progress";
    case "publish": return "Publication in progress";
    case "archive": return "Wrapping up";
    default: return "Work in progress";
  }
}

function humanizeFeature(feature: string): string {
  const value = feature.split("-").filter(Boolean).join(" ");
  const sentence = `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
  return boundText(sentence, WORK_LABEL_LIMIT) ?? "Empirical work";
}

function humanText(value: string | null | undefined, limit: number): string | null {
  if (!value?.trim()) return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/\[([^\]\r\n]{0,128})\]\([^\)\r\n]{1,2048}\)/g, "$1")
    .replace(/\bhttps?:\/\/\S+/gi, "[link omitted]")
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(/\b(?:gh[pousr]_|github_pat_|lin_api_)[A-Za-z0-9_]{16,}\b/gi, "[REDACTED]")
    .replace(/((?:authorization|password|secret|api[_ -]?key|token)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/\b(?:executed|collected)-[a-z0-9-]+\b/gi, "[REDACTED]")
    .replace(/\b(?:sha256:)?[a-f0-9]{40,64}\b/gi, "[REDACTED]")
    .replace(/empirical-(?:milestone|sdd-effect):/gi, "Empirical update ")
    .replace(/<!--|-->/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/@/g, "＠")
    .replace(/\s+/g, " ")
    .trim();
  return boundText(normalized, limit);
}

function boundText(value: string, limit: number): string | null {
  const points = [...value.trim()];
  if (points.length === 0) return null;
  if (points.length <= limit) return points.join("");
  return `${points.slice(0, Math.max(1, limit - 1)).join("").trimEnd()}…`;
}

function milestoneEvidence(artifacts: TrackerArtifact[]): TrackerMilestoneEvidence[] {
  const candidates = artifacts.flatMap((artifact) => {
    const url = safeEvidenceUrl(artifact.url);
    return url ? [{ base: evidenceLabel(artifact.mediaType), url }] : [];
  }).slice(0, EVIDENCE_LIMIT);
  const totals = new Map<string, number>();
  for (const candidate of candidates) {
    totals.set(candidate.base, (totals.get(candidate.base) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return candidates.map((candidate) => {
    const index = (seen.get(candidate.base) ?? 0) + 1;
    seen.set(candidate.base, index);
    return {
      label: (totals.get(candidate.base) ?? 0) > 1
        ? `${candidate.base} ${index}`
        : candidate.base,
      url: candidate.url,
    };
  });
}

function evidenceLabel(mediaType: string): string {
  if (mediaType.startsWith("image/")) return "Screenshot";
  if (mediaType === "application/pdf") return "Document";
  if (mediaType === "application/json") return "Report";
  if (mediaType === "text/plain" || mediaType === "text/markdown") return "Notes";
  return "Evidence";
}

function safeEvidenceUrl(value: string | null): string | null {
  if (!value || value !== value.trim() || value.length > 2_048 || /[\u0000-\u001f\u007f<>]/.test(value)) {
    return null;
  }
  if (hasUnsafeLinkMaterial(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`);
    } catch {
      return null;
    }
    if (hasUnsafeLinkMaterial(decoded)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hasUnsafeLinkMaterial(value: string): boolean {
  return /\b(?:bearer|basic)\s+/i.test(value)
    || /\b(?:gh[pousr]_|github_pat_|lin_api_)[A-Za-z0-9_]{16,}\b/i.test(value)
    || /(?:authorization|password|secret|api[_ -]?key|token)\s*[:=]/i.test(value)
    || /(?:empirical-(?:milestone|sdd-effect):|sha256:)/i.test(value);
}

function renderMarkdownSections(view: TrackerMilestoneView): string[] {
  const lines = [
    `## ${escapeMarkdown(view.headline)}`,
    `**${escapeMarkdown(view.work)}**`,
  ];
  if (view.summary) lines.push("", escapeMarkdown(view.summary));
  if (view.action) {
    lines.push("", `### ${view.action.label}`, escapeMarkdown(view.action.text));
  }
  if (view.evidence.length > 0) {
    lines.push(
      "",
      "### Evidence",
      ...view.evidence.map((entry) => `- [${entry.label}](<${entry.url}>)`),
    );
  }
  return lines;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "\\$1");
}

function renderJiraMilestone(
  view: TrackerMilestoneView,
  identity: TrackerMilestoneIdentity,
): Record<string, unknown> {
  const content: Record<string, unknown>[] = [
    jiraHeading(view.headline, 2),
    jiraParagraph(view.work, [{ type: "strong" }]),
  ];
  if (view.summary) content.push(jiraParagraph(view.summary));
  if (view.action) {
    content.push(jiraHeading(view.action.label, 3), jiraParagraph(view.action.text));
  }
  if (view.evidence.length > 0) {
    content.push(
      jiraHeading("Evidence", 3),
      {
        type: "bulletList",
        content: view.evidence.map((entry) => ({
          type: "listItem",
          content: [jiraParagraph(entry.label, [{ type: "link", attrs: { href: entry.url } }])],
        })),
      },
    );
  }
  content.push(jiraParagraph("Managed by Empirical", [
    { type: "em" },
    { type: "link", attrs: { href: identity.url } },
  ]));
  return { version: 1, type: "doc", content };
}

function jiraHeading(text: string, level: 2 | 3): Record<string, unknown> {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function jiraParagraph(
  text: string,
  marks: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    type: "paragraph",
    content: [{ type: "text", text, ...(marks.length > 0 ? { marks } : {}) }],
  };
}

function inspectMarkdownMarker(
  body: string,
  current: string,
  identity: TrackerMilestoneIdentity,
): TrackerMilestoneMarkerInspection {
  const related = countOccurrences(body, identity.effectKey);
  if (related === 0) return "absent";
  const lines = body.split(/\r?\n/);
  const recognized = lines.filter((line) => line === current || line === identity.legacyMarkdown).length;
  return related === 1 && recognized === 1 ? "match" : "malformed";
}

function inspectJiraBodyMarker(
  body: unknown,
  identity: TrackerMilestoneIdentity,
): TrackerMilestoneMarkerInspection {
  const scan: JiraMarkerScan = { related: 0, recognized: 0 };
  let visited = 0;
  const walk = (value: unknown): void => {
    visited += 1;
    if (visited > JIRA_SCAN_LIMIT) {
      scan.related += 1;
      return;
    }
    if (typeof value === "string") {
      scan.related += countOccurrences(value, identity.effectKey);
      if (value === identity.legacyMarkdown) scan.recognized += 1;
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (!isRecord(value)) return;
    if (value.type === "text" && value.text === "Managed by Empirical" && Array.isArray(value.marks)) {
      for (const rawMark of value.marks) {
        if (!isRecord(rawMark) || rawMark.type !== "link" || !isRecord(rawMark.attrs)) continue;
        if (rawMark.attrs.href === identity.url) scan.recognized += 1;
      }
    }
    for (const entry of Object.values(value)) walk(entry);
  };
  walk(body);
  if (scan.related === 0) return "absent";
  return scan.related === 1 && scan.recognized === 1 ? "match" : "malformed";
}

function inspectJiraPropertyMarker(
  properties: unknown,
  identity: TrackerMilestoneIdentity,
): TrackerMilestoneMarkerInspection {
  const values: unknown[] = [];
  if (Array.isArray(properties)) {
    for (const rawProperty of properties) {
      if (isRecord(rawProperty) && rawProperty.key === COMMENT_PROPERTY) values.push(rawProperty.value);
    }
  } else if (isRecord(properties) && Object.hasOwn(properties, COMMENT_PROPERTY)) {
    values.push(properties[COMMENT_PROPERTY]);
  }
  if (values.length === 0) return "absent";
  let related = 0;
  let recognized = 0;
  for (const value of values) {
    if (typeof value !== "string") continue;
    related += countOccurrences(value, identity.effectKey);
    if (value === identity.effectKey || value === identity.legacyMarkdown) recognized += 1;
  }
  if (related === 0) return "absent";
  return related === 1 && recognized === 1 ? "match" : "malformed";
}

function countOccurrences(value: string, token: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(token, offset)) !== -1) {
    count += 1;
    offset += token.length;
  }
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
