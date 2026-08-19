import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";

import { EmpiricalError } from "./errors.js";
import type {
  ResolvedTrackerAuthentication,
  TrackerAuthenticationGuidance,
  TrackerDependencies,
  TrackerDiscoveryInput,
  TrackerOAuthAuthorization,
  TrackerOAuthCredential,
  TrackerOAuthRequest,
  TrackerPolicy,
  TrackerProvider,
} from "./types.js";

const SECRET_FILE_MAX_BYTES = 64 * 1_024;
const FILE_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const ELICITATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CLOUD_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const SECRET_QUERY_FIELDS = new Set([
  "accesstoken",
  "apikey",
  "clientsecret",
  "code",
  "credential",
  "password",
  "secret",
  "token",
]);

export const DEFAULT_TRACKER_CREDENTIAL_ENV = Object.freeze({
  github: Object.freeze({ token: "GITHUB_TOKEN" }),
  linear: Object.freeze({ apiKey: "LINEAR_SECRET_KEY" }),
  jira: Object.freeze({ email: "JIRA_EMAIL", apiToken: "JIRA_API_TOKEN" }),
});

type AuthenticationSubject = TrackerPolicy | TrackerDiscoveryInput;
type CredentialSource = "environment" | "file";

export function defaultTrackerCredentialEnv(provider: "github"): { token: string };
export function defaultTrackerCredentialEnv(provider: "linear"): { apiKey: string };
export function defaultTrackerCredentialEnv(provider: "jira"): { email: string; apiToken: string };
export function defaultTrackerCredentialEnv(provider: TrackerProvider): Record<string, string>;
export function defaultTrackerCredentialEnv(provider: TrackerProvider): Record<string, string> {
  return { ...DEFAULT_TRACKER_CREDENTIAL_ENV[provider] };
}

export function trackerCredentialNames(subject: AuthenticationSubject): string[] {
  if (subject.provider === "github") return [subject.credentialEnv.token];
  if (subject.provider === "linear") return [subject.credentialEnv.apiKey];
  return [subject.credentialEnv.email, subject.credentialEnv.apiToken];
}

export function defaultTrackerSecretFilePath(dependencies: TrackerDependencies = {}): string {
  if (dependencies.secretFilePath) return resolve(dependencies.secretFilePath);
  const environment = dependencies.env ?? process.env;
  const platform = trackerPlatform(dependencies);
  if (platform === "win32") {
    const configured = nonEmpty(environment.APPDATA);
    const base = configured && win32.isAbsolute(configured)
      ? configured
      : win32.join(dependencies.homeDirectory ?? homedir(), "AppData", "Roaming");
    return win32.join(base, "Empirical", "secrets.env");
  }
  const home = dependencies.homeDirectory ?? nonEmpty(environment.HOME) ?? homedir();
  const configured = nonEmpty(environment.XDG_CONFIG_HOME);
  const base = configured && posix.isAbsolute(configured)
    ? configured
    : posix.join(home, ".config");
  return posix.join(base, "empirical", "secrets.env");
}

export function trackerAuthenticationGuidance(
  subject: AuthenticationSubject | TrackerProvider,
  dependencies: TrackerDependencies = {},
): TrackerAuthenticationGuidance {
  const provider = typeof subject === "string" ? subject : subject.provider;
  const credentialNames = typeof subject === "string"
    ? Object.values(defaultTrackerCredentialEnv(subject))
    : trackerCredentialNames(subject);
  const secretFilePath = defaultTrackerSecretFilePath(dependencies);
  const providerName = provider === "github" ? "GitHub" : provider === "linear" ? "Linear" : "Jira";
  const warning = "Never paste credentials into chat" as const;
  return {
    provider,
    oauthPreferred: true,
    credentialNames,
    secretFilePath,
    warning,
    message: [
      `Connect ${providerName} through trusted host OAuth first.`,
      `If OAuth is unavailable, configure ${credentialNames.join(" and ")} in the host-only secrets file at ${secretFilePath}.`,
      `${warning}. Edit the file directly outside chat; never put credential values in commands, shell history, process arguments, repository files, or tool input.`,
    ].join(" "),
  };
}

