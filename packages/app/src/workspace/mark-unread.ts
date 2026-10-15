import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { findPaneById, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

/** Magic label consumed by the daemon `update_agent_request` interceptor. */
export const MARK_AGENT_UNREAD_LABEL = "paseo.markUnread";

export type AgentTabAttentionAction = "unread" | "read";

interface AgentTabAttentionSnapshot {
  status?: string | null;
  requiresAttention?: boolean | null;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissions?: { length: number } | { size: number } | null;
  archivedAt?: Date | string | null;
}

export function resolveAgentTabAttentionAction(
  agent: AgentTabAttentionSnapshot | null | undefined,
): AgentTabAttentionAction | null {
  if (!agent || agent.archivedAt) {
    return null;
  }
  const pending = agent.pendingPermissions;
  const pendingCount =
    pending == null ? 0 : "length" in pending ? pending.length : pending.size;
  if (pendingCount > 0) {
    return null;
  }
  if (agent.requiresAttention === true) {
    if (agent.attentionReason === "finished" || agent.attentionReason === "error") {
      return "read";
    }
    return null;
  }
  if (agent.status === "idle" || agent.status === "closed") {
    return "unread";
  }
  return null;
}

export async function markAgentTabUnread(input: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  tabId: string;
}): Promise<void> {
  const client = getHostRuntimeStore().getClient(input.serverId);
  if (!client) {
    throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
  }

  const workspaceKey = `${input.serverId}:${input.workspaceId}`;
  const layout = useWorkspaceLayoutStore.getState();
  const workspaceLayout = layout.layoutByWorkspace[workspaceKey];
  const focusedPane = workspaceLayout?.focusedPaneId
    ? findPaneById(workspaceLayout.root, workspaceLayout.focusedPaneId)
    : null;
  const isFocusedTab = focusedPane?.focusedTabId === input.tabId;
  // End viewing before restoring attention so agent-blur does not consume the mark.
  const focusToken = isFocusedTab ? layout.unfocusPane(workspaceKey) : null;
  try {
    await client.updateAgent(input.agentId, { labels: { [MARK_AGENT_UNREAD_LABEL]: "1" } });
  } catch (error) {
    if (focusToken) {
      layout.restorePaneFocus(workspaceKey, focusToken);
    }
    throw error;
  }
}

export async function markAgentTabRead(serverId: string, agentId: string): Promise<void> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
  }
  await client.clearAgentAttention(agentId);
}

export async function markWorkspaceUnread(serverId: string, workspaceId: string): Promise<void> {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) {
    throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
  }

  const workspaceKey = `${serverId}:${workspaceId}`;
  const layout = useWorkspaceLayoutStore.getState();
  // End viewing before restoring attention. The next pane focus reads it normally;
  // leaving the workspace must not consume the mark the user just made.
  const focusToken = layout.layoutByWorkspace[workspaceKey]?.focusedPaneId
    ? layout.unfocusPane(workspaceKey)
    : null;
  try {
    await client.markWorkspaceUnread(workspaceId);
  } catch (error) {
    if (focusToken) {
      layout.restorePaneFocus(workspaceKey, focusToken);
    }
    throw error;
  }
}
