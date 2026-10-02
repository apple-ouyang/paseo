import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { isWeb } from "@/constants/platform";
import { createSidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { useAppSettings } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { darkTheme, REGISTERED_THEMES } from "@/styles/theme";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  groupWorkspaceTabMoveTargets,
  listWorkspaceTabMoveTargets,
  resolveSidebarDropWorkspaceKey,
  SIDEBAR_WORKSPACE_ROW_TESTID_PREFIX,
  type WorkspaceTabMoveWorkspace,
} from "@/screens/workspace/workspace-tab-move";
import {
  findAgentTabByTestIdentity,
  findAgentTabWorkspaceKey,
  moveAgentTabToWorkspace,
} from "@/screens/workspace/workspace-tab-sync";

/**
 * "Move to workspace…" for agent tabs: a sheet listing the same server's
 * workspaces grouped like the sidebar, plus a drag interaction that drops a
 * tab chip onto a sidebar workspace row. Both land on
 * `moveAgentTabToWorkspace`, which writes the placement label and converges
 * every connected client.
 */

const TAB_CHIP_TESTID_PREFIX = "workspace-tab-";
/** Test-id suffixes used by the chip's own sub-elements, never the chip. */
const NON_CHIP_SUFFIXES = ["tooltip-", "modified-", "context-"];

export function useWorkspaceTabMovePicker() {
  const [movingTab, setMovingTab] = useState<WorkspaceTabDescriptor | null>(null);
  const openMovePicker = useCallback((tab: WorkspaceTabDescriptor) => {
    if (tab.target.kind === "agent") {
      setMovingTab(tab);
    }
  }, []);
  const closeMovePicker = useCallback(() => setMovingTab(null), []);
  return { movingTab, openMovePicker, closeMovePicker };
}

function useMoveTargets(
  tab: WorkspaceTabDescriptor | null,
  serverId: string,
): WorkspaceTabMoveWorkspace[] {
  const session = useSessionStore((state) => state.sessions[serverId]);
  return useMemo(() => {
    if (!tab || tab.target.kind !== "agent" || !session) {
      return [];
    }
    const sourceWorkspaceKey = findAgentTabWorkspaceKey(tab.target.agentId);
    if (!sourceWorkspaceKey) {
      return [];
    }
    const workspaces: WorkspaceTabMoveWorkspace[] = [];
    for (const workspace of session.workspaces.values()) {
      const entry = createSidebarWorkspaceEntry({
        serverId,
        workspace,
        workspaceAgentActivity: session.workspaceAgentActivity,
      });
      workspaces.push({
        workspaceKey: entry.workspaceKey,
        workspaceId: entry.workspaceId,
        projectName: entry.projectName,
        name: entry.name,
        currentBranch: entry.currentBranch,
        workspaceDirectoryLabel: entry.workspaceDirectoryLabel,
        archiving: Boolean(entry.archivingAt),
      });
    }
    return listWorkspaceTabMoveTargets({ sourceWorkspaceKey, workspaces });
  }, [session, serverId, tab]);
}

function WorkspaceMoveTargetRow({
  workspace,
  workspaceTitleSource,
  onSelect,
}: {
  workspace: WorkspaceTabMoveWorkspace;
  workspaceTitleSource: "title" | "branch";
  onSelect: (workspace: WorkspaceTabMoveWorkspace) => void;
}) {
  const handlePress = useCallback(() => onSelect(workspace), [onSelect, workspace]);
  const rowStyle = useCallback(
    ({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
      styles.row,
      (pressed || hovered) && styles.rowHovered,
    ],
    [],
  );
  return (
    <Pressable
      style={rowStyle}
      testID={`workspace-tab-move-target-${workspace.workspaceKey}`}
      onPress={handlePress}
    >
      <Text style={styles.rowTitle} numberOfLines={1}>
        {resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource })}
      </Text>
      <Text style={styles.rowSubtitle} numberOfLines={1}>
        {workspace.workspaceDirectoryLabel}
      </Text>
    </Pressable>
  );
}

