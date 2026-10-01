import type { WorkspaceTabMenuEntry } from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * Move a workspace tab (agent sessions) into another workspace's tab row.
 *
 * The tab layout is client-side state keyed by `serverId:workspaceId`
 * (`buildWorkspaceTabPersistenceKey`), while an agent always *belongs* to the
 * workspace that created it. A moved tab therefore lives in the destination via
 * `pin: true` (an explicit open survives tab reconciliation) and leaves the
 * source via the same cleanup as closing a tab (`unpin` + `hide` + `close`), so
 * reconciliation does not re-open it there. The agent itself keeps running in
 * its original directory and stays under its original project in the sidebar.
 *
 * The picker mirrors the sidebar's project → workspace grouping
 * (`sidebar-workspaces-view-model`: `projectNameForWorkspace` and
 * `resolveSidebarWorkspacePrimaryLabel` semantics), so the move list reads the
 * same way as the left sidebar.
 */
export const MOVE_TO_WORKSPACE_MENU_KEY = "move-to-workspace";

export type WorkspaceTabMoveTitleSource = "title" | "branch";

export interface WorkspaceTabMoveStrings {
  menuLabel: string;
  title: string;
  hint: string;
  empty: string;
}

const STRINGS_ZH: WorkspaceTabMoveStrings = {
  menuLabel: "挪到其他 Workspace…",
  title: "挪动到 Workspace",
  hint: "会话仍在原目录继续运行",
  empty: "没有其它 Workspace 可选",
};

const STRINGS_EN: WorkspaceTabMoveStrings = {
  menuLabel: "Move to workspace…",
  title: "Move tab to workspace",
  hint: "The agent keeps running in its original directory.",
  empty: "No other workspace available",
};

export function resolveWorkspaceTabMoveStrings(
  language: string | null | undefined,
): WorkspaceTabMoveStrings {
  return (language ?? "").toLowerCase().startsWith("zh") ? STRINGS_ZH : STRINGS_EN;
}

export interface WorkspaceTabMoveWorkspace {
  /** Persistence key from `buildWorkspaceTabPersistenceKey`. */
  workspaceKey: string;
  workspaceId: string;
  /** Sidebar project header: `projectCustomName ?? projectDisplayName ?? derived`. */
  projectName: string;
  name: string;
  currentBranch: string | null;
  /** Sidebar meta label: `worktreeSlug ?? shortenPath(workspaceDirectory)`. */
  workspaceDirectoryLabel: string;
  archiving: boolean;
}

export interface WorkspaceTabMoveSource {
  workspaceKey: string;
}

export interface WorkspaceTabMoveStore {
  openTab(input: {
    workspaceKey: string;
    target: WorkspaceTabTarget;
    intent: "reveal";
    pin: true;
  }): string | null;
  closeTab(workspaceKey: string, tabId: string): void;
  unpinAgent(workspaceKey: string, agentId: string): void;
  hideAgent(workspaceKey: string, agentId: string): void;
}

/** Mirrors `resolveSidebarWorkspacePrimaryLabel`. */
export function resolveWorkspaceTabMoveRowLabel(input: {
  workspace: { name: string; currentBranch: string | null };
  titleSource: WorkspaceTabMoveTitleSource;
}): string {
  if (input.titleSource === "branch") {
    return input.workspace.currentBranch ?? input.workspace.name;
  }
  return input.workspace.name;
}

export interface WorkspaceTabMoveGroup {
  projectName: string;
  workspaces: WorkspaceTabMoveWorkspace[];
}

/** Groups targets by project name, preserving the sidebar's first-seen order. */
export function groupWorkspaceTabMoveTargets(
  workspaces: readonly WorkspaceTabMoveWorkspace[],
): WorkspaceTabMoveGroup[] {
  const groups: WorkspaceTabMoveGroup[] = [];
  const byProject = new Map<string, WorkspaceTabMoveGroup>();
  for (const workspace of workspaces) {
    let group = byProject.get(workspace.projectName);
    if (!group) {
      group = { projectName: workspace.projectName, workspaces: [] };
      byProject.set(workspace.projectName, group);
      groups.push(group);
    }
    group.workspaces.push(workspace);
  }
  return groups;
}

