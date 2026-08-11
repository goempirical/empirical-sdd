import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, relative, resolve } from "node:path";

import { EmpiricalError } from "./errors.js";
import { digestJson, MANIFEST_SCHEMA_VERSION, PRODUCT_VERSION, sha256 } from "./protocol.js";
import { isMigrationScratchPath } from "./migration-scratch.js";
import {
  isLegacyRepositoryKnowledgeTemplate,
  MANAGED_CONTEXT_MARKER,
} from "./knowledge-templates.js";
import {
  isFile,
  isSymbolicLink,
  readJson,
  writeJsonAtomic,
  writeTextAtomic,
} from "./storage.js";
import type {
  RepositoryKnowledgeFile,
  RepositoryKnowledgeManifest,
  RepositoryKnowledgePage,
  RepositoryKnowledgeReport,
} from "./types.js";

export const KNOWLEDGE_SCHEMA_VERSION = MANIFEST_SCHEMA_VERSION;
export const KNOWLEDGE_CONTEXT_PATHS = [
  ".empirical/context/index.md",
  ".empirical/context/overview.md",
  ".empirical/context/architecture.md",
  ".empirical/context/commands.md",
  ".empirical/context/conventions.md",
] as const;

const GENERATOR = `empirical-${PRODUCT_VERSION}`;
const MAX_FILES = 1_200;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 16_000_000;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".empirical",
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "temp",
  "tmp",
  "vendor",
]);
const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".db",
  ".dylib",
  ".eot",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".so",
  ".sqlite",
  ".tar",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);
const INTEGRATION_ONLY_PATHS = new Set([
  ".agents/skills/empirical/SKILL.md",
  ".claude/skills/empirical/SKILL.md",
  ".codex/config.toml",
  ".cursor/mcp.json",
  ".gemini/settings.json",
  ".mcp.json",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
]);

type ContextPageId = "index" | "overview" | "architecture" | "commands" | "conventions";

interface PageDefinition {
  id: ContextPageId;
  path: (typeof KNOWLEDGE_CONTEXT_PATHS)[number];
  matches: (path: string) => boolean;
  render: (root: string, files: RepositoryKnowledgeFile[], truncated: boolean) => string;
}

const PAGE_DEFINITIONS: readonly PageDefinition[] = [
  {
    id: "index",
    path: ".empirical/context/index.md",
    matches: () => true,
    render: renderIndex,
  },
  {
    id: "overview",
    path: ".empirical/context/overview.md",
    matches: (path) =>
      /(^|\/)(?:README|PROJECT|VISION|PRODUCT)[^/]*$/i.test(path) ||
      /(^|\/)package\.json$/.test(path),
    render: () => overviewTemplate(),
  },
  {
    id: "architecture",
    path: ".empirical/context/architecture.md",
    matches: (path) =>
      /(^|\/)(?:ARCHITECTURE|DESIGN)[^/]*$/i.test(path) ||
      /^(?:src|lib|app|packages)\//.test(path) ||
      /(^|\/)(?:package\.json|Cargo\.toml|go\.mod|pyproject\.toml)$/.test(path),
    render: () => architectureTemplate(),
  },
  {
    id: "commands",
    path: ".empirical/context/commands.md",
    matches: (path) =>
      /(^|\/)(?:package\.json|Makefile|justfile|Taskfile\.ya?ml)$/.test(path) ||
      /^(?:\.github\/workflows|scripts)\//.test(path),
    render: () => commandsTemplate(),
  },
  {
    id: "conventions",
    path: ".empirical/context/conventions.md",
    matches: (path) =>
      /(^|\/)(?:AGENTS|CONTRIBUTING|STYLE|CONVENTIONS)[^/]*$/i.test(path) ||
      /(^|\/)(?:eslint|prettier|biome|tsconfig|ruff|clippy)[^/]*$/i.test(path),
    render: () => conventionsTemplate(),
  },
];

interface KnowledgeInspection {
  root: string;
  valid: boolean;
  manifest: RepositoryKnowledgeManifest | null;
  files: RepositoryKnowledgeFile[];
  truncated: boolean;
  fresh: string[];
  stale: string[];
  missing: string[];
  refinementRequired: string[];
  issues: string[];
}

function requiresSemanticRefinement(
  definition: PageDefinition,
  contents: string,
  files: RepositoryKnowledgeFile[],
): boolean {
  if (
    definition.id === "index" ||
    !files.some((file) => !INTEGRATION_ONLY_PATHS.has(file.path))
  ) return false;
  if (contents.startsWith(MANAGED_CONTEXT_MARKER)) return true;
  return isLegacyRepositoryKnowledgeTemplate(definition.path, contents);
}