export function WorkspaceTabMoveSheet({
  tab,
  serverId,
  enabled = true,
  onClose,
}: {
  tab: WorkspaceTabDescriptor | null;
  serverId: string;
  /** Held false while the workspace route is unfocused so the sheet stays shut. */
  enabled?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const activeTab = enabled ? tab : null;
  const targets = useMoveTargets(activeTab, serverId);
  const groups = useMemo(() => groupWorkspaceTabMoveTargets(targets), [targets]);

  const handleSelect = useCallback(
    (workspace: WorkspaceTabMoveWorkspace) => {
      if (!activeTab || activeTab.target.kind !== "agent") {
        onClose();
        return;
      }
      const sourceWorkspaceKey = findAgentTabWorkspaceKey(activeTab.target.agentId);
      if (sourceWorkspaceKey && sourceWorkspaceKey !== workspace.workspaceKey) {
        moveAgentTabToWorkspace({
          serverId,
          sourceWorkspaceKey,
          targetWorkspaceKey: workspace.workspaceKey,
          targetWorkspaceId: workspace.workspaceId,
          agentId: activeTab.target.agentId,
          tabId: activeTab.tabId,
        });
      }
      onClose();
    },
    [onClose, serverId, activeTab],
  );

  const header = useMemo(
    () => ({
      title: t("workspace.tabs.moveSheet.title"),
      subtitle: t("workspace.tabs.moveSheet.hint"),
    }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      visible={activeTab !== null}
      onClose={onClose}
      header={header}
      testID="workspace-tab-move-sheet"
      desktopMaxWidth={420}
    >
      {groups.length === 0 ? (
        <Text style={styles.empty}>{t("workspace.tabs.moveSheet.empty")}</Text>
      ) : (
        <ScrollView>
          {groups.map((group) => (
            <View key={group.projectName} style={styles.group}>
              <Text style={styles.groupTitle}>{group.projectName}</Text>
              {group.workspaces.map((workspace) => (
                <WorkspaceMoveTargetRow
                  key={workspace.workspaceKey}
                  workspace={workspace}
                  workspaceTitleSource={workspaceTitleSource}
                  onSelect={handleSelect}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </AdaptiveModalSheet>
  );
}

/**
 * Drag a tab chip out of the strip and onto a sidebar workspace row to move
 * it there. The app sidebar lives outside the tab strip's dnd-kit context, so
 * this listens at the document level and only takes over after the pointer
 * has traveled — the built-in tab reorder keeps the first few pixels.
 * Web/desktop only; never installs on native.
 */
export function useWorkspaceTabMoveDnd(): void {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!isWeb || typeof document === "undefined") {
      return;
    }
    // Imperative read: the drag ghost/outline are raw DOM mutations, so theme
    // colors are fetched at drag time instead of through a subscription.
    const themeColors = () =>
      (UnistylesRuntime.themeName ? REGISTERED_THEMES[UnistylesRuntime.themeName] : darkTheme)
        .colors;
    let pending: { x: number; y: number; suffix: string } | null = null;
    let ghost: HTMLDivElement | null = null;
    let hoverRow: HTMLElement | null = null;
    let hoverOutline = "";

    const rowAt = (x: number, y: number): HTMLElement | null => {
      let el: Element | null = null;
      try {
        el = document.elementFromPoint(x, y);
      } catch {
        return null;
      }
      return el?.closest?.(`[data-testid^="${SIDEBAR_WORKSPACE_ROW_TESTID_PREFIX}"]`) ?? null;
    };
    const clearHover = () => {
      if (hoverRow) {
        hoverRow.style.outline = hoverOutline;
      }
      hoverRow = null;
    };
    const clearGhost = () => {
      ghost?.parentNode?.removeChild(ghost);
      ghost = null;
    };
    const reset = () => {
      clearHover();
      clearGhost();
      pending = null;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) {
        return;
      }
      const chip = event.target.closest(`[data-testid^="${TAB_CHIP_TESTID_PREFIX}"]`);
      const suffix = chip?.getAttribute("data-testid")?.slice(TAB_CHIP_TESTID_PREFIX.length);
      if (!suffix || NON_CHIP_SUFFIXES.some((prefix) => suffix.startsWith(prefix))) {
        return;
      }
      pending = { x: event.clientX, y: event.clientY, suffix };
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!pending) {
        return;
      }
      const dist = Math.abs(event.clientX - pending.x) + Math.abs(event.clientY - pending.y);
      if (!ghost) {
        if (dist < 8) {
          return;
        }
        const colors = themeColors();
        ghost = document.createElement("div");
        ghost.style.cssText =
          "position:fixed;z-index:2147483001;pointer-events:none;padding:4px 10px;" +
          "border-radius:8px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,0.35);" +
          `background:${colors.surface1};color:${colors.foreground};` +
          `border:1px solid ${colors.border};` +
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
        ghost.textContent = tRef.current("workspace.tabs.menu.moveToWorkspace");
        document.body.appendChild(ghost);
      }
      ghost.style.left = `${event.clientX + 12}px`;
      ghost.style.top = `${event.clientY + 12}px`;
      const row = rowAt(event.clientX, event.clientY);
      if (row !== hoverRow) {
        clearHover();
        if (row) {
          hoverRow = row;
          hoverOutline = row.style.outline;
          row.style.outline = `2px solid ${themeColors().accent}`;
        }
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!pending) {
        return;
      }
      const suffix = pending.suffix;
      const row = ghost ? rowAt(event.clientX, event.clientY) : null;
      reset();
      const targetWorkspaceKey = resolveSidebarDropWorkspaceKey(row?.getAttribute("data-testid"));
      if (!targetWorkspaceKey) {
        return;
      }
      const source = findAgentTabByTestIdentity(suffix);
      if (!source || source.workspaceKey === targetWorkspaceKey) {
        return;
      }
      const separator = targetWorkspaceKey.indexOf(":");
      if (separator <= 0) {
        return;
      }
      moveAgentTabToWorkspace({
        serverId: targetWorkspaceKey.slice(0, separator),
        sourceWorkspaceKey: source.workspaceKey,
        targetWorkspaceKey,
        targetWorkspaceId: targetWorkspaceKey.slice(separator + 1),
        agentId: source.agentId,
        tabId: source.tabId,
      });
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      reset();
    };
  }, []);
}

const styles = StyleSheet.create((theme) => ({
  empty: {
    color: theme.colors.foregroundMuted,
    paddingVertical: theme.spacing[4],
    textAlign: "center",
  },
  group: {
    paddingVertical: theme.spacing[1],
  },
  groupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  row: {
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowTitle: {
    color: theme.colors.foreground,
  },
  rowSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
}));
