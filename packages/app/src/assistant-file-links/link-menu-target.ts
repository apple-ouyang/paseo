import type { AssistantFileLinkResolution } from "./resolver";

export type LinkMenuTarget =
  | { kind: "external"; url: string }
  | { kind: "file"; path: string }
  | null;

/**
 * Which context menu a link gets. Web links can open inside Paseo or in the
 * default browser; file links can copy their absolute path or hand off to the
 * OS. Links that are neither — or a file that still needs a daemon lookup —
 * keep the plain menu.
 */
export function resolveLinkMenuTarget(resolution: AssistantFileLinkResolution): LinkMenuTarget {
  if (resolution.kind !== "resolved") {
    return null;
  }
  if (resolution.value.kind === "external") {
    return { kind: "external", url: resolution.value.url };
  }
  if (resolution.value.kind === "file") {
    return { kind: "file", path: resolution.value.target.path };
  }
  return null;
}
