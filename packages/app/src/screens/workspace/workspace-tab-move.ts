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
 */
export const MOVE_TO_WORKSPACE_MENU_KEY = "move-to-workspace";
export const MOVE_TO_WORKSPACE_LABEL = "Move to workspace…";

export interface WorkspaceTabMoveWorkspace {
  /** Persistence key from `buildWorkspaceTabPersistenceKey`. */
  workspaceKey: string;
  workspaceId: string;
  name: string;
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

export function buildWorkspaceDisplayName(workspace: {
  title?: string | null;
  name?: string | null;
  workspaceDirectory?: string | null;
}): string {
  const title = workspace.title?.trim();
  if (title) {
    return title;
  }
  const name = workspace.name?.trim();
  if (name) {
    return name;
  }
  const directory = workspace.workspaceDirectory?.trim() ?? "";
  if (!directory) {
    return "";
  }
  const segments = directory.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? directory;
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
}): WorkspaceTabMenuEntry | null {
  if (input.tab.target.kind !== "agent") {
    return null;
  }
  return {
    kind: "item",
    key: MOVE_TO_WORKSPACE_MENU_KEY,
    label: MOVE_TO_WORKSPACE_LABEL,
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
