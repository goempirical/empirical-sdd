#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { renderBrandBannerForOutput } from "./branding.js";
import { EmpiricalProject } from "./core.js";
import {
  buildRefinedRequest,
  createDiscoveryRecord,
  materialFollowUp,
  recommendWorkflow,
  saveDiscovery,
  socraticQuestions,
  type DiscoveryRecord,
  type DiscoverySubmission,
  type DiscoverySubmissionResult,
  type DiscoveryWorkflow,
  type SocraticAnswer,
} from "./discovery.js";
import { EmpiricalError, asErrorMessage } from "./errors.js";
import {
  agentSkillTarget,
  detectAgentSkillTargets,
  globalAgentSkillTargets,
  resolveAgentSkillTargetId,
  type AgentSkillTargetDefinition,
  type AgentSkillTargetId,
} from "./agent-catalog.js";
import {
  installGlobalAgentSkills,
  installedGlobalAgentIds,
  managedGlobalAgentIds,
  uninstallGlobalAgentSkills,
} from "./integrations.js";
import { isUninstallConfirmed, uninstallEmpirical, updateEmpirical } from "./lifecycle.js";
import { runMcpServer } from "./mcp.js";
import { OPERATIONS, SKILLS, operationById } from "./operations.js";
import { authorizationSchema, digestJson } from "./protocol.js";
import { selectAgentsInteractive, type AgentSelectorItem } from "./selector.js";
import {
  recommendedSetupSettings,
  renderSetupSummary,
  setupConfigurationInput,
  setupSettingsFromConfig,
  validateSetupSettings,
  type SetupSettings,
} from "./setup.js";
import { ProjectStore } from "./storage.js";
import {
  defaultTrackerCredentialEnv,
  trackerAuthenticationGuidance,
} from "./tracker-auth.js";
import {
  discoverTracker,
  loadTrackerSetupState,
  parseTrackerBindInput,
  parseTrackerDiscoveryInput,
  parseTrackerSetupChange,
  previewTrackerPolicy,
  proposeTrackerStateMapping,
  recommendedTrackerTicketRules,
  suggestTrackerStateMapping,
  type TrackerSetupState,
} from "./tracking.js";
import { detectBase } from "./worktrees.js";
import {
  PRODUCT_VERSION,
  type ActionPacket,
  type AgentHandoffOffer,
  type AgentIntegrationId,
  type AuthorizedAgentHandoff,
  type CompletionInput,
  type ExplorationPacket,
  type FeatureStartResult,
  type IntegrationReport,
  type ProjectConfigurationInput,
  type ProjectStatus,
  type TrackerStatus,
  type TrackerDiscovery,
  type TrackerDiscoveryInput,
  type TrackerDiscoveryResource,
  type TrackerPolicy,
  type TrackerPolicyPreview,
  type TrackerSetupChange,
  type TrackerStateMap,
  type TrackerTicketRequirement,
  type TrackerTicketRules,
  type UninstallReport,
  type WorktreeHandoff,
  type WorktreeProposal,
  type Workflow,
} from "./types.js";

interface CliContext {
  args: string[];
  root: string;
  json: boolean;
}

