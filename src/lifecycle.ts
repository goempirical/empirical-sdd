import { spawnSync } from "node:child_process";
import { posix, win32 } from "node:path";
import { EmpiricalError } from "./errors.js";

export interface LifecycleProcessResult {
  status: number | null;
  error?: Error;
  stdout?: string;
}

export interface LifecycleRunOptions {
  capture?: boolean;
}

export type LifecycleRunner = (
  command: string,
  args: string[],
  options?: LifecycleRunOptions,
) => LifecycleProcessResult;

export interface UpdateReport {
  package: "updated";
  integrations: "refreshed";
}

export interface PackageUninstallReport {
  package: "removed";
}

export function updateEmpirical(
  runner: LifecycleRunner = runInherited,
  platform: NodeJS.Platform = process.platform,
): UpdateReport {
  const npm = platform === "win32" ? "npm.cmd" : "npm";
  const empirical = platform === "win32" ? "empirical.cmd" : "empirical";
  const latestResult = runner(npm, ["view", "empirical-sdd@latest", "version", "--json"], { capture: true });
  assertStage(latestResult, "UPDATE_LATEST_VERSION_FAILED", "npm latest-version lookup");
  const expectedVersion = parseNpmVersion(latestResult.stdout);

  const packageResult = runner(npm, ["install", "-g", "empirical-sdd@latest"]);
  assertStage(packageResult, "UPDATE_PACKAGE_FAILED", "npm package update");

  const prefixResult = runner(npm, ["prefix", "--global"], { capture: true });
  assertStage(prefixResult, "UPDATE_PREFIX_FAILED", "npm global-prefix discovery");
  const prefix = parseGlobalPrefix(prefixResult.stdout, platform);
  const installedEmpirical = resolveGlobalEmpirical(prefix, platform);

  const installedVersionResult = runner(installedEmpirical, ["--version"], { capture: true });
  assertStage(installedVersionResult, "UPDATE_INSTALLED_VERSION_FAILED", "npm-installed CLI verification");
  const installedVersion = parseCliVersion(installedVersionResult.stdout, "npm-installed CLI");
  if (installedVersion !== expectedVersion) {
    throw new EmpiricalError(
      "UPDATE_INSTALLED_VERSION_MISMATCH",
      `npm-installed CLI version mismatch: expected ${expectedVersion}, observed ${installedVersion} at ${installedEmpirical}. Retry empirical update after checking npm's registry and global prefix.`,
    );
  }

  const integrationResult = runner(installedEmpirical, ["install", "--yes"]);
  assertStage(integrationResult, "UPDATE_INTEGRATIONS_FAILED", "agent integration refresh");

  const pathVersionResult = runner(empirical, ["--version"], { capture: true });
  assertStage(
    pathVersionResult,
    "UPDATE_PATH_VERSION_FAILED",
    "PATH-visible CLI verification",
    pathRemediation(prefix, installedEmpirical, platform),
  );
  const pathVersion = parseCliVersion(pathVersionResult.stdout, "PATH-visible CLI");
  if (pathVersion !== expectedVersion) {
    throw new EmpiricalError(
      "UPDATE_PATH_SHADOWED",
      `PATH-visible empirical version mismatch: expected ${expectedVersion}, observed ${pathVersion}. npm installed the current CLI at ${installedEmpirical}, but another installation is shadowing it. ${pathRemediation(prefix, installedEmpirical, platform)}`,
    );
  }

  return { package: "updated", integrations: "refreshed" };
}

export function resolveGlobalEmpirical(prefix: string, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? win32.join(prefix, "empirical.cmd")
    : posix.join(prefix, "bin", "empirical");
}

export function uninstallEmpirical(runner: LifecycleRunner = runInherited): PackageUninstallReport {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = runner(npm, ["uninstall", "-g", "empirical-sdd"]);
  assertStage(
    result,
    "UNINSTALL_PACKAGE_FAILED",
    "npm package uninstall",
    "Managed agent skills may already have been removed; retry the command or run npm uninstall -g empirical-sdd manually.",
  );
  return { package: "removed" };
}

export function isUninstallConfirmed(answer: string): boolean {
  return /^(?:y|yes)$/i.test(answer.trim());
}

function runInherited(command: string, args: string[], options: LifecycleRunOptions = {}): LifecycleProcessResult {
  const result = options.capture
    ? spawnSync(command, args, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], shell: false })
    : spawnSync(command, args, { stdio: "inherit", shell: false });
  return {
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
    ...(typeof result.stdout === "string" ? { stdout: result.stdout } : {}),
  };
}

function parseNpmVersion(stdout: string | undefined): string {
  const output = requiredOutput(stdout, "npm latest-version lookup");
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new EmpiricalError("UPDATE_LATEST_VERSION_INVALID", "npm latest-version lookup returned malformed JSON");
  }
  if (typeof parsed !== "string" || !isVersion(parsed)) {
    throw new EmpiricalError("UPDATE_LATEST_VERSION_INVALID", "npm latest-version lookup did not return one semantic version");
  }
  return parsed;
}

function parseGlobalPrefix(stdout: string | undefined, platform: NodeJS.Platform): string {
  const prefix = requiredOutput(stdout, "npm global-prefix discovery");
  const absolute = platform === "win32" ? win32.isAbsolute(prefix) : posix.isAbsolute(prefix);
  if (!absolute || /[\r\n]/u.test(prefix)) {
    throw new EmpiricalError("UPDATE_PREFIX_INVALID", "npm global-prefix discovery did not return one absolute path");
  }
  return prefix;
}

function parseCliVersion(stdout: string | undefined, stage: string): string {
  const version = requiredOutput(stdout, stage);
  if (!isVersion(version)) {
    throw new EmpiricalError("UPDATE_CLI_VERSION_INVALID", `${stage} did not return one semantic version`);
  }
  return version;
}

function requiredOutput(stdout: string | undefined, stage: string): string {
  const output = stdout?.trim();
  if (!output) throw new EmpiricalError("UPDATE_OUTPUT_MISSING", `${stage} returned no output`);
  return output;
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value);
}

function pathRemediation(prefix: string, installedEmpirical: string, platform: NodeJS.Platform): string {
  const inspect = platform === "win32" ? "where empirical" : "type -a empirical";
  const bin = platform === "win32" ? prefix : posix.join(prefix, "bin");
  return `Run '${inspect}' and place ${bin} before the older Empirical entry in PATH. The npm-installed executable is ${installedEmpirical}.`;
}

function assertStage(
  result: LifecycleProcessResult,
  code: string,
  stage: string,
  remediation?: string,
): void {
  if (!result.error && result.status === 0) return;
  throw new EmpiricalError(
    code,
    `${stage} failed${result.error ? `: ${result.error.message}` : ` with exit status ${String(result.status)}`}${remediation ? `. ${remediation}` : ""}`,
  );
}
