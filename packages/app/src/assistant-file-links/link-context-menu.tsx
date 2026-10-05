import { useCallback, useMemo, type ReactNode } from "react";
import type { ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { AppWindow, Copy, ExternalLink, FolderOpen, Globe } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { usePaneContext } from "@/panels/pane-context";
import type { Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import { useAssistantFileLinkResolverContext } from "./provider";
import { classifyForResolution } from "./resolver";
import type { AssistantFileLinkSource } from "./resolver";
import { resolveLinkMenuTarget } from "./link-menu-target";

const ThemedAppWindow = withUnistyles(AppWindow);
const ThemedGlobe = withUnistyles(Globe);
const ThemedCopy = withUnistyles(Copy);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const LEADING_SIZE = 15;

export function LinkContextMenu({
  source,
  children,
}: {
  source: AssistantFileLinkSource;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const pane = usePaneContext();
  const { configRef } = useAssistantFileLinkResolverContext();
  const workspaceRoot = configRef.current.workspaceRoot ?? "";
  const serverId = configRef.current.serverId ?? "";
  const resolution = useMemo(
    () => classifyForResolution(source, { workspaceRoot }),
    [source, workspaceRoot],
  );
  const target = useMemo(() => resolveLinkMenuTarget(resolution), [resolution]);
  // Precomputed so the menu items pass elements, not inline JSX props.
  const leading = useMemo(
    () => ({
      paseo: <ThemedAppWindow size={LEADING_SIZE} uniProps={mutedColorMapping} />,
      browser: <ThemedGlobe size={LEADING_SIZE} uniProps={mutedColorMapping} />,
      copy: <ThemedCopy size={LEADING_SIZE} uniProps={mutedColorMapping} />,
      defaultApp: <ThemedExternalLink size={LEADING_SIZE} uniProps={mutedColorMapping} />,
      reveal: <ThemedFolderOpen size={LEADING_SIZE} uniProps={mutedColorMapping} />,
    }),
    [],
  );
  const isLocalExecution = useIsLocalDaemon(serverId);
  const { targets } = useDesktopOpenTargets({ isLocalExecution });
  const fileManagerTarget = useMemo(
    () => targets.find((candidate) => candidate.kind === "file-manager") ?? null,
    [targets],
  );
  const absolutePath = useMemo(() => {
    if (target?.kind !== "file") {
      return null;
    }
    if (!workspaceRoot) {
      return target.path;
    }
    return (
      resolveWorkspaceFilePaths({ path: target.path, workspaceRoot })?.absolutePath ?? target.path
    );
  }, [target, workspaceRoot]);

  const openInPaseo = useCallback(() => {
    if (target?.kind !== "external") return;
    const { browserId } = createWorkspaceBrowser({ initialUrl: target.url });
    pane.openTab({ kind: "browser", browserId });
  }, [pane, target]);

  const openInBrowser = useCallback(() => {
    if (target?.kind !== "external") return;
    void openExternalUrl(target.url);
  }, [target]);

  const copyFilePath = useCallback(() => {
    if (!absolutePath) return;
    void Clipboard.setStringAsync(absolutePath)
      .then(() => toast.copied(t("workspace.tabs.toasts.filePathCopiedLabel")))
      .catch(() => toast.error(t("workspace.tabs.toasts.copyFailed")));
  }, [absolutePath, t, toast]);

  const runFileAction = useCallback(
    (action: (fileManagerId: string, path: string) => Promise<void>) => {
      if (!fileManagerTarget || !absolutePath) return;
      void action(fileManagerTarget.id, absolutePath).catch((cause: unknown) => {
        toast.error(
          cause instanceof Error ? cause.message : t("workspace.fileExplorer.errors.revealFailed"),
        );
      });
    },
    [absolutePath, fileManagerTarget, t, toast],
  );

  const openWithDefaultApp = useCallback(() => {
    runFileAction((editorId, path) => openDesktopTarget({ editorId, workspacePath: path }));
  }, [runFileAction]);

  const revealInFileManager = useCallback(() => {
    runFileAction((editorId, path) =>
      openDesktopTarget({
        editorId,
        workspacePath: path.slice(0, path.lastIndexOf("/")) || "/",
        filePath: path,
      }),
    );
  }, [runFileAction]);

  if (!target) {
    return children;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger contextOnly style={LINK_MENU_TRIGGER_STYLE}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" width={240}>
        {target.kind === "external" ? (
          <>
            <ContextMenuItem
              testID="link-menu-open-in-paseo"
              leading={leading.paseo}
              onSelect={openInPaseo}
            >
              {t("agentStream.linkMenu.openInPaseo")}
            </ContextMenuItem>
            <ContextMenuItem
              testID="link-menu-open-in-browser"
              leading={leading.browser}
              onSelect={openInBrowser}
            >
              {t("agentStream.linkMenu.openInBrowser")}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem
              testID="link-menu-copy-path"
              leading={leading.copy}
              onSelect={copyFilePath}
            >
              {t("agentStream.linkMenu.copyFilePath")}
            </ContextMenuItem>
            <ContextMenuItem
              testID="link-menu-open-with-default-app"
              leading={leading.defaultApp}
              disabled={!fileManagerTarget}
              onSelect={openWithDefaultApp}
            >
              {t("agentStream.linkMenu.openWithDefaultApp")}
            </ContextMenuItem>
            <ContextMenuItem
              testID="link-menu-reveal-in-file-manager"
              leading={leading.reveal}
              disabled={!fileManagerTarget}
              onSelect={revealInFileManager}
            >
              {t("agentStream.linkMenu.revealIn", {
                target: fileManagerTarget?.label ?? t("agentStream.linkMenu.fileManagerFallback"),
              })}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// RN doesn't type "inline-flex"; RN-web honors it at runtime, which keeps the
// context-menu wrapper from breaking inline link flow (same trick as the
// file-link tooltip trigger).
const LINK_MENU_TRIGGER_STYLE: ViewStyle = {
  display: "inline-flex" as ViewStyle["display"],
};