export async function trackerOAuthAuthorization(
  subject: AuthenticationSubject,
  dependencies: TrackerDependencies = {},
): Promise<TrackerOAuthAuthorization | null> {
  const resolver = dependencies.oauthResolver;
  if (!resolver?.authorize) return null;
  const request = oauthRequest(subject);
  let authorization: TrackerOAuthAuthorization | null;
  try {
    authorization = await resolver.authorize(request);
  } catch {
    throw new EmpiricalError(
      "TRACKER_OAUTH_RESOLVER_FAILED",
      "The trusted host OAuth connection could not be started",
    );
  }
  if (authorization === null) return null;
  try {
    return validateAuthorization(authorization, request.provider, dependencies);
  } catch {
    return invalidOAuthAuthorization();
  }
}

export async function resolveTrackerAuthentication(
  subject: AuthenticationSubject,
  dependencies: TrackerDependencies = {},
): Promise<ResolvedTrackerAuthentication> {
  const oauth = await resolveOAuth(subject, dependencies);
  if (oauth) return oauth;

  const names = trackerCredentialNames(subject);
  const environment = dependencies.env ?? process.env;
  const injected = completeSource(names, environment, "environment");
  if (injected) return fallbackAuthentication(subject, injected, "environment");

  const mayReadImplicitFile = dependencies.env === undefined;
  if (dependencies.secretFilePath !== undefined || mayReadImplicitFile) {
    const fromFile = await readSecretFile(names, dependencies);
    if (fromFile) return fallbackAuthentication(subject, fromFile, "file");
  }

  throw new EmpiricalError(
    "TRACKER_CREDENTIAL_MISSING",
    trackerAuthenticationGuidance(subject, dependencies).message,
  );
}

function oauthRequest(subject: AuthenticationSubject): TrackerOAuthRequest {
  if (subject.provider !== "jira") return { provider: subject.provider };
  return { provider: "jira", siteUrl: subject.target.siteUrl };
}

async function resolveOAuth(
  subject: AuthenticationSubject,
  dependencies: TrackerDependencies,
): Promise<ResolvedTrackerAuthentication | null> {
  if (!dependencies.oauthResolver) return null;
  const request = oauthRequest(subject);
  let credential: TrackerOAuthCredential | null;
  try {
    credential = await dependencies.oauthResolver.resolve(request);
  } catch {
    throw new EmpiricalError(
      "TRACKER_OAUTH_RESOLVER_FAILED",
      "The trusted host OAuth connection could not be resolved",
    );
  }
  if (credential === null) return null;
  try {
    return validateOAuthCredential(credential, request.provider);
  } catch {
    return invalidOAuthCredential();
  }
}

function validateOAuthCredential(
  credential: TrackerOAuthCredential,
  provider: TrackerProvider,
): ResolvedTrackerAuthentication {
  if (!isRecord(credential) || credential.provider !== provider) invalidOAuthCredential();
  if (credential.provider === "github" || credential.provider === "linear") {
    if (!hasExactKeys(credential, ["provider", "accessToken"])) invalidOAuthCredential();
    const accessToken = validatedSecret(credential.accessToken);
    return { provider: credential.provider, source: "oauth", accessToken };
  }
  if (credential.provider === "jira") {
    if (!hasExactKeys(credential, ["provider", "accessToken", "cloudId"])) invalidOAuthCredential();
    const accessToken = validatedSecret(credential.accessToken);
    if (typeof credential.cloudId !== "string" || !CLOUD_ID.test(credential.cloudId)) {
      invalidOAuthCredential();
    }
    return { provider: "jira", source: "oauth", accessToken, cloudId: credential.cloudId };
  }
  return invalidOAuthCredential();
}