function pageDependencies(
  definition: PageDefinition,
  files: RepositoryKnowledgeFile[],
): RepositoryKnowledgeFile[] {
  return files.filter((file) => definition.matches(file.path));
}

function pageSourceDigest(
  definition: PageDefinition,
  files: RepositoryKnowledgeFile[],
): string {
  return digestJson(
    pageDependencies(definition, files).map((file) => ({
      path: file.path,
      size: file.size,
      digest: file.digest,
    })),
  );
}

function manifestBody(input: {
  files: RepositoryKnowledgeFile[];
  pages: RepositoryKnowledgePage[];
  truncated: boolean;
}): Omit<RepositoryKnowledgeManifest, "digest"> {
  return {
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    generator: GENERATOR,
    sourceDigest: digestJson(input.files),
    files: input.files,
    pages: input.pages,
    truncated: input.truncated,
  };
}

function validateManifest(value: unknown): RepositoryKnowledgeManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Repository knowledge manifest must be an object.");
  }
  const manifest = value as RepositoryKnowledgeManifest;
  if (
    manifest.schemaVersion !== KNOWLEDGE_SCHEMA_VERSION ||
    typeof manifest.generator !== "string" ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.pages) ||
    typeof manifest.sourceDigest !== "string" ||
    typeof manifest.digest !== "string"
  ) {
    throw new Error("Repository knowledge manifest is not Manifest v2.");
  }
  const { digest, ...body } = manifest;
  if (digestJson(body) !== digest) {
    throw new Error("Repository knowledge manifest failed its digest check.");
  }
  return manifest;
}

async function loadManifest(path: string): Promise<RepositoryKnowledgeManifest | null> {
  if (!(await isFile(path))) return null;
  return validateManifest(await readJson<unknown>(path, "INVALID_CONTEXT"));
}

