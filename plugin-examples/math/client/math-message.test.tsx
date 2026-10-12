/**
 * @vitest-environment jsdom
 */
import { prettyDOM, render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { describe, expect, it } from "vitest";
import { MathMessage, mathMessageSchema } from "./math-message";

const theme = {
  colors: { foreground: "rgb(230, 230, 230)" },
} as unknown as Parameters<typeof MathMessage>[0]["theme"];

const host = { id: "local", label: "Local" };
const layout = { compact: false, platform: "web" } as const;
const timestamp = new Date(0);

function Message({ segments }: { segments: unknown[] }) {
  const data = useMemo(() => mathMessageSchema.parse({ segments }), [segments]);
  const item = useMemo(
    () => ({ type: "plugin" as const, kind: "math-message", version: 1, data }),
    [data],
  );
  return (
    <MathMessage
      agentId="agent-1"
      item={item}
      timestamp={timestamp}
      theme={theme}
      host={host}
      layout={layout}
    />
  );
}

// `prettyDOM` keeps the assertions off DOM property access, which this package
// typechecks without the DOM library.
function renderMessage(segments: unknown[]) {
  return (
    prettyDOM(render(<Message segments={segments} />).container, undefined, {
      highlight: false,
    }) ?? ""
  );
}

describe("math timeline renderer", () => {
  it("typesets math and keeps the surrounding text", () => {
    const markup = renderMessage([
      { kind: "text", text: "Budget: " },
      { kind: "math", tex: "\\frac{a}{b}", display: false },
    ]);

    expect(screen.getByText(/Budget:/)).toBeTruthy();
    expect(markup).toContain("<math");
    expect(markup).toContain('encoding="application/x-tex"');
    expect(markup).toContain("\\frac{a}{b}");
  });

  it("typesets display math", () => {
    expect(renderMessage([{ kind: "math", tex: "x^2", display: true }])).toContain("<math");
  });

  it("falls back to the delimited source when KaTeX rejects the formula", () => {
    const markup = renderMessage([{ kind: "math", tex: "\\frac{", display: false }]);

    expect(markup).not.toContain("<math");
    expect(screen.getByText("$\\frac{$")).toBeTruthy();
  });
});