async function main(): Promise<void> {
  const context = parseGlobals(process.argv.slice(2));
  let command = context.args.shift();
  if (!command) return printHelp();
  if (["help", "--help", "-h"].includes(command)) return printHelp();
  if (["version", "--version", "-v"].includes(command)) return void console.log(PRODUCT_VERSION);
  if (command === "mcp") {
    if (hasHelpFlag(context.args)) return printSubcommandHelp("mcp", false);
    assertNoArgs(context.args, "mcp");
    return runMcpServer(context.root);
  }
  const internal = command === "__internal";
  if (internal) {
    command = context.args.shift();
    if (!command) throw new EmpiricalError("INVALID_ARGUMENT", "The private automation namespace requires an operation");
    if (hasHelpFlag(context.args)) return printSubcommandHelp(command, true);
  } else if (command !== "install" && command !== "update" && command !== "uninstall") {
    throw new EmpiricalError(
      "UNKNOWN_COMMAND",
      `Unknown public command '${command}'. Use empirical install, empirical update, or empirical uninstall; repository workflows run inside the installed agent skills.`,
    );
  } else if (hasHelpFlag(context.args)) {
    return printSubcommandHelp(command, false);
  }

  switch (command) {
    case "install": {
      const all = takeFlag(context.args, "--all");
      const yes = takeFlag(context.args, "--yes") || takeFlag(context.args, "-y");
      const requested = takeOptions(context.args, ["--agent", "-a"]);
      if ([all, yes, requested.length > 0].filter(Boolean).length > 1) {
        throw new EmpiricalError("INVALID_ARGUMENT", "Choose only one of --agent, --all, or --yes");
      }
      assertNoArgs(context.args, "install");
      const home = homedir();
      const detectedIds = new Set(await detectAgentSkillTargets({ homeRoot: home }));
      const rememberedIds = new Set(await managedGlobalAgentIds(home));
      const installedIds = new Set(await installedGlobalAgentIds(home));
      let agents: AgentSkillTargetId[];
      if (requested.length > 0) {
        agents = resolveCliAgentIds(requested);
      } else if (all) {
        agents = globalAgentSkillTargets().map((agent) => agent.id);
      } else if (yes) {
        agents = globalAgentSkillTargets()
          .filter((agent) => detectedIds.has(agent.id) || rememberedIds.has(agent.id))
          .map((agent) => agent.id);
        if (agents.length === 0) {
          throw new EmpiricalError("AGENT_SELECTION_REQUIRED", "No detected or previously installed agents. Use empirical install --agent <name> or --all.");
        }
      } else {
        if (context.json || !process.stdin.isTTY || !process.stdout.isTTY) {
          throw new EmpiricalError(
            "AGENT_SELECTION_REQUIRED",
            "Interactive selection requires a terminal. Use --agent <name> (repeatable), --all, or --yes.",
          );
        }
        const items: AgentSelectorItem[] = globalAgentSkillTargets().map((agent) => ({
          id: agent.id,
          label: agent.label,
          aliases: (agent as AgentSkillTargetDefinition).aliases ?? [],
          destination: agent.globalSkillPath,
          detected: detectedIds.has(agent.id),
          managed: installedIds.has(agent.id),
          remembered: rememberedIds.has(agent.id),
        }));
        try {
          agents = await selectAgentsInteractive(items, globalAgentSkillTargets()
            .filter((agent) => detectedIds.has(agent.id) || rememberedIds.has(agent.id))
            .map((agent) => agent.id));
        } catch (error) {
          throw new EmpiricalError("INSTALL_CANCELLED", asErrorMessage(error));
        }
      }
      const report = await installGlobalAgentSkills(home, { agents });
      emit(report, context.json, () => renderIntegrationReport(
        `Empirical reconciled ${agents.length} selected agent${agents.length === 1 ? "" : "s"} (${report.created.length} created, ${report.updated.length} updated, ${report.removed.length} removed, ${report.preserved.length} preserved).`,
        report,
      ));
      return;
    }
    case "uninstall": {
      const yesLong = takeFlag(context.args, "--yes");
      const yesShort = takeFlag(context.args, "-y");
      const yes = yesLong || yesShort;
      assertNoArgs(context.args, "uninstall");
      if (!yes) {
        if (context.json || !(process.stdin.isTTY && process.stdout.isTTY)) {
          throw new EmpiricalError(
            "UNINSTALL_CONFIRMATION_REQUIRED",
            "Uninstall requires explicit confirmation outside an interactive terminal. Re-run with --yes; project .empirical history and repository integrations will remain preserved.",
          );
        }
        if (!(await approveUninstall())) {
          console.log("Empirical uninstall cancelled. Nothing changed.");
          return;
        }
      }
      const integrations = await uninstallGlobalAgentSkills(homedir());
      const lifecycle = uninstallEmpirical(context.json ? runLifecycleQuietly : undefined);
      const report: UninstallReport = {
        ...lifecycle,
        integrations,
        preserved: {
          projectHistory: true,
          repositoryIntegrations: true,
        },
      };
      emit(report, context.json, renderUninstallReport);
      return;
    }
    case "init": {
      const profile = readProfile(context.args);
      const integrations = !takeFlag(context.args, "--no-integrations");
      const defaults = takeFlag(context.args, "--defaults");
      const forceInteractive = takeFlag(context.args, "--interactive");
      const trackerInputPath = takeOption(context.args, "--tracker-input");
      if (forceInteractive && (defaults || context.json)) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--interactive cannot be combined with --defaults or --json");
      }
      const configuration = readConfigurationFlags(context.args);
      if (forceInteractive && configuration.explicit) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--interactive cannot be combined with configuration flags");
      }
      if (forceInteractive && trackerInputPath) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--interactive cannot be combined with --tracker-input");
      }
      if (defaults && configuration.explicit) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--defaults cannot be combined with configuration flags");
      }
      assertNoArgs(context.args, "init");
      const existingConfiguration = await readFile(
        join(context.root, ".empirical", "config.json"),
        "utf8",
      ).then(() => true, () => false);
      const trackerInput = trackerInputPath
        ? parseTrackerSetupChange(await readJsonPath<unknown>(trackerInputPath, "init tracker"))
        : undefined;
      const trackerSetup = await loadTrackerSetupState(context.root);
      const interactive = !context.json
        && !defaults
        && !configuration.explicit
        && !trackerInput
        && (forceInteractive || Boolean(process.stdin.isTTY && process.stdout.isTTY));
      const chosenSetup = interactive
        ? await interactiveConfiguration(
          context.root,
          existingConfiguration ? await new ProjectStore(context.root).loadConfig() : null,
          trackerSetup,
        )
        : {
            configuration: defaults ? defaultConfiguration() : configuration.input,
            tracker: trackerInput ?? (trackerSetup.mode === "unconfigured"
              ? { mode: "disabled" as const }
              : { mode: "preserve" as const }),
          };
      const initialized = await EmpiricalProject.initialize(context.root, {
        ...(profile ? { profile } : {}),
        integrations,
        ...chosenSetup.configuration,
        ...(chosenSetup.tracker ? { tracker: chosenSetup.tracker } : {}),
        setupComplete: true,
      });
      const config = await initialized.project.config();
      const effectiveTrackerSetup = await loadTrackerSetupState(context.root);
      emit(
        { state: initialized.state, config, integrations: initialized.integrations, next: await initialized.project.next() },
        context.json,
        () => renderIntegrationReport(`Empirical ${PRODUCT_VERSION} is ready in ${initialized.project.store.root}.`, initialized.integrations)
          + `\n\n${renderSetupSummary(setupSettingsFromConfig(config), { current: true, trackerSetup: effectiveTrackerSetup })}`,
      );
      return;
    }
    case "config":
    case "configure": {
      const defaults = takeFlag(context.args, "--defaults");
      const forceInteractive = takeFlag(context.args, "--interactive");
      if (forceInteractive && (defaults || context.json)) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--interactive cannot be combined with --defaults or --json");
      }
      const configuration = readConfigurationFlags(context.args);
      if (forceInteractive && configuration.explicit) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--interactive cannot be combined with configuration flags");
      }
      if (defaults && configuration.explicit) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--defaults cannot be combined with configuration flags");
      }
      assertNoArgs(context.args, "config");
      const project = await EmpiricalProject.open(context.root);
      const current = await project.config();
      const setup = defaults
        ? { configuration: defaultConfiguration(), tracker: undefined }
        : configuration.explicit
            ? { configuration: { ...configuration.input, setupComplete: true }, tracker: undefined }
          : (forceInteractive || Boolean(process.stdin.isTTY && process.stdout.isTTY)) && !context.json
            ? await interactiveConfiguration(project.store.root, current, await loadTrackerSetupState(project.store.root))
            : (() => { throw new EmpiricalError("CONFIG_REQUIRED", "Use configuration flags, --defaults, or an interactive terminal"); })();
      if (setup.tracker?.mode === "apply") await project.previewTracker(setup.tracker.policy);
      const config = await project.configure(setup.configuration);
      if (setup.tracker && setup.tracker.mode !== "preserve") {
        await project.configureTracker(setup.tracker.mode === "disabled" ? null : setup.tracker.policy);
      }
      emit(config, context.json, renderConfig);
      return;
    }
    case "adopt": {
      const profile = readProfile(context.args);
      const integrations = !takeFlag(context.args, "--no-integrations");
      const defaults = takeFlag(context.args, "--defaults");
      const configuration = readConfigurationFlags(context.args);
      assertNoArgs(context.args, "adopt");
      const result = await EmpiricalProject.adopt(context.root, {
        ...(profile ? { profile } : {}),
        integrations,
        ...configuration.input,
        setupComplete: defaults || configuration.explicit,
      });
      emit(
        { state: result.state, integrations: result.integrations, next: await result.project.next() },
        context.json,
        () => renderIntegrationReport("Empirical v1 was adopted without deleting ai/. The source of truth is now .empirical/.", result.integrations),
      );
      return;
    }
    case "explore": {
      if (takeFlag(context.args, "--help") || takeFlag(context.args, "-h")) return printExploreHelp();
      const forceInteractive = takeFlag(context.args, "--interactive");
      const noInterview = takeFlag(context.args, "--no-interview");
      const agentOption = takeOption(context.args, "--agent");
      if (forceInteractive && (context.json || noInterview)) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--interactive cannot be combined with --json or --no-interview");
      }
      if (agentOption && agentOption !== "codex" && agentOption !== "none") {
        throw new EmpiricalError("INVALID_ARGUMENT", "--agent must be codex or none");
      }
      if (agentOption && (context.json || noInterview)) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--agent is available only with the Socratic interview");
      }
      const request = takeOption(context.args, "--request") ?? context.args.join(" ");
      const project = await EmpiricalProject.openReadOnly(context.root);
      const packet = await project.explore(request);
      const interactive = forceInteractive || Boolean(agentOption)
        || (!context.json && !noInterview && Boolean(process.stdin.isTTY && process.stdout.isTTY));
      if (interactive) return runSocraticInterview(project, packet, agentOption as "codex" | "none" | undefined);
      emit(packet, context.json, renderExplore);
      return;
    }
    case "discovery": {
      const inputPath = takeOption(context.args, "--input");
      if (!inputPath) {
        throw new EmpiricalError(
          "INVALID_ARGUMENT",
          "empirical __internal discovery requires --input <json-file|->",
        );
      }
      assertNoArgs(context.args, "discovery");
      const text = inputPath === "-" ? await readStdin() : await readFile(inputPath, "utf8");
      let input: DiscoverySubmission;
      try {
        input = JSON.parse(text) as DiscoverySubmission;
      } catch (error) {
        throw new EmpiricalError(
          "INVALID_DISCOVERY",
          `Discovery input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const project = await EmpiricalProject.open(context.root);
      emit(await project.discovery(input), context.json, renderDiscoverySubmission);
      return;
    }
    case "fast":
    case "complex": {
      const id = takeOption(context.args, "--id");
      const request = takeOption(context.args, "--request") ?? context.args.join(" ");
      const project = await EmpiricalProject.open(context.root);
      const result = command === "fast"
        ? await project.fast(request, { ...(id ? { id } : {}) })
        : await project.complex(request, { ...(id ? { id } : {}) });
      await emitStart(project, result, context.json);
      return;
    }
    case "route": {
      const mode = takeOption(context.args, "--mode") ?? "normal";
      if (mode !== "normal" && mode !== "yolo") {
        throw new EmpiricalError("INVALID_ARGUMENT", "--mode must be normal or yolo");
      }
      const requestedProfile = readProfile(context.args);
      const declaredContractNeutral = takeFlag(context.args, "--contract-neutral");
      const request = takeOption(context.args, "--request") ?? context.args.join(" ");
      context.args.splice(0);
      const project = await EmpiricalProject.openReadOnly(context.root);
      emit(project.route(request, {
        mode,
        ...(requestedProfile ? { requestedProfile } : {}),
        ...(declaredContractNeutral ? { declaredContractNeutral: true } : {}),
      }), context.json, (value) => JSON.stringify(value, null, 2));
      return;
    }
    case "yolo": {
      const id = takeOption(context.args, "--id");
      const ceiling = takeOption(context.args, "--ceiling") ?? "integrated";
      if (!["implemented", "verified", "integrated", "delivered"].includes(ceiling)) {
        throw new EmpiricalError(
          "INVALID_ARGUMENT",
          "--ceiling must be implemented, verified, integrated, or delivered; publication is separate",
        );
      }
      const targetBranch = takeOption(context.args, "--target-branch");
      const allowExternalAgent = takeFlag(context.args, "--allow-external-agent");
      const request = takeOption(context.args, "--request") ?? context.args.join(" ");
      context.args.splice(0);
      const project = await EmpiricalProject.open(context.root);
      await emitStart(project, await project.yolo(request, {
        ...(id ? { id } : {}),
        ceiling: ceiling as "implemented" | "verified" | "integrated" | "delivered",
        ...(targetBranch ? { targetBranch } : {}),
        ...(allowExternalAgent ? { allowExternalAgent: true } : {}),
      }), context.json);
      return;
    }
    case "start": {
      const profile = readProfile(context.args);
      const id = takeOption(context.args, "--id");
      const request = takeOption(context.args, "--request") ?? context.args.join(" ");
      const project = await EmpiricalProject.open(context.root);
      await emitStart(project, await project.start(request, {
        ...(profile ? { profile } : {}),
        ...(id ? { id } : {}),
      }), context.json);
      return;
    }
    case "worktree-propose": {
      const workflow = (takeOption(context.args, "--workflow") ?? "complex") as Workflow;
      if (workflow !== "fast" && workflow !== "complex") {
        throw new EmpiricalError("INVALID_PROFILE", "--workflow must be fast or complex");
      }
      const changeType = takeOption(context.args, "--type") as "feature" | "fix" | "chore" | undefined;
      if (changeType && !["feature", "fix", "chore"].includes(changeType)) {
        throw new EmpiricalError("INVALID_ARGUMENT", "--type must be feature, fix, or chore");
      }
      const feature = takeOption(context.args, "--id");
      const branch = takeOption(context.args, "--branch");
      const path = takeOption(context.args, "--path");
      const base = takeOption(context.args, "--base");
      const request = takeOption(context.args, "--request") ?? context.args.join(" ");
      context.args.splice(0);
      const project = await EmpiricalProject.openReadOnly(context.root);
      const proposal = await project.proposeWorktree(request, workflow, {
        ...(changeType ? { changeType } : {}),
        ...(feature ? { feature } : {}),
        ...(branch ? { branch } : {}),
        ...(path ? { path } : {}),
        ...(base ? { base } : {}),
      });
      emit(proposal, context.json, renderProposal);
      return;
    }
    case "worktree-create": {
      const input = await readJsonInput<import("./types.js").WorktreeCreateInput>(context.args, "worktree-create");
      const project = await EmpiricalProject.openReadOnly(context.root);
      emit(await project.createWorktree(input), context.json, renderHandoff);
      return;
    }
    case "worktree": {
      const operation = context.args.shift();
      if (operation !== "create") {
        throw new EmpiricalError("INVALID_ARGUMENT", "Use empirical __internal worktree create \"<request>\"");
      }
      const yes = takeFlag(context.args, "--yes");
      const workflow = (takeOption(context.args, "--workflow") ?? "complex") as Workflow;
      if (workflow !== "fast" && workflow !== "complex") throw new EmpiricalError("INVALID_PROFILE", "--workflow must be fast or complex");
      const changeType = takeOption(context.args, "--type") as "feature" | "fix" | "chore" | undefined;
      if (changeType && !["feature", "fix", "chore"].includes(changeType)) throw new EmpiricalError("INVALID_ARGUMENT", "--type must be feature, fix, or chore");
      const feature = takeOption(context.args, "--id");
      const branch = takeOption(context.args, "--branch");
      const path = takeOption(context.args, "--path");
      const base = takeOption(context.args, "--base");
      const request = takeOption(context.args, "--request") ?? context.args.join(" ");
      const project = await EmpiricalProject.openReadOnly(context.root);
      const proposal = await project.proposeWorktree(request, workflow, {
        ...(changeType ? { changeType } : {}),
        ...(feature ? { feature } : {}),
        ...(branch ? { branch } : {}),
        ...(path ? { path } : {}),
        ...(base ? { base } : {}),
      });
      if (!yes) {
        if (context.json || !(process.stdin.isTTY && process.stdout.isTTY)) {
          emit(proposal, context.json, renderProposal);
          if (!context.json) process.exitCode = 2;
          return;
        }
        if (!(await approveProposal(proposal))) {
          console.log("No worktree was created.");
          return;
        }
      }
      const handoff = await project.createWorktree({
        request: proposal.request,
        workflow: proposal.workflow,
        changeType: proposal.changeType,
        feature: proposal.feature,
        branch: proposal.branch,
        path: proposal.path,
        base: proposal.base,
        baseCommit: proposal.baseCommit,
        activeFeature: proposal.activeFeature,
        approvalToken: proposal.approvalToken,
        approved: true,
      });
      emit(handoff, context.json, renderHandoff);
      return;
    }
    case "loop": {
      assertNoArgs(context.args, "loop");
      const project = await EmpiricalProject.openReadOnly(context.root);
      emit(await project.loop(), context.json, renderLoopAction);
      return;
    }
    case "status": {
      assertNoArgs(context.args, "status");
      const project = await EmpiricalProject.openReadOnly(context.root);
      const state = await project.statusReport();
      emit(state, context.json, renderStatus);
      return;
    }
    case "next": {
      assertNoArgs(context.args, "next");
      const project = await EmpiricalProject.openReadOnly(context.root);
      emit(await project.next(), context.json, renderAction);
      return;
    }
    case "explain": {
      assertNoArgs(context.args, "explain");
      const project = await EmpiricalProject.openReadOnly(context.root);
      emit(await project.explain(), context.json, renderExplain);
      return;
    }
    case "consult": {
      assertNoArgs(context.args, "consult");
      const project = await EmpiricalProject.openReadOnly(context.root);
      emit(await project.consult(), context.json, renderConsult);
      return;
    }
    case "tracker-discover": {
      const input = parseTrackerDiscoveryInput(
        await readJsonInput<unknown>(context.args, "tracker-discover"),
      );
      emit(
        await discoverTracker(input, { repositoryRoot: context.root }),
        context.json,
        (value) => renderTrackerDiscovery(value, input),
      );
      return;
    }
    case "tracker-preview": {
      const policy = await readJsonInput<unknown>(context.args, "tracker-preview");
      emit(await previewTrackerPolicy(policy, { repositoryRoot: context.root }), context.json, renderTrackerPreview);
      return;
    }
    case "tracker-suggest": {
      const input = await readJsonInput<unknown>(context.args, "tracker-suggest");
      emit(await proposeTrackerStateMapping(input, { repositoryRoot: context.root }), context.json, (value) =>
        renderTrackerMapping(value as import("./types.js").TrackerMappingSuggestion));
      return;
    }
    case "tracker-configure": {
      const policy = await readJsonInput<unknown>(context.args, "tracker-configure");
      const project = await EmpiricalProject.open(context.root);
      emit(await project.configureTracker(policy), context.json, (value) => value === null
        ? "External ticket tracking is disabled; Empirical remains local-only."
        : `External ticket tracking is configured for ${(value as { provider: string }).provider}.`);
      return;
    }
    case "tracker-bind": {
      const input = parseTrackerBindInput(await readJsonInput<unknown>(context.args, "tracker-bind"));
      const project = await EmpiricalProject.open(context.root);
      emit(await project.bindTracker(input), context.json, (value) => {
        const result = value as import("./types.js").TrackerBindResult;
        return renderTrackerStatus(result.tracker);
      });
      return;
    }
    case "tracker-sync": {
      assertNoArgs(context.args, "tracker-sync");
      const project = await EmpiricalProject.open(context.root);
      emit(await project.syncTracker(), context.json, (value) => {
        const result = value as import("./types.js").TrackerSyncResult;
        return renderTrackerStatus(result.tracker);
      });
      return;
    }
    case "complete": {
      if (takeFlag(context.args, "--help") || takeFlag(context.args, "-h")) return printCompleteHelp();
      const project = await EmpiricalProject.open(context.root);
      emit(await project.complete(await completionInput(context.args)), context.json, renderAction);
      return;
    }
    case "archive": {
      const revision = requiredInteger(context.args, "--revision");
      const actor = takeOption(context.args, "--actor") ?? "agent";
      assertNoArgs(context.args, "archive");
      const project = await EmpiricalProject.open(context.root);
      const result = await project.archive(revision, actor);
      emit(result, context.json, () => result.report.converged
        ? `${result.report.feature} was already archived.`
        : `Archived ${result.report.feature}: ${result.report.added} added, ${result.report.modified} modified, ${result.report.removed} removed.`);
      return;
    }
    case "evidence-execute": {
      const input = await readJsonInput<{
        commandId: string;
        criteria: string[];
        evidenceKinds?: Array<"test" | "browser" | "screenshot" | "review" | "human">;
        summary: string;
      }>(context.args, "evidence-execute");
      const project = await EmpiricalProject.open(context.root);
      emit(await project.executeEvidence(input), context.json, (value) => JSON.stringify(value, null, 2));
      return;
    }
    case "evidence-collect": {
      const input = await readJsonInput<{
        criteria: string[];
        evidenceKinds: Array<"test" | "browser" | "screenshot" | "review" | "human">;
        summary: string;
        collector: string;
        artifacts: Array<{ path: string; mediaType: string }>;
      }>(context.args, "evidence-collect");
      const project = await EmpiricalProject.open(context.root);
      emit(await project.collectEvidence(input), context.json, (value) => JSON.stringify(value, null, 2));
      return;
    }
    case "verify": {
      assertNoArgs(context.args, "verify");
      const project = await EmpiricalProject.openReadOnly(context.root);
      const report = await project.verify();
      emit(report, context.json, () => report.valid
        ? `Evidence is complete for ${report.criteria} acceptance criteria.`
        : `Evidence is incomplete: ${report.missing.join("; ")}`);
      if (!report.valid) process.exitCode = 2;
      return;
    }
    case "retry": {
      const revision = requiredInteger(context.args, "--revision");
      const actor = takeOption(context.args, "--actor") ?? "human";
      assertNoArgs(context.args, "retry");
      const project = await EmpiricalProject.open(context.root);
      emit(await project.retry(revision, actor), context.json, renderAction);
      return;
    }
    case "integrate": {
      const revision = requiredInteger(context.args, "--revision");
      const targetRoot = takeOption(context.args, "--target-root");
      if (!targetRoot) throw new EmpiricalError("INVALID_ARGUMENT", "integrate requires --target-root");
      const actor = takeOption(context.args, "--actor") ?? "agent";
      assertNoArgs(context.args, "integrate");
      const project = await EmpiricalProject.open(context.root);
      const result = await project.integrate(revision, targetRoot, actor);
      emit(result, context.json, () => `Integrated ${result.report.feature}: ${result.report.added} added, ${result.report.modified} modified, ${result.report.removed} removed.`);
      return;
    }
    case "deliver": {
      const input = await readJsonInput<import("./types.js").DeliveryInput>(context.args, "deliver");
      const project = await EmpiricalProject.open(context.root);
      emit(await project.deliver(input), context.json, (value) => JSON.stringify(value, null, 2));
      return;
    }
    case "publish": {
      const input = await readJsonInput<{
        revision: number;
        authorization: unknown;
        feature: string;
        packageName: string;
        version: string;
        distTag: string;
        commit: string;
        approved: true;
        actor?: string;
      }>(context.args, "publish");
      if (input.approved !== true) {
        throw new EmpiricalError(
          "PUBLICATION_AUTHORIZATION_REQUIRED",
          "Publication input requires approved: true and an exact version",
        );
      }
      const project = await EmpiricalProject.open(context.root, { feature: input.feature });
      const result = await project.publish({
        revision: input.revision,
        authorization: authorizationSchema.parse(input.authorization),
        packageName: input.packageName,
        version: input.version,
        distTag: input.distTag,
        commit: input.commit,
        approved: true,
        ...(input.actor ? { actor: input.actor } : {}),
      });
      emit(result, context.json, (value) => JSON.stringify(value, null, 2));
      return;
    }
    case "integrations": {
      const global = takeFlag(context.args, "--global");
      const all = takeFlag(context.args, "--all");
      assertNoArgs(context.args, "integrations");
      if (global) {
        const report = await installGlobalAgentSkills(homedir(), { all });
        emit(report, context.json, () => renderIntegrationReport(
          `Empirical install compatibility alias completed (${report.created.length} created, ${report.updated.length} updated, ${report.removed.length} obsolete removed, ${report.preserved.length} preserved).`, report));
      } else {
        if (all) throw new EmpiricalError("INVALID_ARGUMENT", "--all requires --global");
        const project = await EmpiricalProject.open(context.root);
        const report = await project.integrations();
        emit(report, context.json, () => renderIntegrationReport(
          `Project runtime integration reconciled (${report.created.length} created, ${report.updated.length} updated, ${report.removed.length} obsolete removed, ${report.preserved.length} preserved).`, report));
      }
      return;
    }
    case "doctor": {
      assertNoArgs(context.args, "doctor");
      const project = await EmpiricalProject.openReadOnly(context.root);
      emit(await project.doctor(), context.json, () => "Empirical is healthy: CLI, MCP, Git isolation, and feature-local state are available.");
      return;
    }
    case "migrate": {
      assertNoArgs(context.args, "migrate");
      const project = await EmpiricalProject.open(context.root, { migrate: false });
      const migration = await project.migrate();
      emit(migration, context.json, () => `Project schema is current (${String(migration.schemaVersion)}).`);
      return;
    }
    case "capabilities": {
      const project = await EmpiricalProject.openReadOnly(context.root);
      const name = context.args.shift();
      assertNoArgs(context.args, "capabilities");
      if (name) {
        const contents = await project.capability(name);
        if (contents === null) throw new EmpiricalError("CAPABILITY_NOT_FOUND", `Unknown capability '${name}'`);
        emit({ name, contents }, context.json, () => contents);
      } else {
        const capabilities = await project.capabilities();
        emit(capabilities, context.json, () => capabilities.length === 0
          ? "No living capability specifications yet."
          : capabilities.map((item) => `${item.name}: ${item.requirements} requirements (${item.path})`).join("\n"));
      }
      return;
    }
    case "policy": {
      const inputPath = takeOption(context.args, "--input");
      assertNoArgs(context.args, "policy");
      const project = inputPath
        ? await EmpiricalProject.open(context.root)
        : await EmpiricalProject.openReadOnly(context.root);
      const policy = inputPath
        ? await project.configurePolicy(JSON.parse(inputPath === "-" ? await readStdin() : await readFile(inputPath, "utf8")) as unknown)
        : await project.policy();
      emit(policy, context.json, () => `Project policy: ${policy.context.length} context entries, ${Object.keys(policy.phases).length} customized phases (${project.store.policyPath}).`);
      return;
    }
    case "context": {
      assertNoArgs(context.args, "context");
      const project = await EmpiricalProject.open(context.root);
      const report = await project.context();
      emit(report, context.json, () => [
        `Repository knowledge ${report.status}: ${report.files} files, digest ${report.digest}.`,
        ...report.context,
        ...(report.refinementRequired.length > 0
          ? [`Refinement required:\n${report.refinementRequired.join("\n")}`]
          : []),
      ].join("\n"));
      return;
    }
    case "handoff": {
      const agent = takeOption(context.args, "--agent") as AgentIntegrationId | undefined;
      const approvalToken = takeOption(context.args, "--approval-token");
      const approved = takeFlag(context.args, "--yes");
      assertNoArgs(context.args, "handoff");
      const project = await EmpiricalProject.openReadOnly(context.root);
      if (!agent) {
        if (approvalToken || approved) throw new EmpiricalError("INVALID_ARGUMENT", "--approval-token and --yes require --agent");
        return emit(await project.handoff(), context.json, renderAgentHandoffOffer);
      }
      if (!["codex", "claude", "cursor", "gemini", "windsurf"].includes(agent)) {
        throw new EmpiricalError("INVALID_ARGUMENT", `Unsupported agent '${agent}'`);
      }
      if (!approvalToken) throw new EmpiricalError("INVALID_ARGUMENT", "--agent requires --approval-token from the displayed proposal");
      emit(await project.authorizeHandoff(agent, approvalToken, approved), context.json, renderAuthorizedHandoff);
      return;
    }
    case "update": {
      if (takeFlag(context.args, "--check")) {
        assertNoArgs(context.args, "update");
        console.log(`Installed ${PRODUCT_VERSION}. Check npm with: npm view empirical-sdd version`);
        return;
      }
      assertNoArgs(context.args, "update");
      const report = updateEmpirical();
      emit(report, context.json, () => "Empirical package updated and the managed agent skills were refreshed.");
      return;
    }
    default:
      throw new EmpiricalError("UNKNOWN_COMMAND", `Unknown command '${command}'. Run empirical help.`);
  }
}

class InterviewQuit extends Error {}

class LinePrompter {
  private readonly readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    crlfDelay: Infinity,
  });
  private readonly lines = this.readline[Symbol.asyncIterator]();

  async ask(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    const next = await this.lines.next();
    if (next.done) throw new InterviewQuit("Input closed");
    return next.value.trim();
  }

  close(): void { this.readline.close(); }
}

interface InteractiveSetupChoice {
  configuration: ProjectConfigurationInput;
  tracker: TrackerSetupChange | undefined;
}

async function interactiveConfiguration(
  root: string,
  current: Awaited<ReturnType<EmpiricalProject["config"]>> | null,
  currentTrackerSetup: TrackerSetupState,
): Promise<InteractiveSetupChoice> {
  const prompt = new LinePrompter();
  let settings = current ? setupSettingsFromConfig(current) : recommendedSetupSettings();
  let resolvedBase: string | undefined;
  if (settings.isolation.baseBranch === "auto") {
    try { resolvedBase = detectBase(root); } catch { resolvedBase = undefined; }
  }
  console.log(`\n${renderSetupSummary(settings, {
    current: Boolean(current),
    ...(resolvedBase ? { resolvedBase } : {}),
    trackerSetup: currentTrackerSetup,
  })}`);
  try {
    const primary = current ? "keep" : "apply";
    console.log("\n◇ Use these settings?");
    console.log(`│  ● ${current ? "Keep current settings" : "Apply recommended settings"} (default)`);
    console.log("│  ○ Customize");
    console.log("│  ○ Configure tracker");
    console.log("│  ○ Cancel");
    const firstChoice = await askEnumDefault(
      prompt,
      `Choice [${primary}]: `,
      primary,
      new Set([primary, current ? "k" : "a", "customize", "c", "tracker", "t", "cancel", "x", "q"]),
    );
    if (["cancel", "x", "q"].includes(firstChoice)) throw setupCancelled();
    if (firstChoice === primary || firstChoice === (current ? "k" : "a")) {
      if (currentTrackerSetup.mode !== "unconfigured") {
        return { configuration: setupConfigurationInput(settings), tracker: { mode: "preserve" } };
      }
      const tracker = await interactiveTrackerSetup(prompt, currentTrackerSetup, root);
      console.log(`\n${renderSetupSummary(settings, {
        current: false,
        effective: true,
        ...(resolvedBase ? { resolvedBase } : {}),
        trackerSetup: effectiveTrackerSetupState(currentTrackerSetup, tracker),
      })}`);
      await confirmSetupSave(prompt, "Save this complete setup?");
      return { configuration: setupConfigurationInput(settings), tracker };
    }
    if (firstChoice === "tracker" || firstChoice === "t") {
      const tracker = await interactiveTrackerSetup(prompt, currentTrackerSetup, root);
      console.log(`\n${renderSetupSummary(settings, {
        current: false,
        effective: true,
        ...(resolvedBase ? { resolvedBase } : {}),
        trackerSetup: effectiveTrackerSetupState(currentTrackerSetup, tracker),
      })}`);
      await confirmSetupSave(prompt, "Save this effective tracker setup?");
      return { configuration: setupConfigurationInput(settings), tracker };
    }

    let customizedTracker: TrackerSetupChange | undefined;
    while (true) {
      settings = await customizeSetup(prompt, settings);
      try {
        validateSetupSettings(settings);
      } catch (error) {
        console.log(`\n! ${asErrorMessage(error)}\nPlease review the setup sections again.`);
        continue;
      }
      if (!customizedTracker && currentTrackerSetup.mode === "unconfigured") {
        customizedTracker = await interactiveTrackerSetup(prompt, currentTrackerSetup, root);
      }
      const tracker = customizedTracker ?? { mode: "preserve" as const };
      console.log(`\n${renderSetupSummary(settings, {
        current: false,
        effective: true,
        ...(resolvedBase ? { resolvedBase } : {}),
        trackerSetup: effectiveTrackerSetupState(currentTrackerSetup, tracker),
      })}`);
      console.log("\n◇ Save these effective settings?");
      console.log("│  ● Save (default)");
      console.log("│  ○ Edit");
      console.log("│  ○ Cancel");
      const finalChoice = await askEnumDefault(
        prompt,
        "Choice [save]: ",
        "save",
        new Set(["save", "s", "edit", "e", "cancel", "x", "q"]),
      );
      if (finalChoice === "save" || finalChoice === "s") {
        return { configuration: setupConfigurationInput(settings), tracker };
      }
      if (["cancel", "x", "q"].includes(finalChoice)) throw setupCancelled();
    }
  } finally {
    prompt.close();
  }
}

async function interactiveTrackerSetup(
  prompt: LinePrompter,
  current: TrackerSetupState,
  root: string,
): Promise<TrackerSetupChange> {
  console.log("\n◆ Tracker · OAuth first; raw credentials stay outside Empirical, MCP, and chat.");
  let ticketPresetDefault = "features+large-fixes";
  let provider: string;
  if (current.mode === "unconfigured") {
    console.log("│  ● Track work by type (recommended default)");
    console.log("│  ○ No tracking");
    const choice = await askEnumDefault(
      prompt,
      "Tracker [track-work]: ",
      "track-work",
      new Set(["track-work", "track", "policy", "t", "track-all", "all", "no-tracking", "no", "none", "off", "local"]),
    );
    if (["no-tracking", "no", "none", "off", "local"].includes(choice)) return { mode: "disabled" };
    if (["track-all", "all"].includes(choice)) ticketPresetDefault = "all";
    console.log("│  Choose a provider: linear · github · jira");
    provider = await askEnumRequired(
      prompt,
      "Provider (linear/github/jira): ",
      new Set(["linear", "github", "jira"]),
    );
  } else {
    if (current.mode === "configured") console.log("│  preserve (default) · disable · track-work · linear · github · jira");
    else console.log("│  preserve (default) · track-work · linear · github · jira");
    provider = await askEnumDefault(
      prompt,
      "Tracker [preserve]: ",
      "preserve",
      new Set(["preserve", "p", "disable", "disabled", "off", "local", "track-work", "policy", "track-all", "track", "all", "t", "linear", "github", "jira"]),
    );
    if (provider === "preserve" || provider === "p") return { mode: "preserve" };
    if (["disable", "disabled", "off", "local"].includes(provider)) return { mode: "disabled" };
    if (["track-work", "policy", "track-all", "track", "all", "t"].includes(provider)) {
      if (["track-all", "all"].includes(provider)) ticketPresetDefault = "all";
      provider = await askEnumRequired(
        prompt,
        "Provider (linear/github/jira): ",
        new Set(["linear", "github", "jira"]),
      );
    }
  }

  let discovery: TrackerDiscovery;
  let credentialEnv: TrackerPolicy["credentialEnv"];
  let jiraSiteUrl: string | null = null;
  const authentication = trackerAuthenticationGuidance(
    provider as TrackerPolicy["provider"],
    { repositoryRoot: root },
  );
  console.log("\n◆ Authentication");
  console.log(`│  OAuth (preferred): connect ${provider} through the trusted host when available.`);
  console.log(`│  Host-only fallback file: ${authentication.secretFilePath}`);
  console.log(`│  Fallback variable names: ${authentication.credentialNames.join(", ")}`);
  console.log(`│  ${authentication.warning}.`);
  console.log("│  Edit the host file directly outside chat; never put a credential value in a command or prompt.");
  if (provider === "linear") {
    const defaults = defaultTrackerCredentialEnv("linear");
    const apiKey = await askDefault(prompt, `Linear fallback variable [${defaults.apiKey}]: `, defaults.apiKey);
    credentialEnv = { apiKey };
    discovery = await discoverTracker({ provider: "linear", credentialEnv }, { repositoryRoot: root });
  } else if (provider === "github") {
    const defaults = defaultTrackerCredentialEnv("github");
    const token = await askDefault(prompt, `GitHub fallback variable [${defaults.token}]: `, defaults.token);
    credentialEnv = { token };
    discovery = await discoverTracker({ provider: "github", credentialEnv }, { repositoryRoot: root });
  } else {
    const defaults = defaultTrackerCredentialEnv("jira");
    jiraSiteUrl = await askRequired(prompt, "Jira Cloud site URL (for example https://example.atlassian.net): ");
    const email = await askDefault(prompt, `Jira fallback email variable [${defaults.email}]: `, defaults.email);
    const apiToken = await askDefault(prompt, `Jira fallback API token variable [${defaults.apiToken}]: `, defaults.apiToken);
    credentialEnv = { email, apiToken };
    discovery = await discoverTracker(
      { provider: "jira", target: { siteUrl: jiraSiteUrl }, credentialEnv },
      { repositoryRoot: root },
    );
  }

  const policyTarget = await chooseTrackerTarget(prompt, discovery, jiraSiteUrl);
  const scoped = scopedTrackerDiscovery(discovery, policyTarget.stateParent);
  const suggested = suggestTrackerStateMapping(scoped);
  const states = await editTrackerMapping(prompt, scoped, suggested);
  const ticketSelection = await chooseTrackerTicketPolicy(prompt, ticketPresetDefault);
  const visibility = await askEnumDefault(
    prompt,
    "Progress visibility [milestones] (blockers-final/milestones/revisions): ",
    "milestones",
    new Set(["blockers-final", "milestones", "revisions"]),
  ) as "blockers-final" | "milestones" | "revisions";
  const policy: TrackerPolicy = provider === "linear"
    ? {
        schemaVersion: 2,
        provider: "linear",
        target: policyTarget.target as Extract<TrackerPolicy, { provider: "linear" }>["target"],
        credentialEnv: credentialEnv as Extract<TrackerPolicy, { provider: "linear" }>["credentialEnv"],
        states,
        ...ticketSelection,
        visibility,
      }
    : provider === "github"
      ? {
          schemaVersion: 2,
          provider: "github",
          target: policyTarget.target as Extract<TrackerPolicy, { provider: "github" }>["target"],
          credentialEnv: credentialEnv as Extract<TrackerPolicy, { provider: "github" }>["credentialEnv"],
          states,
          ...ticketSelection,
          visibility,
        }
      : {
          schemaVersion: 2,
          provider: "jira",
          target: policyTarget.target as Extract<TrackerPolicy, { provider: "jira" }>["target"],
          credentialEnv: credentialEnv as Extract<TrackerPolicy, { provider: "jira" }>["credentialEnv"],
          states,
          ...ticketSelection,
          visibility,
        };
  const preview = await previewTrackerPolicy(policy, { repositoryRoot: root });
  console.log("\n◆ Effective tracker configuration");
  console.log(`│  Provider: ${preview.policy.provider} · Policy v${preview.policy.schemaVersion}`);
  console.log(`│  Target: ${preview.target.map((entry) => `${entry.name} (${entry.kind})`).join(" → ")}`);
  console.log(`│  Ticket behavior: ${preview.effective.ticket}`);
  if (policy.schemaVersion === 2 && policy.ticketRules) {
    for (const line of renderTicketRuleLines(policy.ticketRules)) console.log(`│  ${line}`);
  }
  console.log(`│  Progress visibility: ${preview.effective.visibility}`);
  for (const phase of Object.keys(states) as Array<keyof TrackerStateMap>) {
    const resource = scoped.resources.find((entry) => entry.kind === "state" && entry.id === states[phase]);
    console.log(`│  ${phase}: ${resource?.name ?? states[phase]} (${states[phase]})`);
  }
  console.log("│  Authentication: trusted host OAuth preferred");
  console.log(`│  Fallback file: ${authentication.secretFilePath}`);
  console.log(`│  Credential source: ${Object.values(credentialEnv).join(", ")} (names only; values are never saved)`);
  console.log(`│  ${authentication.warning}.`);
  return { mode: "apply", policy };
}

async function chooseTrackerTicketPolicy(
  prompt: LinePrompter,
  fallback: string,
): Promise<{ ticket: "off" } | { ticket: "ensure"; ticketRules?: TrackerTicketRules }> {
  console.log("\n◆ Tickets · choose when a linked ticket is required");
  const preset = await askEnumDefault(
    prompt,
    `Tickets [${fallback}] (features+large-fixes/all/none/custom): `,
    fallback,
    new Set(["features+large-fixes", "recommended", "all", "none", "off", "custom"]),
  );
  if (preset === "none" || preset === "off") return { ticket: "off" };
  if (preset === "all") return { ticket: "ensure" };
  if (preset === "features+large-fixes" || preset === "recommended") {
    return { ticket: "ensure", ticketRules: recommendedTrackerTicketRules() };
  }
  const ticketRules = recommendedTrackerTicketRules();
  for (const changeType of ["feature", "fix", "chore"] as const) {
    for (const profile of ["fast", "quick", "complex"] as const) {
      const current = ticketRules[changeType][profile];
      ticketRules[changeType][profile] = await askEnumDefault(
        prompt,
        `${changeType}/${profile} [${current}] (required/optional/off): `,
        current,
        new Set(["required", "optional", "off"]),
      ) as TrackerTicketRequirement;
    }
  }
  return { ticket: "ensure", ticketRules };
}

async function chooseTrackerTarget(
  prompt: LinePrompter,
  discovery: TrackerDiscovery,
  jiraSiteUrl: string | null,
): Promise<{ target: TrackerPolicy["target"]; stateParent: string }> {
  if (discovery.provider === "linear") {
    const team = await chooseTrackerResource(prompt, "Linear team", discovery.resources.filter((resource) => resource.kind === "team"));
    const projects = discovery.resources.filter((resource) => resource.kind === "project" && resource.parentId === team.id);
    const project = projects.length
      ? await chooseTrackerResource(prompt, "Linear project (or none)", projects, true)
      : null;
    return { target: { teamId: team.id, projectId: project?.id ?? null }, stateParent: team.id };
  }
  if (discovery.provider === "github") {
    const owner = await chooseTrackerResource(prompt, "GitHub owner", discovery.resources.filter((resource) => resource.kind === "workspace"));
    const repository = await chooseTrackerResource(prompt, "GitHub repository", discovery.resources.filter((resource) => resource.kind === "repository" && resource.parentId === owner.id));
    const project = await chooseTrackerResource(prompt, "GitHub Project", discovery.resources.filter((resource) => resource.kind === "project" && resource.parentId === owner.id));
    const field = await chooseTrackerResource(prompt, "Status field", discovery.resources.filter((resource) => resource.kind === "field" && resource.parentId === project.id));
    const ownerName = owner.key ?? repository.key?.split("/")[0] ?? owner.name;
    return {
      target: { owner: ownerName, repository: repository.name, projectId: project.id, statusFieldId: field.id },
      stateParent: field.id,
    };
  }
  const project = await chooseTrackerResource(prompt, "Jira project", discovery.resources.filter((resource) => resource.kind === "project"));
  const issueType = await chooseTrackerResource(prompt, "Jira issue type", discovery.resources.filter((resource) => resource.kind === "issue-type" && resource.parentId === project.id));
  return {
    target: { siteUrl: jiraSiteUrl!, projectKey: project.key ?? project.id, issueTypeId: issueType.id },
    stateParent: project.id,
  };
}

function chooseTrackerResource(
  prompt: LinePrompter,
  label: string,
  resources: TrackerDiscoveryResource[],
  allowNone?: false,
): Promise<TrackerDiscoveryResource>;
function chooseTrackerResource(
  prompt: LinePrompter,
  label: string,
  resources: TrackerDiscoveryResource[],
  allowNone: true,
): Promise<TrackerDiscoveryResource | null>;
async function chooseTrackerResource(
  prompt: LinePrompter,
  label: string,
  resources: TrackerDiscoveryResource[],
  allowNone = false,
): Promise<TrackerDiscoveryResource | null> {
  if (resources.length === 0 && !allowNone) throw new EmpiricalError("TRACKER_TARGET_UNAVAILABLE", `Discovery returned no accessible ${label}`);
  console.log(`\n◇ ${label}`);
  if (allowNone) console.log("│  0. None");
  resources.forEach((resource, index) => console.log(`│  ${index + 1}. ${resource.name} · ${resource.id}`));
  while (true) {
    const fallback = allowNone ? "0" : resources.length === 1 ? "1" : "";
    const answer = await prompt.ask(`Choice${fallback ? ` [${fallback}]` : ""}: `) || fallback;
    if (allowNone && answer === "0") return null;
    if (/^\d+$/.test(answer)) {
      const selected = resources[Number(answer) - 1];
      if (selected) return selected;
    }
    console.log("! Choose one of the displayed numbers.");
  }
}

function scopedTrackerDiscovery(discovery: TrackerDiscovery, parentId: string): TrackerDiscovery {
  const resources = discovery.resources.filter((resource) => resource.kind === "state" && resource.parentId === parentId);
  const body = {
    schemaVersion: 1 as const,
    provider: discovery.provider,
    resources,
    capabilities: discovery.capabilities,
    complete: true as const,
  };
  return { ...body, digest: digestJson(body) };
}

async function editTrackerMapping(
  prompt: LinePrompter,
  discovery: TrackerDiscovery,
  suggestion: ReturnType<typeof suggestTrackerStateMapping>,
): Promise<TrackerStateMap> {
  const states = discovery.resources.filter((resource) => resource.kind === "state");
  const mapping = {} as TrackerStateMap;
  console.log("\n◆ Semantic state mapping · phases may share one provider state.");
  for (const phase of Object.keys(suggestion.phases) as Array<keyof TrackerStateMap>) {
    const proposed = suggestion.phases[phase];
    const defaultState = proposed.selectedStateId
      ? states.find((state) => state.id === proposed.selectedStateId) ?? null
      : null;
    console.log(`\n◇ ${phase}${proposed.ambiguous ? " · explicit choice required" : ""}`);
    states.forEach((state, index) => console.log(`│  ${index + 1}. ${state.name} · ${state.id}${state.id === defaultState?.id ? " · suggested" : ""}`));
    while (true) {
      const fallback = defaultState && !proposed.ambiguous ? String(states.indexOf(defaultState) + 1) : "";
      const answer = await prompt.ask(`Choice${fallback ? ` [${fallback}]` : ""}: `) || fallback;
      const selected = /^\d+$/.test(answer) ? states[Number(answer) - 1] : undefined;
      if (selected) {
        mapping[phase] = selected.id;
        break;
      }
      console.log("! Choose one displayed state; ambiguity is never guessed.");
    }
  }
  return mapping;
}

async function customizeSetup(prompt: LinePrompter, current: SetupSettings): Promise<SetupSettings> {
  console.log("\n◆ Verification policy · enter on or off; stored UI values remain when criterion evidence is off.");
  const required = await askOnOff(prompt, "Acceptance-test evidence", current.evidence.required);
  const browserForUi = await askOnOff(prompt, "Browser evidence for [UI]", current.evidence.browserForUi);
  const screenshotForUi = await askOnOff(prompt, "Screenshot artifacts for [UI]", current.evidence.screenshotForUi);
  const codeReview = await askOnOff(prompt, "Independent code-review evidence", current.evidence.codeReview);

  console.log("\n◆ Parallel work");
  const mode = await askEnumDefault(
    prompt,
    `Isolation when another feature is active [${current.isolation.mode}] (ask/off): `,
    current.isolation.mode,
    new Set(["ask", "off"]),
  ) as "ask" | "off";
  let { baseBranch, worktreePath, branchPattern } = current.isolation;
  if (mode === "ask") {
    baseBranch = await askDefault(prompt, `Default Git base [${baseBranch}]: `, baseBranch);
    worktreePath = await askDefault(prompt, `Sibling worktree path [${worktreePath}]: `, worktreePath);
    branchPattern = await askDefault(prompt, `Branch pattern [${branchPattern}]: `, branchPattern);
  } else {
    console.log("Worktree base and templates are inactive and will keep their stored values.");
  }

  console.log("\n◆ Decisions");
  const complexRecords = await askEnumDefault(
    prompt,
    `Complex decision records [${current.decisions.complexRecords}] (required/off): `,
    current.decisions.complexRecords,
    new Set(["required", "off"]),
  ) as "required" | "off";
  console.log("\n◆ Interaction");
  const questions = await askEnumDefault(
    prompt,
    `Questions [${current.interaction.questions}] (concise/detailed): `,
    current.interaction.questions,
    new Set(["concise", "detailed"]),
  ) as "concise" | "detailed";
  return {
    evidence: { required, browserForUi, screenshotForUi, codeReview },
    isolation: { mode, baseBranch, worktreePath, branchPattern },
    decisions: { complexRecords },
    interaction: { questions },
  };
}

async function askOnOff(prompt: LinePrompter, label: string, current: boolean): Promise<boolean> {
  const fallback = current ? "on" : "off";
  return await askEnumDefault(prompt, `${label} [${fallback}] (on/off): `, fallback, new Set(["on", "off"])) === "on";
}

async function askEnumDefault(
  prompt: LinePrompter,
  question: string,
  fallback: string,
  allowed: Set<string>,
): Promise<string> {
  while (true) {
    const answer = (await prompt.ask(question)).toLowerCase() || fallback;
    if (allowed.has(answer)) return answer;
    console.log(`! Choose one of: ${[...allowed].join(", ")}.`);
  }
}

async function askEnumRequired(
  prompt: LinePrompter,
  question: string,
  allowed: Set<string>,
): Promise<string> {
  while (true) {
    const answer = (await prompt.ask(question)).toLowerCase();
    if (allowed.has(answer)) return answer;
    console.log(`! Choose one of: ${[...allowed].join(", ")}.`);
  }
}

function effectiveTrackerSetupState(
  current: TrackerSetupState,
  change: TrackerSetupChange,
): TrackerSetupState {
  if (change.mode === "preserve") return current;
  if (change.mode === "disabled") return { mode: "disabled", policy: null };
  return { mode: "configured", policy: change.policy };
}

async function confirmSetupSave(prompt: LinePrompter, question: string): Promise<void> {
  console.log(`\n◇ ${question}`);
  console.log("│  ● Save (default)");
  console.log("│  ○ Cancel");
  const choice = await askEnumDefault(
    prompt,
    "Choice [save]: ",
    "save",
    new Set(["save", "s", "cancel", "x", "q"]),
  );
  if (["cancel", "x", "q"].includes(choice)) throw setupCancelled();
}

function setupCancelled(): EmpiricalError {
  return new EmpiricalError("SETUP_CANCELLED", "Empirical setup was cancelled before any repository changes were made");
}

async function runSocraticInterview(
  project: EmpiricalProject,
  packet: ExplorationPacket,
  agentOption?: "codex" | "none",
): Promise<void> {
  const prompt = new LinePrompter();
  let record = createDiscoveryRecord(packet.problem);
  let paths = await saveDiscovery(project.store.root, record);
  let launchCodex = false;
  console.log("Empirical Socratic Explore · five passes");
  console.log(`\nIdea: ${packet.problem}`);
  console.log("\nI will ask one question at a time, save every answer, show the refined brief, and wait for approval before starting work.");
  console.log("Do not enter secrets or credentials. Type :quit to save the draft and stop.\n");
  try {
    interview: while (true) {
      const answers: SocraticAnswer[] = [];
      for (let index = 0; index < 5; index += 1) {
        const prior = answers.map((answer) => `${answer.answer} ${answer.followUp?.answer ?? ""}`).join(" ");
        const question = socraticQuestions(packet.problem, prior)[index]!;
        console.log(`Pass ${index + 1}/5 · ${question.title}`);
        const answer = await askRequired(prompt, `${question.question}\n> `);
        const entry: SocraticAnswer = { ...question, answer, followUp: null };
        answers.push(entry);
        record = touchDiscovery(record, { answers: [...answers] });
        paths = await saveDiscovery(project.store.root, record);
        const followUp = materialFollowUp(packet.problem, question, answer);
        if (followUp) {
          console.log("\nOne material follow-up:");
          entry.followUp = { question: followUp, answer: await askRequired(prompt, `${followUp}\n> `) };
          record = touchDiscovery(record, { answers: [...answers] });
          paths = await saveDiscovery(project.store.root, record);
        }
        console.log("");
      }
      const refinedRequest = buildRefinedRequest(packet.problem, answers);
      record = touchDiscovery(record, { answers, refinedRequest });
      paths = await saveDiscovery(project.store.root, record);
      console.log(`Refined request\n---------------\n${refinedRequest}\n\nDraft saved: ${paths.markdown}`);
      const approval = await askChoice(prompt, "\n[A] Approve  [R] Restart  [S] Save only\nChoose (default S): ", new Set(["a", "approve", "y", "yes", "r", "restart", "s", "save", ""]));
      if (approval === "r" || approval === "restart") {
        record = touchDiscovery(record, { status: "draft", answers: [], refinedRequest: null, approvedAt: null, workflow: null, handoff: null });
        paths = await saveDiscovery(project.store.root, record);
        continue interview;
      }
      if (!["a", "approve", "y", "yes"].includes(approval)) {
        console.log(`\nNo workflow was started. Draft saved at ${paths.markdown}.`);
        return;
      }
      record = touchDiscovery(record, { status: "approved", approvedAt: new Date().toISOString() });
      paths = await saveDiscovery(project.store.root, record);
      const recommended = recommendWorkflow(packet.problem, answers);
      const choice = await askChoice(prompt, `[C] Complex  [F] Fast  [S] Save approved only\nChoose (recommended ${recommended}): `, new Set(["c", "complex", "f", "fast", "s", "save", ""]));
      if (choice === "s" || choice === "save") return void console.log("\nThe approved brief was saved without starting workflow state.");
      let workflow: DiscoveryWorkflow = choice === "f" || choice === "fast" ? "fast" : choice === "c" || choice === "complex" ? "complex" : recommended;
      if (workflow === "fast" && recommended === "complex" && await prompt.ask("Type FAST to override the Complex recommendation: ") !== "FAST") workflow = "complex";
      let result = workflow === "fast" ? await project.fast(refinedRequest) : await project.complex(refinedRequest);
      let action: ActionPacket;
      if (result.kind === "worktree_proposal") {
        console.log(`\n${renderProposal(result)}`);
        const approve = await prompt.ask("Create this worktree now? [y/N]: ");
        if (!/^(y|yes)$/i.test(approve)) return void console.log("\nApproved discovery saved; no worktree or workflow was created.");
        const handoff = await createFromProposal(project, result);
        console.log(`\n${renderHandoff(handoff)}`);
        action = handoff.action;
      } else action = result;
      record = touchDiscovery(record, { status: "started", workflow, handoff: { feature: action.feature ?? "unknown", revision: action.revision } });
      paths = await saveDiscovery(project.store.root, record);
      console.log(`\n${renderAction(action)}\n\nDiscovery handoff recorded: ${paths.markdown}`);
      if (agentOption === "codex") launchCodex = true;
      else if (agentOption !== "none") launchCodex = /^(y|yes)$/i.test(await prompt.ask("\nLaunch Codex now? [y/N]: "));
      break interview;
    }
  } catch (error) {
    if (error instanceof InterviewQuit) return void console.log(`\nInterview stopped safely. Draft saved at ${paths.markdown}.`);
    throw error;
  } finally { prompt.close(); }
  if (launchCodex && record.handoff) launchCodexRuntime(project.store.root, record);
}

async function emitStart(project: EmpiricalProject, result: FeatureStartResult, json: boolean): Promise<void> {
  if (result.kind === "action") return emit(result, json, renderAction);
  if (json || !(process.stdin.isTTY && process.stdout.isTTY)) return emit(result, json, renderProposal);
  console.log(renderProposal(result));
  if (!(await approveProposal(result))) return void console.log("No worktree was created; the active feature is unchanged.");
  const handoff = await createFromProposal(project, result);
  emit(handoff, false, renderHandoff);
}

async function createFromProposal(project: EmpiricalProject, proposal: WorktreeProposal): Promise<WorktreeHandoff> {
  return project.createWorktree({
    request: proposal.request,
    workflow: proposal.workflow,
    changeType: proposal.changeType,
    feature: proposal.feature,
    branch: proposal.branch,
    path: proposal.path,
    base: proposal.base,
    baseCommit: proposal.baseCommit,
    activeFeature: proposal.activeFeature,
    approvalToken: proposal.approvalToken,
    approved: true,
  });
}

async function approveProposal(proposal: WorktreeProposal): Promise<boolean> {
  const prompt = new LinePrompter();
  try { return /^(y|yes)$/i.test(await prompt.ask("Create this worktree and start the feature? [y/N]: ")); }
  finally { prompt.close(); }
}

async function approveUninstall(): Promise<boolean> {
  console.log(`Empirical uninstall will remove:
- all marker-owned Empirical skills from supported global agent roots
- valid Empirical-owned global selection metadata
- the global empirical-sdd npm package

It will preserve:
- every project .empirical history and evidence directory
- repository MCP and agent configuration
- unmanaged, malformed, non-file, or symlinked global targets`);
  const prompt = new LinePrompter();
  try {
    return isUninstallConfirmed(await prompt.ask("\nRemove Empirical? [y/N]: "));
  } catch (error) {
    if (error instanceof InterviewQuit) return false;
    throw error;
  } finally {
    prompt.close();
  }
}

function renderProposal(value: unknown): string {
  const proposal = value as WorktreeProposal;
  return [
    "Empirical needs an isolated Git worktree (approval required)",
    `Active feature: ${proposal.activeFeature}`,
    `New request: ${proposal.request}`,
    `Workflow/type: ${proposal.workflow}/${proposal.changeType}`,
    `Base: ${proposal.base}`,
    `Base commit: ${proposal.baseCommit}`,
    `Branch: ${proposal.branch}`,
    `Path: ${proposal.path}`,
    `Command: ${proposal.command.map(shellDisplay).join(" ")}`,
    "No mutation has occurred. The checkout must be clean before approval can execute.",
  ].join("\n");
}

function renderHandoff(value: unknown): string {
  const handoff = value as WorktreeHandoff;
  return `Worktree created and Empirical started ${handoff.feature}.\nPath: ${handoff.path}\nBranch: ${handoff.branch}\nBase: ${handoff.base}\nRevision: ${handoff.revision}\nResume: ${handoff.resume}\n\n${renderAction(handoff.action)}`;
}

function renderConsult(value: unknown): string {
  const report = value as Awaited<ReturnType<EmpiricalProject["consult"]>>;
  const heading = `Empirical Consult · ${report.feature ?? "no active feature"}`;
  if (report.blocked) {
    const { specialist, finding } = report.blocked;
    return [
      heading,
      `Blocked by ${specialist}: ${finding.severity} ${finding.category} at ${finding.location}`,
      `Recommendation: ${finding.recommendation}`,
    ].join("\n");
  }
  if (report.packets.length === 0) {
    return [
      heading,
      report.required.length > 0
        ? `No consult is gated at ${report.phase}; required elsewhere: ${report.required.join(", ")}`
        : "This feature's surface requires no specialist consult.",
    ].join("\n");
  }
  return [
    `${heading} · phase ${report.phase}`,
    ...report.packets.flatMap((packet) => [
      "",
      `${packet.title} (${packet.specialist})`,
      `  Question: ${packet.question}`,
      `  Read only: ${packet.contextSlice.join(", ")}`,
      `  Write: ${packet.advisoryPath}`,
      `  May block on: ${packet.domain.join(", ")}`,
    ]),
  ].join("\n");
}

function renderExplain(value: unknown): string {
  const report = value as Awaited<ReturnType<EmpiricalProject["explain"]>>;
  const rationale = report.rationale;
  return [
    `Empirical Explain · ${report.feature ?? "no active feature"}`,
    `State: ${rationale.currentState}`,
    `Next: ${rationale.nextAction}`,
    `Why: ${rationale.reason}`,
    `Gate: ${rationale.gate}`,
    `Required context: ${rationale.requiredContext.length ? rationale.requiredContext.join(", ") : "none"}`,
    `Missing context: ${rationale.missingContext.length ? rationale.missingContext.join(", ") : "none"}`,
    report.decisions.length
      ? `Accepted decisions:\n${report.decisions.map((decision) => `- ${decision.id} ${decision.title}: ${decision.chosenApproach}`).join("\n")}`
      : "Accepted decisions: none",
  ].join("\n");
}

function renderExplore(value: unknown): string {
  const packet = value as ExplorationPacket;
  return [
    "Empirical Explore · packet mode (read-only)",
    `Problem: ${packet.problem}`,
    ...packet.instructions.map((item) => `- ${item}`),
    `Questions:\n${packet.questions.map((item) => `- ${item}`).join("\n")}`,
    ...(packet.projectContext.length ? [`Project context:\n${packet.projectContext.map((item) => `- ${item}`).join("\n")}`] : []),
    ...(packet.knowledgeContext.length ? [`Repository knowledge:\n${packet.knowledgeContext.map((item) => `- ${item}`).join("\n")}`] : []),
    ...(packet.capabilityContext.length ? [`Living capability context:\n${packet.capabilityContext.map((item) => `- ${item}`).join("\n")}`] : []),
    `Start when clear:\n- Fast: ${packet.next.fast}\n- Complex: ${packet.next.complex}`,
    "For the five-pass Socratic interview, use an interactive terminal or add --interactive.",
  ].join("\n\n");
}

function renderDiscoverySubmission(value: unknown): string {
  const result = value as DiscoverySubmissionResult;
  const lines = [
    `Socratic discovery ${result.record.status}: ${result.record.id}`,
    `Saved: ${result.paths.markdown}`,
  ];
  if (result.refinedRequest) lines.push(`Refined request:\n${result.refinedRequest}`);
  if (result.nextQuestion) {
    lines.push(`${result.nextQuestion.kind === "follow_up" ? "Material follow-up" : `Next pass · ${result.nextQuestion.title}`}:\n${result.nextQuestion.question}`);
  }
  if (result.start) {
    lines.push(result.start.kind === "action" ? renderAction(result.start) : renderProposal(result.start));
  }
  return lines.join("\n\n");
}

async function askRequired(prompt: LinePrompter, question: string): Promise<string> {
  while (true) {
    const answer = await prompt.ask(question);
    if (answer === ":quit") throw new InterviewQuit("User quit");
    if (answer) return answer;
    console.log("Please answer, or type :quit to save and stop.");
  }
}

async function askDefault(prompt: LinePrompter, question: string, fallback: string): Promise<string> {
  const answer = await prompt.ask(question);
  return answer || fallback;
}

async function askChoice(prompt: LinePrompter, question: string, allowed: Set<string>): Promise<string> {
  while (true) {
    const answer = (await prompt.ask(question)).toLowerCase();
    if (answer === ":quit") throw new InterviewQuit("User quit");
    if (allowed.has(answer)) return answer;
    console.log("Choose one of the displayed options.");
  }
}

function touchDiscovery(record: DiscoveryRecord, update: Partial<Omit<DiscoveryRecord, "schemaVersion" | "id" | "problem" | "createdAt">>): DiscoveryRecord {
  return { ...record, ...update, updatedAt: new Date().toISOString() };
}

function launchCodexRuntime(root: string, record: DiscoveryRecord): void {
  const handoff = record.handoff!;
  const request = [
    `Resume the active Empirical workflow for feature ${handoff.feature}.`,
    "Call empirical_loop once, execute the exact action, complete every revision with required evidence, and continue until Done, Blocked, or genuinely awaiting human input.",
    `Use .empirical/discoveries/${record.id}/brief.md as the approved product contract.`,
  ].join(" ");
  console.log("\nLaunching Codex with the approved workflow handoff...");
  const result = spawnSync("codex", [request], { cwd: root, stdio: "inherit" });
  if (result.error) console.warn(`Codex could not be launched (${result.error.message}). The workflow remains active.`);
  else if (result.status !== 0) console.warn(`Codex exited with status ${String(result.status)}. The workflow remains resumable.`);
}

function parseGlobals(argv: string[]): CliContext {
  const args = [...argv];
  const root = takeOption(args, "--root") ?? process.cwd();
  const json = takeFlag(args, "--json");
  return { args, root, json };
}

function readConfigurationFlags(args: string[]): { input: ProjectConfigurationInput; explicit: boolean } {
  const evidenceRequired = takeOnOffOption(args, "--evidence");
  const browserForUi = takeOnOffOption(args, "--ui-browser");
  const screenshotForUi = takeOnOffOption(args, "--ui-screenshot");
  const codeReview = takeOnOffOption(args, "--code-review");
  const mode = takeOption(args, "--isolation");
  if (mode && mode !== "ask" && mode !== "off") throw new EmpiricalError("INVALID_CONFIG", "--isolation must be ask or off");
  const baseBranch = takeOption(args, "--base");
  const worktreePath = takeOption(args, "--worktree-path");
  const branchPattern = takeOption(args, "--branch-pattern");
  const complexRecords = takeOption(args, "--decisions");
  if (complexRecords && complexRecords !== "required" && complexRecords !== "off") throw new EmpiricalError("INVALID_CONFIG", "--decisions must be required or off");
  const questions = takeOption(args, "--questions");
  if (questions && questions !== "concise" && questions !== "detailed") throw new EmpiricalError("INVALID_CONFIG", "--questions must be concise or detailed");
  const explicit = [evidenceRequired, browserForUi, screenshotForUi, codeReview]
    .some((value) => value !== undefined)
    || Boolean(mode || baseBranch || worktreePath || branchPattern || complexRecords || questions);
  return {
    explicit,
    input: {
      ...(evidenceRequired !== undefined || browserForUi !== undefined
        || screenshotForUi !== undefined || codeReview !== undefined
        ? { evidence: {
          ...(evidenceRequired !== undefined ? { required: evidenceRequired } : {}),
          ...(browserForUi !== undefined ? { browserForUi } : {}),
          ...(screenshotForUi !== undefined ? { screenshotForUi } : {}),
          ...(codeReview !== undefined ? { codeReview } : {}),
        } }
        : {}),
      ...(mode || baseBranch || worktreePath || branchPattern ? { isolation: {
        ...(mode ? { mode: mode as "ask" | "off" } : {}),
        ...(baseBranch ? { baseBranch } : {}),
        ...(worktreePath ? { worktreePath } : {}),
        ...(branchPattern ? { branchPattern } : {}),
      } } : {}),
      ...(complexRecords ? { decisions: { complexRecords: complexRecords as "required" | "off" } } : {}),
      ...(questions ? { interaction: { questions: questions as "concise" | "detailed" } } : {}),
    },
  };
}

function resolveCliAgentIds(values: string[]): AgentSkillTargetId[] {
  const resolved = new Set<AgentSkillTargetId>();
  for (const value of values) {
    const id = resolveAgentSkillTargetId(value);
    if (!id) throw new EmpiricalError("INVALID_ARGUMENT", `Unsupported agent '${value}'`);
    const target = agentSkillTarget(id);
    if (target.globalSkillPath === null) {
      throw new EmpiricalError(
        "INVALID_ARGUMENT",
        `Agent '${value}' cannot be installed globally: ${target.exclusionReason}`,
      );
    }
    resolved.add(id);
  }
  return globalAgentSkillTargets().filter((target) => resolved.has(target.id)).map((target) => target.id);
}

function defaultConfiguration(): ProjectConfigurationInput {
  return setupConfigurationInput(recommendedSetupSettings());
}

function takeOnOffOption(args: string[], name: string): boolean | undefined {
  const value = takeOption(args, name);
  if (value === undefined) return undefined;
  if (value !== "on" && value !== "off") {
    throw new EmpiricalError("INVALID_CONFIG", `${name} must be on or off`);
  }
  return value === "on";
}

async function completionInput(args: string[]): Promise<CompletionInput> {
  const inputPath = takeOption(args, "--input");
  if (inputPath) {
    assertNoArgs(args, "complete --input");
    const text = inputPath === "-" ? await readStdin() : await readFile(inputPath, "utf8");
    return JSON.parse(text) as CompletionInput;
  }
  const revision = requiredInteger(args, "--revision");
  const outcome = takeOption(args, "--outcome") ?? "passed";
  if (!["passed", "failed", "awaiting_human", "blocked"].includes(outcome)) throw new EmpiricalError("INVALID_OUTCOME", `Invalid outcome '${outcome}'`);
  const summary = takeOption(args, "--summary");
  if (!summary) throw new EmpiricalError("SUMMARY_REQUIRED", "Use --summary \"<what happened>\"");
  const actor = takeOption(args, "--actor");
  const receiptIds = takeOptions(args, ["--receipt"]);
  assertNoArgs(args, "complete");
  return {
    revision,
    outcome: outcome as CompletionInput["outcome"],
    summary,
    ...(actor ? { actor } : {}),
    ...(receiptIds.length > 0 ? { receiptIds } : {}),
  };
}

function readProfile(args: string[]): Workflow | undefined {
  const profile = takeOption(args, "--profile");
  if (!profile) return undefined;
  if (profile !== "fast" && profile !== "complex") throw new EmpiricalError("INVALID_PROFILE", `Workflow must be fast or complex, not '${profile}'`);
  return profile;
}

function requiredInteger(args: string[], name: string): number {
  const value = takeOption(args, name);
  if (!value || !/^\d+$/.test(value)) throw new EmpiricalError("INVALID_ARGUMENT", `${name} requires a non-negative integer`);
  return Number(value);
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new EmpiricalError("INVALID_ARGUMENT", `${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function takeOptions(args: string[], names: string[]): string[] {
  const values: string[] = [];
  while (true) {
    const indexes = names.map((name) => args.indexOf(name)).filter((index) => index >= 0);
    if (indexes.length === 0) return values;
    const index = Math.min(...indexes);
    const name = args[index]!;
    const value = args[index + 1];
    if (!value || value.startsWith("-")) throw new EmpiricalError("INVALID_ARGUMENT", `${name} requires a value`);
    values.push(value);
    args.splice(index, 2);
  }
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function hasHelpFlag(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

async function readJsonInput<T>(args: string[], command: string): Promise<T> {
  const inputPath = takeOption(args, "--input");
  if (!inputPath) {
    throw new EmpiricalError(
      "INVALID_ARGUMENT",
      `empirical __internal ${command} requires --input <json-file|->`,
    );
  }
  assertNoArgs(args, command);
  return readJsonPath<T>(inputPath, command);
}

async function readJsonPath<T>(inputPath: string, label: string): Promise<T> {
  const text = inputPath === "-" ? await readStdin() : await readFile(inputPath, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new EmpiricalError(
      "INVALID_ARGUMENT",
      `${label} input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertNoArgs(args: string[], command: string): void {
  if (args.length) throw new EmpiricalError("INVALID_ARGUMENT", `Unknown ${command} arguments: ${args.join(" ")}`);
}

function emit(value: unknown, json: boolean, human: (value: unknown) => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : human(value));
}

function renderIntegrationReport(summary: string, report: IntegrationReport): string {
  if (!report.entrypoints.length) {
    return report.scope === "global"
      ? `${summary}\n\nNo supported agents were detected. Install an agent or run empirical install --all.`
      : `${summary}\n\nRepository-local automatic activation and MCP bridges were reconciled. Use empirical-init only for setup or repair; ordinary change prompts need no Empirical command.`;
  }
  const lines = [
    summary,
    "",
    `Selected agents (${report.selected.length}): ${report.entrypoints.map((entry) => entry.agent).join(", ")}`,
    `Unique destinations (${report.destinations.length}):`,
    ...report.destinations.map((destination) => `- ${destination}`),
    "",
    "Filesystem outcomes:",
    renderOutcome("Created", report.created),
    renderOutcome("Updated", report.updated),
    renderOutcome("Removed", report.removed),
    renderOutcome("Preserved", report.preserved, true),
    "",
    "Installed Empirical agent skills:",
  ];
  for (const entry of report.entrypoints) {
    lines.push(`- ${entry.agent} (${entry.artifactRoot})`);
    lines.push(`  Skills: ${entry.skills.join(", ")}`);
    if (entry.guidanceVerified) {
      lines.push(`  Invoke: ${entry.invocations.join(", ")}`, `  Reload: ${entry.reload}`);
    } else {
      lines.push(`  ${entry.reload}`);
    }
    lines.push(`  Project MCP support: ${entry.projectMcp ? "verified" : "not claimed"}; executable handoff: ${entry.handoff ? "verified" : "not claimed"}.`);
  }
  return lines.join("\n");
}

function renderUninstallReport(value: unknown): string {
  const report = value as UninstallReport;
  return [
    `Empirical removed the global npm package and ${report.integrations.removed.length} managed global artifact${report.integrations.removed.length === 1 ? "" : "s"}.`,
    "",
    "Filesystem outcomes:",
    renderOutcome("Removed", report.integrations.removed),
    renderOutcome("Preserved", report.integrations.preserved, true),
    "",
    "Preserved project state:",
    "- project .empirical histories and evidence",
    "- repository MCP and agent configuration",
    "",
    "Reload open coding agents to clear their cached Empirical skills.",
  ].join("\n");
}

function renderOutcome(label: string, paths: string[], includeAll = false): string {
  if (paths.length === 0) return `- ${label} (0): none`;
  const shown = includeAll ? paths : paths.slice(0, 5);
  const remaining = paths.length - shown.length;
  return `- ${label} (${paths.length}): ${shown.join(", ")}${remaining > 0 ? ` … +${remaining} more (use --json for every path)` : ""}`;
}

function renderConfig(value: unknown): string {
  const config = value as Awaited<ReturnType<EmpiricalProject["config"]>>;
  return [
    "Empirical configuration saved.",
    `Criterion evidence: ${config.evidence.required ? "on" : "off"}`,
    `UI browser evidence: ${config.evidence.browserForUi ? "on" : "off"}${config.evidence.required ? "" : " (inactive while criterion evidence is off)"}`,
    `UI screenshot evidence: ${config.evidence.screenshotForUi ? "on" : "off"}${config.evidence.required ? "" : " (inactive while criterion evidence is off)"}`,
    `Code review evidence: ${config.evidence.codeReview ? "on" : "off"}`,
    `Isolation: ${config.isolation.mode}`,
    `Base: ${config.isolation.baseBranch}`,
    `Worktree path: ${config.isolation.worktreePath}`,
    `Branch pattern: ${config.isolation.branchPattern}`,
    `Complex decisions: ${config.decisions.complexRecords}`,
    `Questions: ${config.interaction.questions}`,
  ].join("\n");
}

function renderAgentHandoffOffer(value: unknown): string {
  const offer = value as AgentHandoffOffer;
  const agents = offer.agents.length
    ? offer.agents.map((agent) => [
      `- ${agent.agent} (${agent.capability})`,
      `  Command: ${agent.argv.map(shellDisplay).join(" ")}`,
      `  Approval token: ${agent.approvalToken}`,
    ].join("\n")).join("\n")
    : "- No prompt-capable or workspace agent executable was detected.";
  return [
    `Empirical handoff · ${offer.feature}`,
    `Specification: ${offer.specification}`,
    "Choices: Continue here | Save for later | Continue in a detected agent",
    agents,
    "No process has been started. Display and explicitly approve one exact option before authorization.",
  ].join("\n\n");
}

function renderAuthorizedHandoff(value: unknown): string {
  const handoff = value as AuthorizedAgentHandoff;
  return `Authorized ${handoff.agent} handoff for ${handoff.feature}.\nCwd: ${handoff.cwd}\nCommand: ${handoff.argv.map(shellDisplay).join(" ")}\nThe current host may now execute only this exact command.`;
}

function renderAction(value: unknown): string {
  const action = value as ActionPacket;
  const header = action.feature ? `${action.feature}: ${action.phase} (${action.profile}, ${action.status}, revision ${action.revision})` : `Empirical: ${action.phase}`;
  const progress = phaseProgress(action.profile, action.phase);
  if (action.interaction.questions === "concise") {
    const sections = [
      `Empirical${progress ? ` · ${progress}` : ""} · ${header}`,
      action.instructions,
      renderTrackerStatus(action.tracker, true),
    ];
    if (action.rationale.missingContext.length) {
      sections.push(`Missing: ${action.rationale.missingContext.join(", ")}`);
    }
    if (action.completion.available) sections.push(`Complete: ${action.completion.cli}`);
    return sections.join("\n");
  }
  const sections = [`Empirical${progress ? ` · ${progress}` : ""}`, header, action.instructions];
  sections.push(renderTrackerStatus(action.tracker));
  if (action.projectContext.length) sections.push(`Project context:\n${action.projectContext.map((item) => `- ${item}`).join("\n")}`);
  if (action.knowledgeContext.length) sections.push(`Repository knowledge:\n${action.knowledgeContext.map((item) => `- ${item}`).join("\n")}`);
  if (action.capabilityContext.length) sections.push(`Living capability context:\n${action.capabilityContext.map((item) => `- ${item}`).join("\n")}`);
  if (action.acceptanceCriteria.length) sections.push(`Acceptance criteria:\n${action.acceptanceCriteria.map((criterion) => `- ${criterion.id}: ${criterion.text}`).join("\n")}`);
  if (action.artifacts.length) sections.push(`Required artifacts:\n${action.artifacts.map((artifact) => `- ${artifact}`).join("\n")}`);
  if (action.requiredEvidence.length) sections.push(`Required evidence: ${action.requiredEvidence.join(", ")}`);
  if (action.completion.available) sections.push(`Complete with: ${action.completion.cli}`);
  return sections.join("\n\n");
}

function renderStatus(value: unknown): string {
  const state = value as ProjectStatus;
  if (state.interaction.questions === "concise") {
    return [
      `feature=${state.activeFeature ?? "none"} phase=${state.phase} status=${state.status} revision=${state.revision} profile=${state.profile}`,
      renderTrackerStatus(state.tracker, true),
    ].join("\n");
  }
  return [
    `feature=${state.activeFeature ?? "none"} phase=${state.phase} status=${state.status} revision=${state.revision} profile=${state.profile}`,
    renderTrackerStatus(state.tracker),
  ].join("\n\n");
}

function renderTrackerStatus(tracker: TrackerStatus, concise = false): string {
  const failure = tracker.failure
    ? `${boundedHumanText(tracker.failure.code, 64)} — ${boundedHumanText(tracker.failure.summary, 500)}`
    : "none";
  const failureAt = tracker.failure ? boundedHumanText(tracker.failure.at, 64) : "none";
  const recovery = tracker.failure
    ? boundedHumanText(trackerRecoveryHint(tracker.failure.code), 500)
    : "none";
  if (concise) {
    const rule = tracker.changeType && tracker.ticketRequirement
      ? ` · ${tracker.changeType}/${tracker.ticketRequirement}`
      : "";
    const remote = tracker.url ? ` · ${safeTrackerUrl(tracker)}` : "";
    const line = `Tracker: ${tracker.health}${tracker.provider ? ` · ${tracker.provider}` : ""}${rule}${remote}`;
    return tracker.failure
      ? `${line}\nTracker failure: ${failure}\nRecovery: ${recovery}`
      : line;
  }
  return [
    "External tracker:",
    `- Health: ${tracker.health}`,
    `- Provider: ${tracker.provider ?? "none"}`,
    `- URL: ${safeTrackerUrl(tracker)}`,
    `- Committed revision: ${tracker.committedRevision}`,
    `- Last-synced revision: ${tracker.lastSyncedRevision ?? "none"}`,
    `- Pending revision: ${tracker.pendingRevision ?? "none"}`,
    ...(tracker.schemaVersion === undefined ? [] : [`- Policy schema: ${tracker.schemaVersion}`]),
    ...(tracker.ticket === undefined ? [] : [`- Ticket behavior: ${tracker.ticket}`]),
    ...(tracker.visibility === undefined ? [] : [`- Progress visibility: ${tracker.visibility}`]),
    ...(tracker.changeType === undefined ? [] : [`- Change type: ${tracker.changeType}`]),
    ...(tracker.ticketRequirement === undefined ? [] : [`- Ticket requirement: ${tracker.ticketRequirement}`]),
    ...(tracker.pendingEffects === undefined ? [] : [`- Pending effects: ${tracker.pendingEffects}`]),
    `- Failure: ${failure}`,
    `- Failure at: ${failureAt}`,
    `- Recovery: ${recovery}`,
  ].join("\n");
}

function renderTrackerDiscovery(value: unknown, input: TrackerDiscoveryInput): string {
  const discovery = value as TrackerDiscovery;
  const authentication = trackerAuthenticationGuidance(input);
  const resources = discovery.resources.map((resource) => {
    const metadata = [resource.kind, resource.key, resource.stateType]
      .filter((entry): entry is string => Boolean(entry))
      .join(" · ");
    return `- ${resource.name} (${resource.id})${metadata ? ` — ${metadata}` : ""}`;
  });
  return [
    `Tracker discovery: ${discovery.provider}`,
    `Capabilities: comments=${discovery.capabilities.comments}, uploads=${discovery.capabilities.uploads}, durable-links=${discovery.capabilities.durableLinks}`,
    "Authentication: trusted host OAuth preferred",
    `Fallback file: ${authentication.secretFilePath}`,
    `Fallback names: ${authentication.credentialNames.join(", ")}`,
    `${authentication.warning}.`,
    ...resources,
    `Discovery digest: ${discovery.digest}`,
  ].join("\n");
}

function renderTrackerPreview(value: unknown): string {
  const preview = value as TrackerPolicyPreview;
  const authentication = trackerAuthenticationGuidance(preview.policy);
  return [
    `Tracker policy preview: ${preview.policy.provider} v${preview.policy.schemaVersion}`,
    `Target: ${preview.target.map((resource) => `${resource.name} (${resource.kind})`).join(" → ")}`,
    `Ticket behavior: ${preview.effective.ticket}`,
    ...(preview.policy.schemaVersion === 2 && preview.policy.ticketRules
      ? ["Ticket rules:", ...renderTicketRuleLines(preview.policy.ticketRules).map((line) => `- ${line}`)]
      : []),
    `Progress visibility: ${preview.effective.visibility}`,
    "Authentication: trusted host OAuth preferred",
    `Fallback file: ${authentication.secretFilePath}`,
    `${authentication.warning}.`,
    "State mapping:",
    ...Object.entries(preview.mapping).map(([phase, resource]) =>
      `- ${phase}: ${resource.name} (${resource.id})`),
    `Credential sources: ${Object.values(preview.policy.credentialEnv).join(", ")} (names only; values are never saved)`,
    `Preview digest: ${preview.digest}`,
  ].join("\n");
}

function renderTicketRuleLines(rules: TrackerTicketRules): string[] {
  return (["feature", "fix", "chore"] as const).map((changeType) => {
    const profile = rules[changeType];
    return `${changeType}: fast ${profile.fast} · quick ${profile.quick} · complex ${profile.complex}`;
  });
}

function renderTrackerMapping(mapping: import("./types.js").TrackerMappingSuggestion): string {
  return [
    `Tracker mapping suggestion: ${mapping.provider}`,
    ...Object.entries(mapping.phases).map(([phase, suggestion]) => {
      const selected = suggestion.selectedStateId
        ? suggestion.candidates.find((candidate) => candidate.stateId === suggestion.selectedStateId)
        : null;
      return `- ${phase}: ${selected ? `${selected.name} (${selected.stateId})` : "explicit choice required"}`;
    }),
    ...(mapping.ambiguous.length ? [`Unresolved: ${mapping.ambiguous.join(", ")}`] : []),
  ].join("\n");
}

function trackerRecoveryHint(code: string): string {
  if (code === "TRACKER_CREATE_AMBIGUOUS") {
    return "Run tracker-sync to reconcile the attempted create. If it remains ambiguous, locate and attach the ticket or explicitly confirm a duplicate-risk create retry.";
  }
  if (code === "TRACKER_BIND_AMBIGUOUS" || code === "TRACKER_MARKER_AMBIGUOUS") {
    return "Inspect the target for competing Empirical markers, then explicitly attach the one valid ticket; Empirical will not guess or create another ticket.";
  }
  if (code === "TRACKER_TARGET_MISMATCH" || code === "TRACKER_PROVIDER_MISMATCH") {
    return "Restore the policy target that owns this binding, or explicitly replace and revalidate the binding for the intended target.";
  }
  if (code === "TRACKER_CREDENTIAL_MISSING") {
    return "Inject the configured credential environment variable into the MCP or CLI host process, then run tracker-sync again.";
  }
  if (code === "TRACKER_ARTIFACT_UNSAFE" || code === "TRACKER_ARTIFACT_RECEIPT_INVALID") {
    return "Repair or replace the committed evidence receipt/artifact with a contained, regular, safe file, commit local state, then retry tracker-sync.";
  }
  if (code === "TRACKER_HTTP_FAILED" || code === "TRACKER_TRANSPORT_FAILED" || code === "TRACKER_GRAPHQL_FAILED") {
    return "Check provider availability and token permissions; local progress is already committed, so retry tracker-sync after access recovers.";
  }
  return "Resolve the reported tracker or provider failure, then run tracker-sync to retry the durable pending revision.";
}

function safeTrackerUrl(tracker: TrackerStatus): string {
  if (!tracker.url) return "none";
  try {
    const value = new URL(tracker.url);
    const expectedHost = tracker.provider === "github"
      ? value.hostname === "github.com"
      : tracker.provider === "linear"
        ? value.hostname === "linear.app"
        : tracker.provider === "jira"
          ? value.hostname.endsWith(".atlassian.net")
          : false;
    if (
      value.protocol !== "https:"
      || !expectedHost
      || value.port
      || value.username
      || value.password
      || value.search
      || value.hash
      || tracker.url.length > 2048
    ) return "unavailable";
    return boundedHumanText(tracker.url, 2048);
  } catch {
    return "unavailable";
  }
}

function boundedHumanText(value: string, limit: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function phaseProgress(profile: ActionPacket["profile"], phase: ActionPacket["phase"]): string | null {
  if (phase === "idle" || phase === "done") return null;
  const phases = profile === "fast" ? ["implement", "context"] : profile === "quick" ? ["shape", "implement", "context", "verify", "review"] : ["specify", "design", "plan", "implement", "context", "verify", "review", "integrate", "deliver", "publish"];
  const index = phases.indexOf(phase);
  return index < 0 ? null : `step ${index + 1}/${phases.length}`;
}

function renderLoopAction(value: unknown): string {
  const action = value as ActionPacket;
  const rendered = renderAction(action);
  return ["idle", "done", "blocked", "awaiting_human"].includes(action.status)
    ? rendered
    : `${rendered}\nThe calling agent executes this action, completes revision ${action.revision}, and continues from the returned packet.`;
}

function shellDisplay(value: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function runLifecycleQuietly(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "pipe", shell: false });
  return { status: result.status, ...(result.error ? { error: result.error } : {}) };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function printHelp(): void {
  console.log(`${renderBrandBannerForOutput(PRODUCT_VERSION)}

Install once: npm install -g empirical-sdd

Lifecycle:
  empirical install            Choose agents in an interactive selector
  empirical update             Update the package and refresh installed skills
  empirical uninstall          Remove managed global skills and the package

Installer automation:
  empirical install --agent codex --agent cursor   (repeatable; -a alias)
  empirical install --agent claude        Legacy alias for claude-code
  empirical install --all
  empirical install --yes                 Remembered/detected set (-y alias)
  empirical install --all --json          Structured deterministic report

The searchable installer uses a pinned local catalog of 73 global skill targets,
remembers explicit selections, and performs no runtime network or npx calls.

Repository work happens inside your coding agent through ${SKILLS.length} installed ${SKILLS.length === 1 ? "skill" : "skills"}:
${SKILLS.map((skill) => `  ${skill.id.padEnd(28)} ${skill.description}`).join("\n")}

Initialize or repair a repository explicitly with native syntax such as
$empirical-init in Codex, /empirical-init in Claude Code, or @empirical-init in
Windsurf. After setup, ordinary repository-changing prompts route automatically;
read-only prompts do not. Agent skills are not terminal workflow commands.
Fast remains contract-neutral; Complex handles every material risk floor.
The MCP/private adapter registry currently defines ${OPERATIONS.length} operations.`);
}

function printSubcommandHelp(command: string, internal: boolean): void {
  if (!internal) {
    if (command === "install") {
      console.log(`Install the ${SKILLS.length} registry-backed Empirical ${SKILLS.length === 1 ? "skill" : "skills"} for selected agents without project workflow mutation.

  empirical install
  empirical install --agent <agent> [--agent <agent> ...]
  empirical install --all
  empirical install --yes

Options: --agent/-a, --all, --yes/-y, --json, --help/-h`);
      return;
    }
    if (command === "update") {
      console.log(`Update the installed package and reconcile the ${SKILLS.length} registry-backed ${SKILLS.length === 1 ? "skill" : "skills"}.

  empirical update
  empirical update --check

Options: --check, --json, --help/-h`);
      return;
    }
    if (command === "uninstall") {
      console.log(`Remove all marker-owned global Empirical skills, owned selection metadata, and then the global npm package.

  empirical uninstall
  empirical uninstall --yes
  empirical uninstall --yes --json

Project .empirical histories and repository MCP/agent configuration are always preserved.
Unmanaged, malformed, non-file, and symlinked targets are preserved and reported.

Options: --yes/-y, --json, --help/-h`);
      return;
    }
    if (command === "mcp") {
      console.log(`Run the registry-backed Empirical MCP server over stdio.

  empirical mcp [--root <repository>]

The server exposes ${OPERATIONS.length} internal operations. Configure it as a
stdio MCP process; it does not open a network listener.`);
      return;
    }
    console.log("Run empirical --help for public commands.");
    return;
  }
  const aliases: Record<string, string> = {
    config: "configure",
    worktree: "worktree-create",
  };
  const id = aliases[command] ?? command;
  const operation = operationById(id);
  if (!operation) {
    throw new EmpiricalError("UNKNOWN_COMMAND", `Unknown internal operation '${command}'`);
  }
  console.log(`${operation.summary}

  empirical __internal ${operation.internalVerb}${operation.cliUsage}

Registry id: ${operation.id}
MCP tool: ${operation.mcpName}
Profiles: ${operation.profiles.join(", ")}
Modes: ${operation.modes.join(", ")}`);
}

function printExploreHelp(): void {
  console.log(`Conduct the original five-pass Socratic discovery before state is created.

  empirical __internal explore "<vague problem>"
  empirical __internal explore "<vague problem>" --agent codex
  empirical __internal explore "<vague problem>" --json

The interview asks problem/user, observable outcome, boundaries/non-goals,
failure/risk, and verification one question at a time, saves answers, presents
the refined contract, and waits for approval before Fast or Complex.`);
}

function printCompleteHelp(): void {
  console.log(`Complete the current exact revision.

  empirical __internal complete --revision N --outcome passed --summary "<result>" --receipt <immutable-receipt-id>

Use --input <file|-> for a complete structured result document. Schema 5 rejects
caller-asserted evidence booleans; create receipts with evidence-execute or
evidence-collect first.`);
}

main().catch((error: unknown) => {
  const payload = error instanceof EmpiricalError
    ? { error: error.code, message: error.message, details: error.details }
    : { error: "UNEXPECTED", message: asErrorMessage(error) };
  console.error(JSON.stringify(payload));
  process.exitCode = 1;
});