export async function inspectRepositoryKnowledge(
  rootInput: string,
): Promise<KnowledgeInspection> {
  const root = resolve(rootInput);
  const contextDirectory = join(root, ".empirical", "context");
  const manifestPath = join(contextDirectory, "manifest.json");
  await assertContextPathsSafe(root, [
    contextDirectory,
    manifestPath,
    ...KNOWLEDGE_CONTEXT_PATHS.map((path) => join(root, path)),
  ]);
  const inventory = await repositoryInventory(root);
  let manifest: RepositoryKnowledgeManifest | null = null;
  const issues: string[] = [];
  try {
    manifest = await loadManifest(manifestPath);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  const fresh: string[] = [];
  const stale: string[] = [];
  const missing: string[] = [];
  const refinementRequired: string[] = [];
  for (const definition of PAGE_DEFINITIONS) {
    const absolute = join(root, definition.path);
    if (!(await isFile(absolute))) {
      missing.push(definition.path);
      continue;
    }
    const contents = await readFile(absolute, "utf8");
    const currentDigest = sha256(contents);
    if (requiresSemanticRefinement(definition, contents, inventory.files)) {
      refinementRequired.push(definition.path);
    }
    const currentSource = pageSourceDigest(definition, inventory.files);
    const previous = manifest?.pages.find((page) => page.path === definition.path);
    if (
      previous &&
      previous.freshness === "fresh" &&
      previous.sourceDigest === currentSource &&
      (!previous.managed || previous.digest === currentDigest)
    ) {
      fresh.push(definition.path);
    } else {
      stale.push(definition.path);
    }
  }
  return {
    root,
    valid:
      issues.length === 0 &&
      stale.length === 0 &&
      missing.length === 0 &&
      refinementRequired.length === 0,
    manifest,
    files: inventory.files,
    truncated: inventory.truncated,
    fresh,
    stale,
    missing,
    refinementRequired,
    issues,
  };
}

export async function refreshRepositoryKnowledge(
  rootInput: string,
): Promise<RepositoryKnowledgeReport> {
  const root = resolve(rootInput);
  const contextDirectory = join(root, ".empirical", "context");
  const manifestPath = join(contextDirectory, "manifest.json");
  await assertContextPathsSafe(root, [
    contextDirectory,
    manifestPath,
    ...KNOWLEDGE_CONTEXT_PATHS.map((path) => join(root, path)),
  ]);
  const inventory = await repositoryInventory(root);
  let previous: RepositoryKnowledgeManifest | null = null;
  try {
    previous = await loadManifest(manifestPath);
  } catch {
    previous = null;
  }

  const pages: RepositoryKnowledgePage[] = [];
  const refinementRequired: string[] = [];
  let pageChanged = false;
  for (const definition of PAGE_DEFINITIONS) {
    const path = join(root, definition.path);
    const existing = await isFile(path) ? await readFile(path, "utf8") : null;
    const previousPage = previous?.pages.find((page) => page.path === definition.path);
    const sourceDigest = pageSourceDigest(definition, inventory.files);
    const hasManagedMarker = existing?.startsWith(MANAGED_CONTEXT_MARKER) ?? false;
    const legacyPlaceholder = existing === null
      ? false
      : isLegacyRepositoryKnowledgeTemplate(definition.path, existing);
    const isManaged = existing === null || hasManagedMarker || legacyPlaceholder;
    const managedStale =
      existing === null ||
      (isManaged &&
        (!hasManagedMarker ||
          previousPage?.sourceDigest !== sourceDigest ||
          previousPage.digest !== sha256(existing)));
    let contents = existing;
    if (managedStale) {
      contents = `${MANAGED_CONTEXT_MARKER}\n${definition.render(root, inventory.files, inventory.truncated)}`;
      await writeTextAtomic(path, contents);
      pageChanged = true;
    }
    if (contents === null) throw new Error(`Could not create context page ${definition.path}.`);
    if (requiresSemanticRefinement(definition, contents, inventory.files)) {
      refinementRequired.push(definition.path);
    }
    const managed = contents.startsWith(MANAGED_CONTEXT_MARKER);
    pages.push({
      path: definition.path,
      generator: GENERATOR,
      managed,
      dependencies: pageDependencies(definition, inventory.files).map((file) => file.path),
      sourceDigest,
      digest: sha256(contents),
      freshness: "fresh",
    });
  }

  const body = manifestBody({
    files: inventory.files,
    pages,
    truncated: inventory.truncated,
  });
  const manifest: RepositoryKnowledgeManifest = {
    ...body,
    digest: digestJson(body),
  };
  const unchanged = previous !== null && digestJson(previous) === digestJson(manifest);
  if (!unchanged) await writeJsonAtomic(manifestPath, manifest);
  const status: RepositoryKnowledgeReport["status"] = refinementRequired.length > 0
    ? "stale"
    : previous === null
      ? "created"
      : unchanged && !pageChanged
        ? "current"
        : "refreshed";
  return report(root, status, manifest, refinementRequired);
}

export function repositoryKnowledgePaths(): string[] {
  return [...KNOWLEDGE_CONTEXT_PATHS];
}

export async function freshRepositoryKnowledgePaths(root: string): Promise<string[]> {
  const inspection = await inspectRepositoryKnowledge(root);
  return inspection.fresh.filter((path) => !inspection.refinementRequired.includes(path));
}

async function repositoryInventory(
  root: string,
): Promise<{ files: RepositoryKnowledgeFile[]; truncated: boolean }> {
  const candidates = gitCandidates(root) ?? (await walkCandidates(root));
  const files: RepositoryKnowledgeFile[] = [];
  let totalBytes = 0;
  let truncated = false;
  for (const path of [...new Set(candidates.map(normalizePath))].sort()) {
    if (!safeKnowledgePath(path)) continue;
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    const absolute = join(root, path);
    const details = await lstat(absolute).catch(() => null);
    if (!details?.isFile() || details.isSymbolicLink()) continue;
    if (details.size > MAX_FILE_BYTES || totalBytes + details.size > MAX_TOTAL_BYTES) {
      truncated = true;
      continue;
    }
    const contents = await readFile(absolute).catch(() => null);
    if (!contents) continue;
    totalBytes += details.size;
    files.push({
      path,
      size: details.size,
      digest: sha256(contents),
    });
  }
  return { files, truncated };
}

function gitCandidates(root: string): string[] | null {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.split("\0").filter(Boolean);
}

async function walkCandidates(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];
  while (pending.length && found.length < MAX_FILES * 2) {
    const directory = pending.shift()!;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const path = normalizePath(relative(root, absolute));
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !isMigrationScratchPath(path)) pending.push(absolute);
      } else if (entry.isFile()) {
        found.push(path);
      }
    }
  }
  return found;
}