function validateAuthorization(
  value: TrackerOAuthAuthorization,
  provider: TrackerProvider,
  dependencies: TrackerDependencies,
): TrackerOAuthAuthorization {
  if (!isRecord(value) || value.provider !== provider) invalidOAuthAuthorization();
  if (!hasExactKeys(value, ["provider", "elicitationId", "message", "url"])) invalidOAuthAuthorization();
  if (typeof value.elicitationId !== "string" || !ELICITATION_ID.test(value.elicitationId)) {
    invalidOAuthAuthorization();
  }
  if (
    typeof value.message !== "string"
    || value.message.length < 1
    || value.message.length > 240
    || /[\u0000-\u001f\u007f]/.test(value.message)
  ) {
    invalidOAuthAuthorization();
  }
  if (typeof value.url !== "string" || value.url.length > 2048) invalidOAuthAuthorization();
  let parsed: URL;
  try {
    parsed = new URL(value.url);
  } catch {
    return invalidOAuthAuthorization();
  }
  const loopback = parsed.hostname === "localhost"
    || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(dependencies.allowInsecureOAuthLoopback === true && parsed.protocol === "http:" && loopback)) {
    invalidOAuthAuthorization();
  }
  if (parsed.username || parsed.password || parsed.hash) invalidOAuthAuthorization();
  for (const name of parsed.searchParams.keys()) {
    if (isSecretQueryField(name)) {
      invalidOAuthAuthorization();
    }
  }
  return {
    provider,
    elicitationId: value.elicitationId,
    message: value.message,
    url: parsed.toString(),
  };
}

