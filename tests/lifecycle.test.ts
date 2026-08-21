import { describe, expect, test } from "bun:test";
import {
  isUninstallConfirmed,
  resolveGlobalEmpirical,
  uninstallEmpirical,
  updateEmpirical,
  type LifecycleRunOptions,
  type LifecycleRunner,
} from "../src/lifecycle.js";

describe("package lifecycle", () => {
  test("update verifies and invokes the CLI from npm's actual global prefix", () => {
    const platform = process.platform;
    const npm = platform === "win32" ? "npm.cmd" : "npm";
    const empirical = platform === "win32" ? "empirical.cmd" : "empirical";
    const prefix = platform === "win32" ? "C:\\Users\\test\\AppData\\Roaming\\npm" : "/opt/npm-global";
    const installed = resolveGlobalEmpirical(prefix, platform);
    const calls: Array<[string, string[], LifecycleRunOptions | undefined]> = [];
    const results = [
      { status: 0, stdout: '"0.26.1"\n' },
      { status: 0 },
      { status: 0, stdout: `${prefix}\n` },
      { status: 0, stdout: "0.26.1\n" },
      { status: 0 },
      { status: 0, stdout: "0.26.1\n" },
    ];
    const runner: LifecycleRunner = (command, args, options) => {
      calls.push([command, args, options]);
      return results[calls.length - 1] ?? { status: 99 };
    };
    expect(updateEmpirical(runner)).toEqual({ package: "updated", integrations: "refreshed" });
    expect(calls).toEqual([
      [npm, ["view", "empirical-sdd@latest", "version", "--json"], { capture: true }],
      [npm, ["install", "-g", "empirical-sdd@latest"], undefined],
      [npm, ["prefix", "--global"], { capture: true }],
      [installed, ["--version"], { capture: true }],
      [installed, ["install", "--yes"], undefined],
      [empirical, ["--version"], { capture: true }],
    ]);
  });

  test("global executable paths use the npm layout for POSIX and Windows", () => {
    expect(resolveGlobalEmpirical("/home/test/.npm-global", "linux"))
      .toBe("/home/test/.npm-global/bin/empirical");
    expect(resolveGlobalEmpirical("C:\\Users\\test\\AppData\\Roaming\\npm", "win32"))
      .toBe("C:\\Users\\test\\AppData\\Roaming\\npm\\empirical.cmd");
  });

  test("update stops with a stage-specific error when package update fails", () => {
    let call = 0;
    expect(() => updateEmpirical(() => call++ === 0
      ? { status: 0, stdout: '"0.26.1"' }
      : { status: 1 }))
      .toThrow("npm package update failed with exit status 1");
  });

  test("update reports integration refresh failures separately", () => {
    let call = 0;
    const prefix = process.platform === "win32" ? "C:\\npm" : "/opt/npm";
    const results = [
      { status: 0, stdout: '"0.26.1"' },
      { status: 0 },
      { status: 0, stdout: prefix },
      { status: 0, stdout: "0.26.1" },
      { status: 7 },
    ];
    expect(() => updateEmpirical(() => results[call++] ?? { status: 99 }))
      .toThrow("agent integration refresh failed with exit status 7");
  });

  test("update rejects a stale PATH-visible Empirical after refreshing with the prefix CLI", () => {
    let call = 0;
    const prefix = process.platform === "win32" ? "C:\\npm" : "/opt/npm";
    const results = [
      { status: 0, stdout: '"0.26.1"' },
      { status: 0 },
      { status: 0, stdout: prefix },
      { status: 0, stdout: "0.26.1" },
      { status: 0 },
      { status: 0, stdout: "0.23.1" },
    ];
    expect(() => updateEmpirical(() => results[call++] ?? { status: 99 }))
      .toThrow(/PATH-visible empirical version mismatch: expected 0\.26\.1, observed 0\.23\.1.*shadowing.*PATH/u);
  });

  test("update rejects a prefix-owned CLI that does not match npm latest", () => {
    let call = 0;
    const prefix = process.platform === "win32" ? "C:\\npm" : "/opt/npm";
    const results = [
      { status: 0, stdout: '"0.26.1"' },
      { status: 0 },
      { status: 0, stdout: prefix },
      { status: 0, stdout: "0.26.0" },
    ];
    expect(() => updateEmpirical(() => results[call++] ?? { status: 99 }))
      .toThrow("npm-installed CLI version mismatch: expected 0.26.1, observed 0.26.0");
  });

  test("update rejects malformed registry and global-prefix discovery", () => {
    expect(() => updateEmpirical(() => ({ status: 0, stdout: "latest" })))
      .toThrow("npm latest-version lookup returned malformed JSON");

    let call = 0;
    const results = [
      { status: 0, stdout: '"0.26.1"' },
      { status: 0 },
      { status: 0, stdout: "relative/npm" },
    ];
    expect(() => updateEmpirical(() => results[call++] ?? { status: 99 }))
      .toThrow("npm global-prefix discovery did not return one absolute path");
  });

  test("update reports an unavailable PATH-visible CLI with remediation", () => {
    let call = 0;
    const prefix = process.platform === "win32" ? "C:\\npm" : "/opt/npm";
    const results = [
      { status: 0, stdout: '"0.26.1"' },
      { status: 0 },
      { status: 0, stdout: prefix },
      { status: 0, stdout: "0.26.1" },
      { status: 0 },
      { status: null, error: new Error("not found") },
    ];
    expect(() => updateEmpirical(() => results[call++] ?? { status: 99 }))
      .toThrow(/PATH-visible CLI verification failed: not found.*(?:type -a empirical|where empirical)/u);
  });

  test("uninstall removes the exact global package through the platform npm executable", () => {
    const calls: Array<[string, string[]]> = [];
    const report = uninstallEmpirical((command, args) => {
      calls.push([command, args]);
      return { status: 0 };
    });
    expect(report).toEqual({ package: "removed" });
    expect(calls).toEqual([[
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["uninstall", "-g", "empirical-sdd"],
    ]]);
  });

  test("uninstall reports package-stage failure after managed cleanup may have occurred", () => {
    expect(() => uninstallEmpirical(() => ({ status: 9 })))
      .toThrow("npm package uninstall failed with exit status 9. Managed agent skills may already have been removed");
  });

  test("uninstall confirmation defaults closed and accepts only an explicit yes", () => {
    for (const answer of ["", "n", "no", "cancel", "true", "1"]) {
      expect(isUninstallConfirmed(answer)).toBe(false);
    }
    for (const answer of ["y", "Y", "yes", "YES", "  yes  "]) {
      expect(isUninstallConfirmed(answer)).toBe(true);
    }
  });
});