function safeKnowledgePath(path: string): boolean {
  if (!path || path === ".." || path.startsWith("../") || path.startsWith("/")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;
  if (isMigrationScratchPath(path)) return false;
  const name = basename(path).toLowerCase();
  if (
    name === ".npmrc" ||
    /^\.env(?:\.|$)/.test(name) ||
    /(?:^|[._-])(credential|credentials|private[-_]?key|secret|secrets|token|tokens)(?:[._-]|$)/.test(name) ||
    /\.(?:key|p12|pem|pfx)$/.test(name)
  ) {
    return false;
  }
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return !BINARY_EXTENSIONS.has(extension);
}

async function assertContextPathsSafe(root: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    const resolved = resolve(path);
    const label = normalizePath(relative(root, resolved));
    if (!label || label === ".." || label.startsWith("../")) {
      throw new EmpiricalError(
        "UNSAFE_CONTEXT_PATH",
        `Repository context escapes the project: ${path}`,
      );
    }
    let current = root;
    for (const segment of label.split("/")) {
      current = join(current, segment);
      if (await isSymbolicLink(current)) {
        throw new EmpiricalError(
          "UNSAFE_CONTEXT_PATH",
          `Repository context cannot use symbolic links: ${current}`,
        );
      }
      if (!(await stat(current).catch(() => null))) break;
    }
  }
}

function renderIndex(
  root: string,
  files: RepositoryKnowledgeFile[],
  truncated: boolean,
): string {
  const paths = files.map((file) => file.path);
  const roots = [
    ...new Set(paths.map((path) => (path.includes("/") ? path.split("/")[0]! : "."))),
  ].slice(0, 24);
  const manifests = paths
    .filter((path) =>
      /(^|\/)(?:package\.json|Cargo\.toml|go\.mod|pyproject\.toml|pom\.xml|build\.gradle|Makefile)$/.test(
        path,
      ),
    )
    .slice(0, 24);
  const docs = paths
    .filter((path) => /(^|\/)(?:README|CONTRIBUTING|ARCHITECTURE|SECURITY)[^/]*$/i.test(path))
    .slice(0, 24);
  return `# Repository Knowledge Index

Generated from bounded repository metadata.

- Repository: ${basename(root)}
- Source fingerprint: ${digestJson(files)}
- Included files: ${files.length}${truncated ? " (bounded/truncated)" : ""}
- Roots: ${roots.length ? roots.join(", ") : "none"}
- Manifests: ${manifests.length ? manifests.join(", ") : "none"}
- Primary docs: ${docs.length ? docs.join(", ") : "none"}

## Topics

- [Overview](overview.md)
- [Architecture](architecture.md)
- [Commands](commands.md)
- [Conventions](conventions.md)

Freshness and source dependencies are recorded in [manifest.json](manifest.json).
This is a compact file-backed context set, not an embedding or vector database.
`;
}

function overviewTemplate(): string {
  return `# Project Overview

Maintain this page from repository evidence. Remove the managed marker before
adding durable agent-maintained context that refresh must preserve.

## Purpose

- TODO: What the project does and who it serves.

## Boundaries

- TODO: Major scope boundaries and explicit non-goals.

## Evidence

- TODO: Link the manifests, documentation, and entrypoints used.
`;
}

function architectureTemplate(): string {
  return `# Architecture

Maintain this page from repository evidence. Remove the managed marker before
adding durable agent-maintained context that refresh must preserve.

## Components and ownership

- TODO

## Data and control flow

- TODO

## External dependencies

- TODO
`;
}

function commandsTemplate(): string {
  return `# Commands

Maintain only commands verified from manifests, scripts, or CI configuration.
Remove the managed marker before adding durable agent-maintained context.

## Setup

- TODO

## Run, test, and build

- TODO

## Verification evidence

- TODO
`;
}

function conventionsTemplate(): string {
  return `# Conventions

Maintain this page from repository instructions and observed code. Remove the
managed marker before adding durable agent-maintained context.

## Code and structure

- TODO

## Testing and delivery

- TODO

## Repository-specific constraints

- TODO
`;
}

function report(
  root: string,
  status: RepositoryKnowledgeReport["status"],
  manifest: RepositoryKnowledgeManifest,
  refinementRequired: string[],
): RepositoryKnowledgeReport {
  const fresh = manifest.pages
    .filter((page) => page.freshness === "fresh")
    .map((page) => page.path);
  const stale = manifest.pages
    .filter((page) => page.freshness === "stale")
    .map((page) => page.path);
  const missing = manifest.pages
    .filter((page) => page.freshness === "missing")
    .map((page) => page.path);
  const refinement = new Set(refinementRequired);
  return {
    root,
    status,
    digest: manifest.digest,
    files: manifest.files.length,
    truncated: manifest.truncated,
    manifest: ".empirical/context/manifest.json",
    context: fresh.filter((path) => !refinement.has(path)),
    stale,
    missing,
    refinementRequired,
  };
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
