import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EmpiricalProject } from "../src/core.js";
import { OPERATIONS, operationAnnotations } from "../src/operations.js";

const directories: string[] = [];

const trackerStates = {
  specification: "linear-state-specification",
  planned: "linear-state-planned",
  "in-progress": "linear-state-progress",
  verification: "linear-state-verification",
  review: "linear-state-review",
  blocked: "linear-state-blocked",
  done: "linear-state-done",
} as const;

const linearTrackerPolicy = {
  schemaVersion: 1,
  provider: "linear",
  target: { teamId: "linear-team", projectId: null },
  credentialEnv: { apiKey: "EMPIRICAL_TEST_UNSET_LINEAR_API_KEY" },
  states: trackerStates,
} as const;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("the bundled stdio MCP server exposes and executes the portable workflow tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "empirical-mcp-"));
  const complexRoot = await mkdtemp(join(tmpdir(), "empirical-mcp-complex-"));
  const discoveryRoot = await mkdtemp(join(tmpdir(), "empirical-mcp-discovery-"));
  directories.push(root, complexRoot, discoveryRoot);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", resolve("src/cli.ts"), "mcp", "--root", root],
    cwd: resolve("."),
    stderr: "pipe",
  });
  const client = new Client({ name: "empirical-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort())
      .toEqual(OPERATIONS.map((operation) => operation.mcpName).sort());
    for (const operation of OPERATIONS) {
      expect(listed.tools.find((tool) => tool.name === operation.mcpName)?.description)
        .toBe(operation.summary);
    }

    const loopTool = listed.tools.find((tool) => tool.name === "empirical_loop");
    expect(Object.keys(loopTool?.inputSchema.properties ?? {})).toEqual(["root"]);
    const initTool = listed.tools.find((tool) => tool.name === "empirical_init");
    expect(Object.keys(initTool?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining([
      "evidenceRequired", "browserForUi", "screenshotForUi", "codeReview",
      "isolation", "base", "worktreePath", "branchPattern", "decisions",
    ]));
    const completeTool = listed.tools.find((tool) => tool.name === "empirical_complete");
    expect(Object.keys(completeTool?.inputSchema.properties ?? {})).toContain("receiptIds");
    expect(Object.keys(completeTool?.inputSchema.properties ?? {})).not.toContain("evidence");
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "empirical_tracker_configure",
      "empirical_tracker_bind",
      "empirical_tracker_sync",
    ]));
    const trackerConfigureTool = listed.tools.find((tool) => tool.name === "empirical_tracker_configure");
    const trackerBindTool = listed.tools.find((tool) => tool.name === "empirical_tracker_bind");
    const trackerSyncTool = listed.tools.find((tool) => tool.name === "empirical_tracker_sync");
    for (const [tool, operation] of [
      [trackerConfigureTool, "tracker-configure"],
      [trackerBindTool, "tracker-bind"],
      [trackerSyncTool, "tracker-sync"],
    ] as const) {
      expect(tool?.annotations).toEqual(operationAnnotations(operation));
      expect(tool?.annotations?.destructiveHint).toBe(true);
    }

    const configureSchema = trackerConfigureTool?.inputSchema as {
      additionalProperties?: boolean;
      properties?: { policy?: { anyOf?: Array<{ oneOf?: unknown[]; type?: string }> } };
    };
    expect(configureSchema.additionalProperties).toBe(false);
    const policyChoices = configureSchema.properties?.policy?.anyOf ?? [];
    const providerChoices = policyChoices.find((choice) => choice.oneOf)?.oneOf ?? [];
    expect(providerChoices).toHaveLength(3);
    expect(JSON.stringify(providerChoices)).toContain('"const":"github"');
    expect(JSON.stringify(providerChoices)).toContain('"const":"linear"');
    expect(JSON.stringify(providerChoices)).toContain('"const":"jira"');
    expect(policyChoices.some((choice) => choice.type === "null")).toBe(true);
    for (const providerChoice of providerChoices as Array<{
      additionalProperties?: boolean;
      properties?: Record<string, {
        additionalProperties?: boolean;
        required?: string[];
      }>;
      required?: string[];
    }>) {
      expect(providerChoice.additionalProperties).toBe(false);
      expect(providerChoice.required).toEqual(expect.arrayContaining([
        "schemaVersion", "provider", "target", "credentialEnv", "states",
      ]));
      for (const property of ["target", "credentialEnv", "states"]) {
        expect(providerChoice.properties?.[property]?.additionalProperties).toBe(false);
      }
      expect(providerChoice.properties?.states?.required).toEqual(expect.arrayContaining([
        "specification", "planned", "in-progress", "verification", "review", "blocked", "done",
      ]));
    }

    const bindSchema = trackerBindTool?.inputSchema as {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
      oneOf?: Array<{
        properties?: Record<string, { const?: string }>;
        required?: string[];
        not?: { anyOf?: Array<{ required?: string[] }> };
      }>;
    };
    expect(bindSchema.additionalProperties).toBe(false);
    expect(Object.keys(bindSchema.properties ?? {}).sort()).toEqual([
      "confirmCreateRetry", "description", "mode", "replace", "root", "ticket", "title",
    ]);
    expect(bindSchema.oneOf).toHaveLength(2);
    const createSchema = bindSchema.oneOf?.find((choice) => choice.properties?.mode?.const === "create");
    const attachSchema = bindSchema.oneOf?.find((choice) => choice.properties?.mode?.const === "attach");
    expect(createSchema?.required).toEqual(["mode"]);
    expect(createSchema?.not?.anyOf?.map((condition) => condition.required)).toEqual([["ticket"]]);
    expect(attachSchema?.required).toEqual(["mode", "ticket"]);
    expect(attachSchema?.not?.anyOf?.map((condition) => condition.required)).toEqual([
      ["title"], ["description"], ["confirmCreateRetry"],
    ]);

    const initialized = await client.callTool({
      name: "empirical_init",
      arguments: { root },
    });
    expect(initialized.isError).not.toBe(true);
    expect(initialized.structuredContent).toMatchObject({
      state: { profile: "complex", phase: "idle", revision: 0 },
      knowledge: {
        status: "current",
        manifest: ".empirical/context/manifest.json",
      },
    });

    const context = await client.callTool({ name: "empirical_context", arguments: { root } });
    expect(context.isError).not.toBe(true);
    expect(context.structuredContent).toMatchObject({
      status: "current",
      refinementRequired: [],
      context: [
        ".empirical/context/index.md",
        ".empirical/context/overview.md",
        ".empirical/context/architecture.md",
        ".empirical/context/commands.md",
        ".empirical/context/conventions.md",
      ],
    });

    const explored = await client.callTool({
      name: "empirical_explore",
      arguments: { root, problem: "We might need a more useful status experience" },
    });
    expect(explored.isError).not.toBe(true);
    expect(explored.structuredContent).toMatchObject({
      problem: "We might need a more useful status experience",
      projectContext: [],
      capabilityContext: [],
    });
    expect(explored.structuredContent).toEqual(
      await (await EmpiricalProject.open(root)).explore(
        "We might need a more useful status experience",
      ),
    );

    const idle = await client.callTool({
      name: "empirical_loop",
      arguments: { root },
    });
    expect(idle.isError).not.toBe(true);
    expect(idle.structuredContent).toMatchObject({ phase: "idle", revision: 0 });
    expect((idle.structuredContent as { instructions: string }).instructions)
      .toContain("installed empirical skill");
    expect((idle.structuredContent as { instructions: string }).instructions)
      .toContain("does not create or route new work");

    const started = await client.callTool({
      name: "empirical_fast",
      arguments: { root, request: "Add a status command" },
    });
    expect(started.isError).not.toBe(true);
    expect(started.structuredContent).toMatchObject({
      request: "Add a status command",
      profile: "fast",
      phase: "implement",
      status: "waiting",
      revision: 1,
      requiredEvidence: ["test", "review"],
      tracker: { health: "local-only", provider: null },
      kind: "action",
    });

    const status = await client.callTool({ name: "empirical_status", arguments: { root } });
    expect(status.isError).not.toBe(true);
    expect(status.structuredContent).toMatchObject({
      phase: "implement",
      tracker: { health: "local-only", provider: null },
    });

    const resumed = await client.callTool({
      name: "empirical_loop",
      arguments: { root },
    });
    expect(resumed.isError).not.toBe(true);
    expect(resumed.structuredContent).toEqual(started.structuredContent);

    const idempotentFast = await client.callTool({
      name: "empirical_fast",
      arguments: { root, request: "Add a status command" },
    });
    expect(idempotentFast.isError).not.toBe(true);
    expect(idempotentFast.structuredContent).toEqual(started.structuredContent);

    const invalidTrackerPolicy = await client.callTool({
      name: "empirical_tracker_configure",
      arguments: { root, policy: { ...linearTrackerPolicy, unexpected: true } },
    });
    expect(invalidTrackerPolicy.isError).toBe(true);
    expect(JSON.stringify(invalidTrackerPolicy.content)).toContain("Input validation error");

    const trackerConfigured = await client.callTool({
      name: "empirical_tracker_configure",
      arguments: { root, policy: linearTrackerPolicy },
    });
    expect(trackerConfigured.isError).not.toBe(true);
    expect(trackerConfigured.structuredContent).toMatchObject(linearTrackerPolicy);

    for (const arguments_ of [
      { root, mode: "create", ticket: "LIN-1" },
      { root, mode: "create", unexpected: true },
      { root, mode: "attach", ticket: "LIN-1", title: "Not applicable" },
      { root, mode: "attach", ticket: "LIN-1", description: "Not applicable" },
      { root, mode: "attach", ticket: "LIN-1", confirmCreateRetry: true },
      { root, mode: "attach" },
      { root, mode: "invalid" },
    ]) {
      const rejected = await client.callTool({
        name: "empirical_tracker_bind",
        arguments: arguments_,
      });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected.content)).toContain("Input validation error");
    }

    const trackerDisabled = await client.callTool({
      name: "empirical_tracker_configure",
      arguments: { root, policy: null },
    });
    expect(trackerDisabled.isError).not.toBe(true);
    expect(trackerDisabled.structuredContent).toEqual({ value: null });

    const configured = await client.callTool({
      name: "empirical_configure",
      arguments: {
        root,
        evidenceRequired: false,
        browserForUi: false,
        screenshotForUi: true,
        codeReview: true,
        isolation: "off",
        decisions: "off",
      },
    });
    expect(configured.isError).not.toBe(true);
    expect(configured.structuredContent).toMatchObject({
      evidence: { required: false, browserForUi: false, screenshotForUi: true, codeReview: true },
      isolation: { mode: "off" },
      decisions: { complexRecords: "off" },
    });

    const complexInitialized = await client.callTool({
      name: "empirical_init",
      arguments: { root: complexRoot },
    });
    expect(complexInitialized.isError).not.toBe(true);

    const complex = await client.callTool({
      name: "empirical_complex",
      arguments: { root: complexRoot, request: "Replace authentication safely" },
    });
    expect(complex.isError).not.toBe(true);
    expect(complex.structuredContent).toMatchObject({
      request: "Replace authentication safely",
      profile: "complex",
      phase: "specify",
      status: "waiting",
      revision: 1,
    });

    const resumedComplex = await client.callTool({
      name: "empirical_loop",
      arguments: { root: complexRoot },
    });
    expect(resumedComplex.isError).not.toBe(true);
    expect(resumedComplex.structuredContent).toEqual(complex.structuredContent);

    expect((await client.callTool({
      name: "empirical_init",
      arguments: { root: discoveryRoot },
    })).isError).not.toBe(true);
    const problem = "Clarify an agent-native Socratic contract";
    const answers = [
      { pass: "problem", title: "Problem and user", question: "Who needs this?", answer: "Repository developers need durable discovery before implementation.", followUp: null },
      { pass: "outcome", title: "Observable outcome", question: "What changes?", answer: "The developer approves one exact contract and sees Complex Specify start.", followUp: null },
      { pass: "boundaries", title: "Boundaries", question: "What is excluded?", answer: "Include file-backed answers only; no hosted service or external runtime launch.", followUp: null },
      { pass: "risks", title: "Failure and risk", question: "What can fail?", answer: "Invalid input must fail safely without losing the last valid draft or creating work.", followUp: null },
      { pass: "verification", title: "Verification", question: "How is it proven?", answer: "Integration tests assert persistence, exact handoff, rejection, and specification state.", followUp: null },
    ];
    const draftDiscovery = await client.callTool({
      name: "empirical_discovery",
      arguments: { root: discoveryRoot, problem, answers: answers.slice(0, 1) },
    });
    expect(draftDiscovery.isError).not.toBe(true);
    expect(draftDiscovery.structuredContent).toMatchObject({
      record: { status: "draft" },
      nextQuestion: { pass: "outcome", kind: "pass" },
      start: null,
    });
    const discoveryId = (draftDiscovery.structuredContent as { record: { id: string } }).record.id;
    const approvedDiscovery = await client.callTool({
      name: "empirical_discovery",
      arguments: { root: discoveryRoot, id: discoveryId, problem, answers, approved: true },
    });
    expect(approvedDiscovery.isError).not.toBe(true);
    expect(approvedDiscovery.structuredContent).toMatchObject({
      record: { id: discoveryId, status: "started", workflow: "complex" },
      start: { kind: "action", phase: "specify", revision: 1 },
    });

    const explained = await client.callTool({ name: "empirical_explain", arguments: { root: complexRoot } });
    expect(explained.isError).not.toBe(true);
    expect(explained.structuredContent).toMatchObject({
      feature: "replace-authentication-safely",
      rationale: { gate: "proceed" },
    });
  } finally {
    await client.close();
  }
}, 30_000);
