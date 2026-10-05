import { describe, expect, it } from "vitest";
import { resolveLinkMenuTarget } from "./link-menu-target";

describe("resolveLinkMenuTarget", () => {
  it("routes web links to the web menu", () => {
    expect(
      resolveLinkMenuTarget({
        kind: "resolved",
        value: { kind: "external", url: "https://example.com/x" },
      }),
    ).toEqual({ kind: "external", url: "https://example.com/x" });
  });

  it("routes resolved file links to the file menu", () => {
    expect(
      resolveLinkMenuTarget({
        kind: "resolved",
        value: { kind: "file", target: { raw: "REPORT.md", path: "REPORT.md" } },
      }),
    ).toEqual({ kind: "file", path: "REPORT.md" });
  });

  it("leaves ignored and lookup-pending links on the plain menu", () => {
    expect(resolveLinkMenuTarget({ kind: "resolved", value: { kind: "ignored" } })).toBeNull();
    expect(
      resolveLinkMenuTarget({
        kind: "needsLookup",
        ambiguousQuery: "report.md",
        token: "report.md",
        target: { raw: "report.md", path: "report.md" },
      }),
    ).toBeNull();
  });
});