export function resolveWorkspaceTabMoveSource(input: {
  tabId: string;
  layouts: ReadonlyArray<{ workspaceKey: string; tabIds: readonly string[] }>;
}): WorkspaceTabMoveSource | null {
  const tabId = input.tabId.trim();
  if (!tabId) {
    return null;
  }
  for (const layout of input.layouts) {
    if (layout.tabIds.includes(tabId)) {
      return { workspaceKey: layout.workspaceKey };
    }
  }
  return null;
}

export function listWorkspaceTabMoveTargets(input: {
  sourceWorkspaceKey: string;
  workspaces: readonly WorkspaceTabMoveWorkspace[];
}): WorkspaceTabMoveWorkspace[] {
  return input.workspaces.filter(
    (workspace) =>
      workspace.workspaceKey !== input.sourceWorkspaceKey &&
      !workspace.archiving &&
      Boolean(workspace.workspaceKey.trim()),
  );
}

export function buildMoveToWorkspaceMenuEntry(input: {
  tab: WorkspaceTab;
  onSelect: (tab: WorkspaceTab) => void;
  strings: WorkspaceTabMoveStrings;
}): WorkspaceTabMenuEntry | null {
  if (input.tab.target.kind !== "agent") {
    return null;
  }
  return {
    kind: "item",
    key: MOVE_TO_WORKSPACE_MENU_KEY,
    label: input.strings.menuLabel,
    testID: MOVE_TO_WORKSPACE_MENU_KEY,
    onSelect: () => {
      input.onSelect(input.tab);
    },
  };
}

/**
 * Inserts the move entry directly before the close group ("close-before"), or
 * appends it when that group is absent. Non-agent tabs are returned unchanged,
 * and an existing move entry is never duplicated.
 */
export function insertMoveToWorkspaceMenuEntry(input: {
  entries: readonly WorkspaceTabMenuEntry[];
  tab: WorkspaceTab;
  onSelect: (tab: WorkspaceTab) => void;
  strings: WorkspaceTabMoveStrings;
}): WorkspaceTabMenuEntry[] {
  const entry = buildMoveToWorkspaceMenuEntry(input);
  if (!entry) {
    return [...input.entries];
  }
  const entries = [...input.entries];
  if (entries.some((candidate) => candidate.key === MOVE_TO_WORKSPACE_MENU_KEY)) {
    return entries;
  }
  const closeGroupIndex = entries.findIndex((candidate) => candidate.key === "close-before");
  if (closeGroupIndex === -1) {
    entries.push(entry);
    return entries;
  }
  entries.splice(closeGroupIndex, 0, entry);
  return entries;
}

export function moveWorkspaceTab(
  deps: { store: WorkspaceTabMoveStore },
  input: {
    sourceWorkspaceKey: string;
    targetWorkspaceKey: string;
    tabId: string;
    target: WorkspaceTabTarget;
  },
): boolean {
  const sourceWorkspaceKey = input.sourceWorkspaceKey.trim();
  const targetWorkspaceKey = input.targetWorkspaceKey.trim();
  const tabId = input.tabId.trim();
  if (!sourceWorkspaceKey || !targetWorkspaceKey || !tabId) {
    return false;
  }
  if (sourceWorkspaceKey === targetWorkspaceKey) {
    return false;
  }
  if (input.target.kind !== "agent") {
    return false;
  }
  const { agentId } = input.target;
  const opened = deps.store.openTab({
    workspaceKey: targetWorkspaceKey,
    target: { kind: "agent", agentId },
    intent: "reveal",
    pin: true,
  });
  if (!opened) {
    return false;
  }
  deps.store.unpinAgent(sourceWorkspaceKey, agentId);
  deps.store.hideAgent(sourceWorkspaceKey, agentId);
  deps.store.closeTab(sourceWorkspaceKey, tabId);
  return true;
}
