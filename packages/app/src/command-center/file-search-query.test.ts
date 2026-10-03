import { describe, expect, it } from "vitest";
import { planDaemonFileSearchRequest, resolveSuggestedFilePath } from "./file-search-query";

describe("planDaemonFileSearchRequest", () => {
  it("leaves workspace-relative queries to the daemon", () => {
    expect(
      planDaemonFileSearchRequest({
        query: "src/components/message.tsx",
        workspaceRoot: "/code/app",
      }),
    ).toBeNull();
    expect(planDaemonFileSearchRequest({ query: "", workspaceRoot: "/code/app" })).toBeNull();
  });

  it("leaves absolute queries inside the workspace to the daemon", () => {
    expect(
      planDaemonFileSearchRequest({
        query: "/code/app/src/index.ts",
        workspaceRoot: "/code/app",
      }),
    ).toBeNull();
    expect(
      planDaemonFileSearchRequest({ query: "/code/app", workspaceRoot: "/code/app" }),
    ).toBeNull();
  });

  it("re-roots an absolute file path onto its own directory", () => {
    expect(
      planDaemonFileSearchRequest({
        query: "/Users/me/.agent/diagrams/plan.html",
        workspaceRoot: "/code/app",
      }),
    ).toEqual({
      cwd: "/Users/me/.agent/diagrams",
      query: "plan.html",
      root: "/Users/me/.agent/diagrams",
    });
  });

  it("browses the typed directory itself when the query ends with a separator", () => {
    expect(
      planDaemonFileSearchRequest({
        query: "/Users/me/.agent/diagrams/",
        workspaceRoot: "/code/app",
      }),
    ).toEqual({
      cwd: "/Users/me/.agent/diagrams",
      query: "",
      root: "/Users/me/.agent/diagrams",
    });
    expect(planDaemonFileSearchRequest({ query: "/", workspaceRoot: "/code/app" })).toEqual({
      cwd: "/",
      query: "",
      root: "/",
    });
  });

  it("treats a home-relative path as its own root", () => {
    expect(planDaemonFileSearchRequest({ query: "~/.agent/diagrams/plan.html" })).toEqual({
      cwd: "~/.agent/diagrams",
      query: "plan.html",
      root: "~/.agent/diagrams",
    });
    expect(planDaemonFileSearchRequest({ query: "~/", workspaceRoot: "/code/app" })).toEqual({
      cwd: "~",
      query: "",
      root: "~",
    });
  });

  it("keeps a home-relative path even when the workspace is the home directory", () => {
    expect(
      planDaemonFileSearchRequest({ query: "~/notes/todo.md", workspaceRoot: "/Users/me" }),
    ).toEqual({ cwd: "~/notes", query: "todo.md", root: "~/notes" });
  });

  it("normalizes Windows separators and drive-letter roots", () => {
    expect(
      planDaemonFileSearchRequest({
        query: "C:\\Users\\me\\plan.html",
        workspaceRoot: "C:\\code\\app",
      }),
    ).toEqual({ cwd: "C:/Users/me", query: "plan.html", root: "C:/Users/me" });
    expect(
      planDaemonFileSearchRequest({ query: "C:/plan.html", workspaceRoot: "C:/code/app" }),
    ).toEqual({ cwd: "C:/", query: "plan.html", root: "C:/" });
  });

  it("re-roots a query with no workspace root to compare against", () => {
    expect(planDaemonFileSearchRequest({ query: "/tmp/notes.md" })).toEqual({
      cwd: "/tmp",
      query: "notes.md",
      root: "/tmp",
    });
  });
});

describe("resolveSuggestedFilePath", () => {
  it("re-attaches the search root to a relative suggestion", () => {
    expect(resolveSuggestedFilePath({ root: "/Users/me/.agent/diagrams", path: "plan.html" })).toBe(
      "/Users/me/.agent/diagrams/plan.html",
    );
    expect(resolveSuggestedFilePath({ root: "/", path: "tmp/notes.md" })).toBe("/tmp/notes.md");
    expect(resolveSuggestedFilePath({ root: "~", path: "notes/todo.md" })).toBe("~/notes/todo.md");
    expect(resolveSuggestedFilePath({ root: "C:/", path: "tmp/notes.md" })).toBe("C:/tmp/notes.md");
  });

  it("keeps the root when the suggestion points at the root itself", () => {
    expect(resolveSuggestedFilePath({ root: "/tmp", path: "." })).toBe("/tmp");
    expect(resolveSuggestedFilePath({ root: "/tmp", path: "" })).toBe("/tmp");
  });

  it("normalizes separators in the suggestion", () => {
    expect(resolveSuggestedFilePath({ root: "/tmp", path: "deep\\notes.md" })).toBe(
      "/tmp/deep/notes.md",
    );
  });
});
