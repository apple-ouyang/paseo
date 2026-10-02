import pino from "pino";
import { expect, test } from "vitest";
import type { AgentManager } from "./agent/agent-manager.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { createPersistedWorkspaceRecord, type WorkspaceRegistry } from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

/** The class schedules with setTimeout(0); drain a few macrotasks before asserting. */
async function flushScheduled(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface AgentTitleHarnessOptions {
  currentTitle: string | null;
  generatedTitle: string | null;
}

function createAgentTitleHarness(options: AgentTitleHarnessOptions) {
  const writes: string[] = [];
  const autoName = new WorkspaceAutoName({
    agentManager: {
      setTitle: async (_agentId: string, title: string) => {
        writes.push(title);
      },
    } as unknown as AgentManager,
    workspaceRegistry: {
      update: async () => {
        throw new Error("workspace registry must not be touched by the agent title path");
      },
    } satisfies Pick<WorkspaceRegistry, "update">,
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => {},
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({
      title: options.generatedTitle,
      branch: null,
    }),
  });
  return {
    autoName,
    writes,
    readCurrentTitle: async (): Promise<string | null> => options.currentTitle,
  };
}

test("agent auto-title replaces the prompt-derived provisional title", async () => {
  const { autoName, writes, readCurrentTitle } = createAgentTitleHarness({
    currentTitle: "Fix the login flow",
    generatedTitle: "修复登录流程",
  });

  autoName.scheduleForAgentTitle({
    agentId: "agent-auto-title",
    cwd: "/workspace",
    firstAgentContext: { prompt: "Fix the login flow" },
    provisionalTitle: "Fix the login flow",
    readCurrentTitle,
  });
  await flushScheduled();

  expect(writes).toEqual(["修复登录流程"]);
});

test("agent auto-title keeps a title the user renamed", async () => {
  const { autoName, writes, readCurrentTitle } = createAgentTitleHarness({
    currentTitle: "My own tab name",
    generatedTitle: "修复登录流程",
  });

  autoName.scheduleForAgentTitle({
    agentId: "agent-auto-title",
    cwd: "/workspace",
    firstAgentContext: { prompt: "Fix the login flow" },
    provisionalTitle: "Fix the login flow",
    readCurrentTitle,
  });
  await flushScheduled();

  expect(writes).toEqual([]);
});

test("agent auto-title keeps an explicit create_agent title", async () => {
  const { autoName, writes, readCurrentTitle } = createAgentTitleHarness({
    currentTitle: "Explicit planner title",
    generatedTitle: "修复登录流程",
  });

  autoName.scheduleForAgentTitle({
    agentId: "agent-auto-title",
    cwd: "/workspace",
    firstAgentContext: { prompt: "Fix the login flow" },
    provisionalTitle: "Fix the login flow",
    readCurrentTitle,
  });
  await flushScheduled();

  expect(writes).toEqual([]);
});

test("agent auto-title writes nothing when generation returns no title", async () => {
  const { autoName, writes, readCurrentTitle } = createAgentTitleHarness({
    currentTitle: "Fix the login flow",
    generatedTitle: null,
  });

  autoName.scheduleForAgentTitle({
    agentId: "agent-auto-title",
    cwd: "/workspace",
    firstAgentContext: { prompt: "Fix the login flow" },
    provisionalTitle: "Fix the login flow",
    readCurrentTitle,
  });
  await flushScheduled();

  expect(writes).toEqual([]);
});

test("agent auto-title does not rewrite an identical title", async () => {
  const { autoName, writes, readCurrentTitle } = createAgentTitleHarness({
    currentTitle: "Fix the login flow",
    generatedTitle: "Fix the login flow",
  });

  autoName.scheduleForAgentTitle({
    agentId: "agent-auto-title",
    cwd: "/workspace",
    firstAgentContext: { prompt: "Fix the login flow" },
    provisionalTitle: "Fix the login flow",
    readCurrentTitle,
  });
  await flushScheduled();

  expect(writes).toEqual([]);
});

test("agent auto-title swallows a failure while reading the current title", async () => {
  const { autoName, writes } = createAgentTitleHarness({
    currentTitle: "Fix the login flow",
    generatedTitle: "修复登录流程",
  });

  autoName.scheduleForAgentTitle({
    agentId: "agent-auto-title",
    cwd: "/workspace",
    firstAgentContext: { prompt: "Fix the login flow" },
    provisionalTitle: "Fix the login flow",
    readCurrentTitle: async () => {
      throw new Error("agent is gone");
    },
  });
  await flushScheduled();

  expect(writes).toEqual([]);
});

test("auto-name preserves workspace archival that lands during its metadata write", async () => {
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-auto-name",
    projectId: "project-auto-name",
    cwd: "/workspace",
    kind: "directory",
    displayName: "workspace",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const mutationStarted = deferred();
  const allowMutation = deferred();
  const updateEmitted = deferred();
  const workspaceRegistry = {
    update: async (_workspaceId, updater) => {
      mutationStarted.resolve();
      await allowMutation.promise;
      workspace = updater(workspace);
      return workspace;
    },
  } satisfies Pick<WorkspaceRegistry, "update">;
  const autoName = new WorkspaceAutoName({
    agentManager: {} as AgentManager,
    workspaceRegistry,
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => updateEmitted.resolve(),
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({ title: "generated", branch: null }),
  });

  autoName.scheduleForDirectory({
    workspaceId: workspace.workspaceId,
    cwd: workspace.cwd,
    firstAgentContext: { prompt: "Name this workspace" },
  });
  await mutationStarted.promise;
  const archivedAt = "2026-08-08T00:01:00.000Z";
  workspace = { ...workspace, updatedAt: archivedAt, archivedAt };
  allowMutation.resolve();
  await updateEmitted.promise;

  expect(workspace).toMatchObject({
    title: "generated",
    archivedAt,
  });
});