async function readSecretFile(
  names: string[],
  dependencies: TrackerDependencies,
): Promise<Record<string, string> | null> {
  const path = defaultTrackerSecretFilePath(dependencies);
  const repositoryRoot = resolve(dependencies.repositoryRoot ?? process.cwd());
  assertOutsideRepository(resolve(path), repositoryRoot);
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw new EmpiricalError("TRACKER_SECRET_FILE_UNREADABLE", `The host secrets file could not be inspected at ${path}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new EmpiricalError("TRACKER_SECRET_FILE_UNSAFE", `The host secrets path must be a regular non-symbolic-link file: ${path}`);
  }
  if (stats.nlink !== 1) {
    throw new EmpiricalError("TRACKER_SECRET_FILE_UNSAFE", `The host secrets file must not have additional hard links: ${path}`);
  }
  if (stats.size > SECRET_FILE_MAX_BYTES) {
    throw new EmpiricalError("TRACKER_SECRET_FILE_TOO_LARGE", `The host secrets file exceeds 64 KiB: ${path}`);
  }
  if (trackerPlatform(dependencies) === "posix" && !safePosixFileMetadata(stats)) {
    throw new EmpiricalError(
      "TRACKER_SECRET_FILE_PERMISSIONS",
      `The host secrets file must be owned by the current user, owner-readable, and inaccessible to group/other users: ${path}`,
    );
  }
  let canonicalPath: string;
  let canonicalRepository: string;
  try {
    [canonicalPath, canonicalRepository] = await Promise.all([
      realpath(path),
      realpath(repositoryRoot).catch(() => repositoryRoot),
    ]);
  } catch {
    throw new EmpiricalError("TRACKER_SECRET_FILE_UNREADABLE", `The host secrets file could not be resolved at ${path}`);
  }
  assertOutsideRepository(canonicalPath, canonicalRepository);
  const flags = constants.O_RDONLY
    | (trackerPlatform(dependencies) === "posix" ? constants.O_NOFOLLOW : 0);
  let handle;
  try {
    handle = await open(path, flags);
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== stats.dev
      || opened.ino !== stats.ino
      || opened.size > SECRET_FILE_MAX_BYTES
      || opened.nlink !== 1
      || (trackerPlatform(dependencies) === "posix" && !safePosixFileMetadata(opened))
    ) {
      throw new EmpiricalError("TRACKER_SECRET_FILE_UNSAFE", `The host secrets file changed during inspection: ${path}`);
    }
    const source = await handle.readFile("utf8");
    if (Buffer.byteLength(source, "utf8") > SECRET_FILE_MAX_BYTES) {
      throw new EmpiricalError("TRACKER_SECRET_FILE_TOO_LARGE", `The host secrets file exceeds 64 KiB: ${path}`);
    }
    return parseSecretFile(source, names, path);
  } catch (error) {
    if (error instanceof EmpiricalError) throw error;
    throw new EmpiricalError("TRACKER_SECRET_FILE_UNREADABLE", `The host secrets file could not be read at ${path}`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseSecretFile(source: string, names: string[], path: string): Record<string, string> | null {
  const requested = new Set(names);
  const seen = new Set<string>();
  const values: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    const name = separator < 0 ? "" : line.slice(0, separator);
    if (separator < 1 || !FILE_NAME.test(name)) {
      throw new EmpiricalError("TRACKER_SECRET_FILE_INVALID", `The host secrets file has an invalid assignment on line ${index + 1}: ${path}`);
    }
    if (seen.has(name)) {
      throw new EmpiricalError("TRACKER_SECRET_FILE_INVALID", `The host secrets file repeats ${name}: ${path}`);
    }
    seen.add(name);
    if (requested.has(name)) values[name] = line.slice(separator + 1);
  }
  return completeSource(names, values, "file");
}

function completeSource(
  names: string[],
  source: Readonly<Record<string, string | undefined>>,
  sourceName: CredentialSource,
): Record<string, string> | null {
  const values = names.map((name) => {
    const value = nonEmpty(source[name]);
    if (value !== null && !isSafeCredential(value)) {
      throw new EmpiricalError("TRACKER_CREDENTIAL_INVALID", `The ${sourceName} value for ${name} is not a valid tracker credential`);
    }
    return { name, value };
  });
  const present = values.filter((entry) => entry.value !== null);
  if (present.length === 0) return null;
  if (present.length !== names.length) {
    throw new EmpiricalError(
      "TRACKER_CREDENTIAL_INCOMPLETE",
      `The ${sourceName} tracker credential set is incomplete; configure ${names.join(" and ")} together`,
    );
  }
  return Object.fromEntries(values.map((entry) => [entry.name, entry.value!])) as Record<string, string>;
}

function fallbackAuthentication(
  subject: AuthenticationSubject,
  values: Record<string, string>,
  source: CredentialSource,
): ResolvedTrackerAuthentication {
  if (subject.provider === "github") {
    return { provider: "github", source, accessToken: values[subject.credentialEnv.token]! };
  }
  if (subject.provider === "linear") {
    return { provider: "linear", source, accessToken: values[subject.credentialEnv.apiKey]! };
  }
  return {
    provider: "jira",
    source,
    email: values[subject.credentialEnv.email]!,
    apiToken: values[subject.credentialEnv.apiToken]!,
  };
}

function validatedSecret(value: unknown): string {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || /\s/.test(value)
    || /^(?:bearer|basic)\s/i.test(value)
    || !isSafeCredential(value)
  ) {
    return invalidOAuthCredential();
  }
  return value;
}

function invalidOAuthCredential(): never {
  throw new EmpiricalError(
    "TRACKER_OAUTH_RESOLVER_INVALID",
    "The trusted host OAuth resolver returned an invalid credential",
  );
}

function invalidOAuthAuthorization(): never {
  throw new EmpiricalError(
    "TRACKER_OAUTH_AUTHORIZATION_INVALID",
    "The trusted host OAuth resolver returned an invalid authorization handoff",
  );
}

function assertOutsideRepository(path: string, repositoryRoot: string): void {
  const child = relative(repositoryRoot, path);
  if (child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child))) {
    throw new EmpiricalError(
      "TRACKER_SECRET_FILE_IN_REPOSITORY",
      `The host secrets file must be outside the repository: ${path}`,
    );
  }
}

function trackerPlatform(dependencies: TrackerDependencies): "posix" | "win32" {
  return dependencies.platform ?? (process.platform === "win32" ? "win32" : "posix");
}

function safePosixFileMetadata(stats: Stats): boolean {
  const effectiveUserId = typeof process.geteuid === "function" ? process.geteuid() : null;
  return (stats.mode & 0o077) === 0
    && (stats.mode & 0o400) !== 0
    && (effectiveUserId === null || stats.uid === effectiveUserId);
}

function nonEmpty(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === required[index]);
}

function isSafeCredential(value: string): boolean {
  return value.length >= 1 && value.length <= 16_384 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSecretQueryField(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return SECRET_QUERY_FIELDS.has(normalized)
    || normalized.endsWith("token")
    || normalized.endsWith("secret")
    || normalized.endsWith("password")
    || normalized.endsWith("credential")
    || normalized === "authorizationcode"
    || normalized === "codeverifier";
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
