import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import {
  buildMoveToWorkspaceMenuEntry,
  buildWorkspaceDisplayName,
  insertMoveToWorkspaceMenuEntry,
  listWorkspaceTabMoveTargets,
  moveWorkspaceTab,
  resolveWorkspaceTabMoveSource,
  MOVE_TO_WORKSPACE_MENU_KEY,
  type WorkspaceTabMoveStore,
  type WorkspaceTabMoveWorkspace,
} from "@/screens/workspace/workspace-tab-move";

function agentTab(agentId: string, tabId = `tab-${agentId}`): WorkspaceTab {
  return {
    tabId,
    target: { kind: "agent", agentId },
    createdAt: 1,
  };
}

function terminalTab(terminalId: string): WorkspaceTab {
  return {
    tabId: `tab-${terminalId}`,
    target: { kind: "terminal", terminalId },
    createdAt: 1,
  };
}

function workspace(
  workspaceId: string,
  overrides: Partial<WorkspaceTabMoveWorkspace> = {},
): WorkspaceTabMoveWorkspace {
  return {
    workspaceKey: `srv:${workspaceId}`,
    workspaceId,
    name: workspaceId,
    archiving: false,
    ...overrides,
  };
}

describe("buildMoveToWorkspaceMenuEntry", () => {
  it("returns null for non-agent tabs", () => {
    expect(
      buildMoveToWorkspaceMenuEntry({ tab: terminalTab("t1"), onSelect: () => {} }),
    ).toBeNull();
  });

  it("returns a stable entry for agent tabs and forwards the tab on select", () => {
    const tab = agentTab("agent-1");
    const onSelect = vi.fn();
    const entry = buildMoveToWorkspaceMenuEntry({ tab, onSelect });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe("item");
    expect(entry?.key).toBe(MOVE_TO_WORKSPACE_MENU_KEY);
    if (entry?.kind !== "item") throw new Error("expected item entry");
    entry.onSelect();
    expect(onSelect).toHaveBeenCalledWith(tab);
  });
});

describe("insertMoveToWorkspaceMenuEntry", () => {
  it("inserts the move entry before the close group and keeps other entries", () => {
    const entries = [
      { kind: "item", key: "rename", label: "Rename", testID: "rename", onSelect: () => {} },
      { kind: "separator", key: "rename-separator" },
      {
        kind: "item",
        key: "close-before",
        label: "Close left",
        testID: "close-before",
        onSelect: () => {},
      },
      { kind: "item", key: "close", label: "Close", testID: "close", onSelect: () => {} },
    ] as const;
    const result = insertMoveToWorkspaceMenuEntry({
      entries: [...entries],
      tab: agentTab("agent-1"),
      onSelect: () => {},
    });
    const keys = result.map((entry) => entry.key);
    expect(keys).toEqual([
      "rename",
      "rename-separator",
      MOVE_TO_WORKSPACE_MENU_KEY,
      "close-before",
      "close",
    ]);
  });

  it("appends at the end when the close group is missing", () => {
    const entries = [
      { kind: "item", key: "rename", label: "Rename", testID: "rename", onSelect: () => {} },
    ] as const;
    const result = insertMoveToWorkspaceMenuEntry({
      entries: [...entries],
      tab: agentTab("agent-1"),
      onSelect: () => {},
    });
    expect(result.map((entry) => entry.key)).toEqual(["rename", MOVE_TO_WORKSPACE_MENU_KEY]);
  });

  it("does not duplicate the entry when it already exists", () => {
    const first = insertMoveToWorkspaceMenuEntry({
      entries: [],
      tab: agentTab("agent-1"),
      onSelect: () => {},
    });
    const second = insertMoveToWorkspaceMenuEntry({
      entries: first,
      tab: agentTab("agent-1"),
      onSelect: () => {},
    });
    expect(second.map((entry) => entry.key)).toEqual([MOVE_TO_WORKSPACE_MENU_KEY]);
  });

  it("leaves non-agent tabs untouched", () => {
    const entries = [
      { kind: "item", key: "close", label: "Close", testID: "close", onSelect: () => {} },
    ] as const;
    const result = insertMoveToWorkspaceMenuEntry({
      entries: [...entries],
      tab: terminalTab("t1"),
      onSelect: () => {},
    });
    expect(result.map((entry) => entry.key)).toEqual(["close"]);
  });
});

