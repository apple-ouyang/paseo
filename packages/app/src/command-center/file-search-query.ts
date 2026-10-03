import { isAbsolutePath, isHomeRelativePath, isPathWithinRoot } from "@/utils/path";

/**
 * A `getDirectorySuggestions` call the daemon can answer for a path the user typed outside the
 * active workspace. The daemon takes a root plus a query relative to that root, and a workspace is
 * the only root it already knows about — so opening `/Users/me/diagrams/x.html` from a workspace at
 * `~/code/app` has to borrow the typed path's own directory as the root.
 */
export interface DaemonFileSearchRequest {
  /** Directory the daemon searches under. */
  cwd: string;
  /** Query to run inside that directory. */
  query: string;
  /** Prefix that turns a suggested path back into the path the user is opening. */
  root: string;
}

const TRAILING_SEPARATORS = /\/+$/;

/**
 * Plans a re-rooted search for an absolute or `~`-relative query, or null when the active workspace
 * already answers it. Absolute queries inside the workspace stay untouched: the daemon resolves
 * those itself and returns workspace-relative paths, which is what file rows and tabs expect.
 */
export function planDaemonFileSearchRequest(input: {
  query: string;
  workspaceRoot?: string | null;
}): DaemonFileSearchRequest | null {
  const query = input.query.trim().replace(/\\/g, "/");
  if (!query) {
    return null;
  }
  const homeRelative = isHomeRelativePath(query);
  if (!homeRelative && !isAbsolutePath(query)) {
    return null;
  }
  const workspaceRoot = input.workspaceRoot?.trim().replace(/\\/g, "/") ?? "";
  if (!homeRelative && workspaceRoot && isPathWithinRoot(query, workspaceRoot)) {
    return null;
  }

  const browsed = query.replace(TRAILING_SEPARATORS, "");
  if (!browsed || browsed === "~") {
    const cwd = browsed || "/";
    return { cwd, query: "", root: cwd };
  }
  if (TRAILING_SEPARATORS.test(query)) {
    return { cwd: browsed, query: "", root: browsed };
  }

  const separator = browsed.lastIndexOf("/");
  let parent = homeRelative ? "~" : "/";
  if (separator > 0) {
    parent = browsed.slice(0, separator);
  }
  const cwd = /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
  return { cwd, query: browsed.slice(separator + 1), root: cwd };
}

/** Rebuilds an openable path from a suggestion the daemon returned relative to `root`. */
export function resolveSuggestedFilePath(input: { root: string; path: string }): string {
  const relative = input.path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!relative || relative === ".") {
    return input.root;
  }
  return input.root.endsWith("/") ? `${input.root}${relative}` : `${input.root}/${relative}`;
}
