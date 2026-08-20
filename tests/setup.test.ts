import { describe, expect, test } from "bun:test";
import {
  recommendedSetupSettings,
  renderSetupSummary,
  setupConfigurationInput,
  validateSetupSettings,
} from "../src/setup.js";

describe("setup settings", () => {
  test("renders every safe default before persistence", () => {
    const settings = recommendedSetupSettings();
    const summary = renderSetupSummary(settings, { current: false, resolvedBase: "main" });
    expect(summary).toContain("Empirical setup · recommended");
    expect(summary).toContain("Questions: concise · only material blockers");
    expect(summary).toContain("Verification: tests on · browser on · screenshots on · review on");
    expect(summary).toContain("Worktrees: ask · base auto (currently main) · {type}/{feature}");
    expect(summary).toContain("Decisions: required");
    expect(summary).toContain("Tracker: choose Track work or No tracking before Save");
    expect(summary).toContain("Auth: host OAuth first");
    expect(summary.replaceAll("\\", "/").toLowerCase()).toContain("empirical/secrets.env");
    expect(summary).toContain("Never paste credentials into chat");
    expect(setupConfigurationInput(settings)).toMatchObject({
      setupComplete: true,
      evidence: { required: true },
      interaction: { questions: "concise" },
    });
  });

  test("distinguishes an explicit no-tracking choice from missing tracker setup", () => {
    const settings = recommendedSetupSettings();
    const disabled = renderSetupSummary(settings, {
      current: true,
      trackerSetup: { mode: "disabled", policy: null },
    });
    expect(disabled).toContain("Tracker: no tracking · local-only · current");
    expect(disabled).not.toContain("before Save");

    const configured = renderSetupSummary(settings, {
      current: true,
      trackerSetup: {
        mode: "configured",
        policy: {
          schemaVersion: 2,
          provider: "linear",
          target: { teamId: "team-1", projectId: null },
          credentialEnv: { apiKey: "LINEAR_API_KEY" },
          states: {
            specification: "todo",
            planned: "todo",
            "in-progress": "doing",
            verification: "review",
            review: "review",
            blocked: "blocked",
            done: "done",
          },
          ticket: "ensure",
          visibility: "milestones",
        },
      },
    });
    expect(configured).toContain("Tracker: Track all work · Linear · tickets ensure");
    expect(configured).toContain("Auth: host OAuth first");
    expect(configured).toContain("Never paste credentials into chat");
  });

  test("explains inactive UI sub-policies without erasing them", () => {
    const settings = recommendedSetupSettings();
    settings.interaction.questions = "detailed";
    settings.evidence.required = false;
    const summary = renderSetupSummary(settings, { current: true });
    expect(summary).toContain("Current settings");
    expect(summary).toContain("Real-browser evidence for [UI] criteria  on · inactive");
    expect(summary).toContain("values stay saved");
    expect(summary).toContain("Code review remains independent");
    expect(settings.evidence.browserForUi).toBe(true);
    expect(settings.evidence.screenshotForUi).toBe(true);
    expect(renderSetupSummary(settings, { current: false, effective: true })).toContain("Effective settings");
    expect(renderSetupSummary(settings, { current: true })).toContain("Detailed questions and expanded runtime summaries");
  });

  test("validates path and branch templates before save", () => {
    const settings = recommendedSetupSettings();
    expect(() => validateSetupSettings(settings)).not.toThrow();
    settings.isolation.worktreePath = "../fixed";
    expect(() => validateSetupSettings(settings)).toThrow("Worktree path template must contain {feature}");
    settings.isolation.worktreePath = "../{feature}";
    settings.isolation.branchPattern = "feature/{feature}";
    expect(() => validateSetupSettings(settings)).toThrow("Branch pattern must contain {type} and {feature}");
    settings.isolation.branchPattern = "{type}/{feature}";
    settings.interaction.questions = "invalid" as "concise";
    expect(() => validateSetupSettings(settings)).toThrow("Questions must be concise or detailed");
  });
});