describe("resolveWorkspaceTabMoveSource", () => {
  it("finds the workspace whose layout contains the tab", () => {
    const source = resolveWorkspaceTabMoveSource({
      tabId: "tab-1",
      layouts: [
        { workspaceKey: "srv:ws-a", tabIds: ["tab-0", "tab-1"] },
        { workspaceKey: "srv:ws-b", tabIds: ["tab-9"] },
      ],
    });
    expect(source).toEqual({ workspaceKey: "srv:ws-a" });
  });

  it("returns null when no workspace holds the tab", () => {
    expect(
      resolveWorkspaceTabMoveSource({
        tabId: "tab-missing",
        layouts: [{ workspaceKey: "srv:ws-a", tabIds: ["tab-0"] }],
      }),
    ).toBeNull();
  });
});

describe("listWorkspaceTabMoveTargets", () => {
  it("excludes the source workspace and archiving workspaces", () => {
    const targets = listWorkspaceTabMoveTargets({
      sourceWorkspaceKey: "srv:ws-a",
      workspaces: [
        workspace("ws-a"),
        workspace("ws-b"),
        workspace("ws-archived", { archiving: true }),
        workspace("ws-c"),
      ],
    });
    expect(targets.map((target) => target.workspaceId)).toEqual(["ws-b", "ws-c"]);
  });
});

describe("buildWorkspaceDisplayName", () => {
  it("prefers title, then name, then the directory basename", () => {
    expect(buildWorkspaceDisplayName({ title: "T", name: "n", workspaceDirectory: "/d/x" })).toBe(
      "T",
    );
    expect(buildWorkspaceDisplayName({ title: null, name: "n", workspaceDirectory: "/d/x" })).toBe(
      "n",
    );
    expect(buildWorkspaceDisplayName({ title: null, name: "", workspaceDirectory: "/d/x" })).toBe(
      "x",
    );
    expect(buildWorkspaceDisplayName({ title: null, name: "", workspaceDirectory: "" })).toBe("");
  });
});

describe("moveWorkspaceTab", () => {
  function makeStore(openResult: string | null = "new-tab") {
    return {
      openTab: vi.fn(() => openResult),
      closeTab: vi.fn(),
      unpinAgent: vi.fn(),
      hideAgent: vi.fn(),
    } satisfies WorkspaceTabMoveStore;
  }

  it("reveals and pins the tab in the target workspace, then closes it in the source", () => {
    const store = makeStore();
    const moved = moveWorkspaceTab(
      { store },
      {
        sourceWorkspaceKey: "srv:ws-a",
        targetWorkspaceKey: "srv:ws-b",
        tabId: "tab-1",
        target: { kind: "agent", agentId: "agent-1" },
      },
    );
    expect(moved).toBe(true);
    expect(store.openTab).toHaveBeenCalledWith({
      workspaceKey: "srv:ws-b",
      target: { kind: "agent", agentId: "agent-1" },
      intent: "reveal",
      pin: true,
    });
    expect(store.unpinAgent).toHaveBeenCalledWith("srv:ws-a", "agent-1");
    expect(store.hideAgent).toHaveBeenCalledWith("srv:ws-a", "agent-1");
    expect(store.closeTab).toHaveBeenCalledWith("srv:ws-a", "tab-1");
  });

  it("keeps the source tab when the target open fails", () => {
    const store = makeStore(null);
    const moved = moveWorkspaceTab(
      { store },
      {
        sourceWorkspaceKey: "srv:ws-a",
        targetWorkspaceKey: "srv:ws-b",
        tabId: "tab-1",
        target: { kind: "agent", agentId: "agent-1" },
      },
    );
    expect(moved).toBe(false);
    expect(store.closeTab).not.toHaveBeenCalled();
    expect(store.hideAgent).not.toHaveBeenCalled();
  });

  it("no-ops when the target workspace is the source workspace", () => {
    const store = makeStore();
    const moved = moveWorkspaceTab(
      { store },
      {
        sourceWorkspaceKey: "srv:ws-a",
        targetWorkspaceKey: "srv:ws-a",
        tabId: "tab-1",
        target: { kind: "agent", agentId: "agent-1" },
      },
    );
    expect(moved).toBe(false);
    expect(store.openTab).not.toHaveBeenCalled();
    expect(store.closeTab).not.toHaveBeenCalled();
  });

  it("refuses non-agent targets", () => {
    const store = makeStore();
    const moved = moveWorkspaceTab(
      { store },
      {
        sourceWorkspaceKey: "srv:ws-a",
        targetWorkspaceKey: "srv:ws-b",
        tabId: "tab-1",
        target: { kind: "terminal", terminalId: "t-1" },
      },
    );
    expect(moved).toBe(false);
    expect(store.openTab).not.toHaveBeenCalled();
  });
});
