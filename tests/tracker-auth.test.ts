import { afterEach, describe, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EmpiricalError } from "../src/errors.js";
import {
  defaultTrackerCredentialEnv,
  defaultTrackerSecretFilePath,
  resolveTrackerAuthentication,
  trackerAuthenticationGuidance,
  trackerOAuthAuthorization,
} from "../src/tracker-auth.js";
import type { TrackerDiscoveryInput, TrackerOAuthResolver } from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

const githubInput: TrackerDiscoveryInput = {
  provider: "github",
  credentialEnv: { token: "GITHUB_TOKEN" },
};
const linearInput: TrackerDiscoveryInput = {
  provider: "linear",
  credentialEnv: { apiKey: "LINEAR_SECRET_KEY" },
};
const jiraInput: TrackerDiscoveryInput = {
  provider: "jira",
  target: { siteUrl: "https://example.atlassian.net" },
  credentialEnv: { email: "JIRA_EMAIL", apiToken: "JIRA_API_TOKEN" },
};

describe("secure tracker authentication", () => {
  test("uses OAuth before environment fallback for every provider", async () => {
    const credentials = {
      github: { provider: "github", accessToken: "oauth-github" },
      linear: { provider: "linear", accessToken: "oauth-linear" },
      jira: { provider: "jira", accessToken: "oauth-jira", cloudId: "cloud-123" },
    } as const;
    const resolver: TrackerOAuthResolver = {
      resolve: async (request) => credentials[request.provider],
    };

    expect(await resolveTrackerAuthentication(githubInput, {
      oauthResolver: resolver,
      env: { GITHUB_TOKEN: "environment-github" },
    })).toEqual({ provider: "github", source: "oauth", accessToken: "oauth-github" });
    expect(await resolveTrackerAuthentication(linearInput, {
      oauthResolver: resolver,
      env: { LINEAR_SECRET_KEY: "environment-linear" },
    })).toEqual({ provider: "linear", source: "oauth", accessToken: "oauth-linear" });
    expect(await resolveTrackerAuthentication(jiraInput, {
      oauthResolver: resolver,
      env: { JIRA_EMAIL: "environment@example.com", JIRA_API_TOKEN: "environment-jira" },
    })).toEqual({ provider: "jira", source: "oauth", accessToken: "oauth-jira", cloudId: "cloud-123" });
  });

  test("validates secret-free URL handoffs and contains resolver errors", async () => {
    const resolver: TrackerOAuthResolver = {
      authorize: async ({ provider }) => ({
        provider,
        elicitationId: `${provider}-connect`,
        message: `Connect ${provider} in your trusted host`,
        url: `https://auth.example.test/connect?provider=${provider}`,
      }),
      resolve: async () => null,
    };
    expect(await trackerOAuthAuthorization(linearInput, { oauthResolver: resolver })).toEqual({
      provider: "linear",
      elicitationId: "linear-connect",
      message: "Connect linear in your trusted host",
      url: "https://auth.example.test/connect?provider=linear",
    });

    const leaked = "resolver-secret-sentinel";
    await expect(trackerOAuthAuthorization(linearInput, {
      oauthResolver: { authorize: async () => { throw new Error(leaked); }, resolve: async () => null },
    })).rejects.toMatchObject({ code: "TRACKER_OAUTH_RESOLVER_FAILED" });
    try {
      await trackerOAuthAuthorization(linearInput, {
        oauthResolver: { authorize: async () => { throw new Error(leaked); }, resolve: async () => null },
      });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(leaked);
    }

    await expect(trackerOAuthAuthorization(linearInput, {
      oauthResolver: {
        authorize: async () => ({
          provider: "linear",
          elicitationId: "linear-connect",
          message: "Connect Linear",
          url: "https://auth.example.test/connect?access_token=do-not-return-this",
        }),
        resolve: async () => null,
      },
    })).rejects.toMatchObject({ code: "TRACKER_OAUTH_AUTHORIZATION_INVALID" });

    await expect(trackerOAuthAuthorization(linearInput, {
      oauthResolver: {
        authorize: async () => ({
          provider: "linear",
          elicitationId: "linear-connect",
          message: "Connect Linear",
          url: "https://auth.example.test/connect?clientSecret=do-not-return-this",
        }),
        resolve: async () => null,
      },
    })).rejects.toMatchObject({ code: "TRACKER_OAUTH_AUTHORIZATION_INVALID" });

    await expect(resolveTrackerAuthentication(linearInput, {
      env: {},
      oauthResolver: {
        resolve: async () => ({
          provider: "linear",
          accessToken: "oauth-token",
          unexpected: leaked,
        } as unknown as { provider: "linear"; accessToken: string }),
      },
    })).rejects.toMatchObject({ code: "TRACKER_OAUTH_RESOLVER_INVALID" });

    await expect(resolveTrackerAuthentication(linearInput, {
      env: {},
      oauthResolver: {
        resolve: async () => ({ provider: "linear", accessToken: "Bearer already-prefixed" }),
      },
    })).rejects.toMatchObject({ code: "TRACKER_OAUTH_RESOLVER_INVALID" });

    const getterLeak = "resolver-getter-secret-sentinel";
    const hostileCredential = new Proxy({} as { provider: "linear"; accessToken: string }, {
      get: (_target, property) => {
        if (property === "then") return undefined;
        throw new Error(getterLeak);
      },
    });
    try {
      await resolveTrackerAuthentication(linearInput, {
        env: {},
        oauthResolver: { resolve: async () => hostileCredential },
      });
      throw new Error("expected hostile resolver credential to fail");
    } catch (error) {
      expect((error as EmpiricalError).code).toBe("TRACKER_OAUTH_RESOLVER_INVALID");
      expect(String((error as Error).message)).not.toContain(getterLeak);
    }
  });

  test("uses environment before a permission-checked host file", async () => {
    const root = await temporaryDirectory("empirical-auth-root-");
    const host = await temporaryDirectory("empirical-auth-host-");
    const path = join(host, "secrets.env");
    await writeFile(path, "LINEAR_SECRET_KEY=file-token\n", { mode: 0o600 });
    if (process.platform !== "win32") await chmod(path, 0o600);

    expect(await resolveTrackerAuthentication(linearInput, {
      env: { LINEAR_SECRET_KEY: "environment-token" },
      secretFilePath: path,
      repositoryRoot: root,
      platform: "posix",
    })).toEqual({ provider: "linear", source: "environment", accessToken: "environment-token" });
    expect(await resolveTrackerAuthentication(linearInput, {
      env: {},
      secretFilePath: path,
      repositoryRoot: root,
      platform: "posix",
    })).toEqual({ provider: "linear", source: "file", accessToken: "file-token" });
  });

  test("keeps Jira fallback identities atomic and independent of file ordering", async () => {
    const root = await temporaryDirectory("empirical-auth-root-");
    const host = await temporaryDirectory("empirical-auth-host-");
    const path = join(host, "secrets.env");
    await writeFile(path, "JIRA_API_TOKEN=jira-token\nJIRA_EMAIL=user@example.com\n", { mode: 0o600 });
    if (process.platform !== "win32") await chmod(path, 0o600);

    expect(await resolveTrackerAuthentication(jiraInput, {
      env: {},
      secretFilePath: path,
      repositoryRoot: root,
      platform: "posix",
    })).toEqual({ provider: "jira", source: "file", email: "user@example.com", apiToken: "jira-token" });

    await expect(resolveTrackerAuthentication(jiraInput, {
      env: { JIRA_EMAIL: "user@example.com" },
      secretFilePath: path,
      repositoryRoot: root,
      platform: "posix",
    })).rejects.toMatchObject({ code: "TRACKER_CREDENTIAL_INCOMPLETE" });
  });

  test("does not read an implicit user file when an environment map is injected", async () => {
    const root = await temporaryDirectory("empirical-auth-root-");
    const home = await temporaryDirectory("empirical-auth-home-");
    const path = join(home, ".config", "empirical", "secrets.env");
    await mkdir(join(home, ".config", "empirical"), { recursive: true });
    await writeFile(path, "LINEAR_SECRET_KEY=implicit-file-token\n", { mode: 0o600 });

    await expect(resolveTrackerAuthentication(linearInput, {
      env: {},
      homeDirectory: home,
      repositoryRoot: root,
      platform: "posix",
    })).rejects.toMatchObject({ code: "TRACKER_CREDENTIAL_MISSING" });
  });

  test("refuses repository files, links, oversized files, and unsafe permissions", async () => {
    const root = await temporaryDirectory("empirical-auth-root-");
    const host = await temporaryDirectory("empirical-auth-host-");
    const inside = join(root, "secrets.env");
    await writeFile(inside, "LINEAR_SECRET_KEY=inside\n", { mode: 0o600 });
    await expect(resolveTrackerAuthentication(linearInput, {
      env: {}, secretFilePath: inside, repositoryRoot: root, platform: "posix",
    })).rejects.toMatchObject({ code: "TRACKER_SECRET_FILE_IN_REPOSITORY" });

    const target = join(host, "target.env");
    const linked = join(host, "linked.env");
    await writeFile(target, "LINEAR_SECRET_KEY=linked\n", { mode: 0o600 });
    await symlink(target, linked);
    await expect(resolveTrackerAuthentication(linearInput, {
      env: {}, secretFilePath: linked, repositoryRoot: root, platform: "posix",
    })).rejects.toMatchObject({ code: "TRACKER_SECRET_FILE_UNSAFE" });

    if (process.platform !== "win32") {
      const hardTarget = join(host, "hard-target.env");
      const hardLinked = join(host, "hard-linked.env");
      await writeFile(hardTarget, "LINEAR_SECRET_KEY=hard-linked\n", { mode: 0o600 });
      await link(hardTarget, hardLinked);
      await expect(resolveTrackerAuthentication(linearInput, {
        env: {}, secretFilePath: hardLinked, repositoryRoot: root, platform: "posix",
      })).rejects.toMatchObject({ code: "TRACKER_SECRET_FILE_UNSAFE" });
    }

    const oversized = join(host, "oversized.env");
    await writeFile(oversized, `LINEAR_SECRET_KEY=${"x".repeat(65 * 1_024)}\n`, { mode: 0o600 });
    await expect(resolveTrackerAuthentication(linearInput, {
      env: {}, secretFilePath: oversized, repositoryRoot: root, platform: "posix",
    })).rejects.toMatchObject({ code: "TRACKER_SECRET_FILE_TOO_LARGE" });

    if (process.platform !== "win32") {
      const exposed = join(host, "exposed.env");
      await writeFile(exposed, "LINEAR_SECRET_KEY=exposed\n", { mode: 0o644 });
      await chmod(exposed, 0o644);
      await expect(resolveTrackerAuthentication(linearInput, {
        env: {}, secretFilePath: exposed, repositoryRoot: root, platform: "posix",
      })).rejects.toMatchObject({ code: "TRACKER_SECRET_FILE_PERMISSIONS" });
    }
  });

  test("rejects malformed and duplicate assignments without disclosing values", async () => {
    const root = await temporaryDirectory("empirical-auth-root-");
    const host = await temporaryDirectory("empirical-auth-host-");
    const path = join(host, "secrets.env");
    for (const source of [
      "export LINEAR_SECRET_KEY=sentinel-one\n",
      "LINEAR_SECRET_KEY=sentinel-one\nLINEAR_SECRET_KEY=sentinel-two\n",
    ]) {
      await writeFile(path, source, { mode: 0o600 });
      if (process.platform !== "win32") await chmod(path, 0o600);
      try {
        await resolveTrackerAuthentication(linearInput, {
          env: {}, secretFilePath: path, repositoryRoot: root, platform: "posix",
        });
        throw new Error("expected file validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(EmpiricalError);
        expect((error as EmpiricalError).code).toBe("TRACKER_SECRET_FILE_INVALID");
        expect((error as Error).message).not.toContain("sentinel-one");
        expect((error as Error).message).not.toContain("sentinel-two");
      }
    }
  });

  test("publishes exact safe defaults, paths, and no-chat guidance", () => {
    expect(defaultTrackerCredentialEnv("linear")).toEqual({ apiKey: "LINEAR_SECRET_KEY" });
    expect(defaultTrackerCredentialEnv("github")).toEqual({ token: "GITHUB_TOKEN" });
    expect(defaultTrackerCredentialEnv("jira")).toEqual({ email: "JIRA_EMAIL", apiToken: "JIRA_API_TOKEN" });
    expect(defaultTrackerSecretFilePath({
      env: { HOME: "/safe/home" }, platform: "posix", homeDirectory: "/safe/home",
    })).toBe("/safe/home/.config/empirical/secrets.env");
    expect(defaultTrackerSecretFilePath({
      env: { APPDATA: "C:\\Users\\safe\\AppData\\Roaming" }, platform: "win32",
    })).toBe("C:\\Users\\safe\\AppData\\Roaming\\Empirical\\secrets.env");
    expect(defaultTrackerSecretFilePath({
      env: { APPDATA: "relative" }, platform: "win32", homeDirectory: "C:\\Users\\safe",
    })).toBe("C:\\Users\\safe\\AppData\\Roaming\\Empirical\\secrets.env");
    const guidance = trackerAuthenticationGuidance("linear", {
      env: { HOME: "/safe/home" }, platform: "posix", homeDirectory: "/safe/home",
    });
    expect(guidance.message).toContain("Connect Linear through trusted host OAuth first");
    expect(guidance.message).toContain("/safe/home/.config/empirical/secrets.env");
    expect(guidance.message).toContain("Never paste credentials into chat");
    expect(guidance.message).not.toContain("LINEAR_API_KEY");
    const custom = trackerAuthenticationGuidance({
      provider: "linear",
      credentialEnv: { apiKey: "CUSTOM_LINEAR_TOKEN_NAME" },
    }, {
      env: { HOME: "/safe/home" }, platform: "posix", homeDirectory: "/safe/home",
    });
    expect(custom.credentialNames).toEqual(["CUSTOM_LINEAR_TOKEN_NAME"]);
    expect(custom.message).toContain("CUSTOM_LINEAR_TOKEN_NAME");
    expect(custom.message).not.toContain("LINEAR_SECRET_KEY");
  });
});
