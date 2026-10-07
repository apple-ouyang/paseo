// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PreviewFindModel } from "./preview-model.web";

function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("PreviewFindModel", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = function () {};
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("marks every case-insensitive hit, including several per text node", () => {
    const el = host("<p>Foobar foo FOO</p>");
    const model = new PreviewFindModel(el, { rehighlightDelayMs: 0 });
    model.open();
    model.setSearch("foo");
    expect(el.querySelectorAll("mark.paseo-file-find-hit")).toHaveLength(3);
    expect(model.getSnapshot().total).toBe(3);
    expect(model.getSnapshot().current).toBe(1);
    model.dispose();
  });

  it("keeps the original casing and restores the text on close", () => {
    const el = host("<p>Foobar foo</p>");
    const model = new PreviewFindModel(el, { rehighlightDelayMs: 0 });
    model.open();
    model.setSearch("foo");
    expect(el.textContent).toBe("Foobar foo");
    model.close();
    expect(el.textContent).toBe("Foobar foo");
    expect(el.querySelectorAll("mark")).toHaveLength(0);
    model.dispose();
  });

  it("steps through hits with wrap-around and tracks the current one", () => {
    const el = host("<p>a b a b a</p>");
    const model = new PreviewFindModel(el, { rehighlightDelayMs: 0 });
    model.open();
    model.setSearch("a");
    model.next();
    expect(model.getSnapshot().current).toBe(2);
    model.next();
    model.next();
    expect(model.getSnapshot().current).toBe(1);
    model.previous();
    expect(model.getSnapshot().current).toBe(3);
    const marks = el.querySelectorAll("mark");
    expect(marks[2].className).toContain("paseo-file-find-hit-current");
    model.dispose();
  });

  it("ignores hits inside script, style, and the find widget subtree", () => {
    const el = host(
      '<p>hit</p><script>var hit=1</script><div data-paseo-file-find=""><span>hit</span></div>',
    );
    const model = new PreviewFindModel(el, { rehighlightDelayMs: 0 });
    model.open();
    model.setSearch("hit");
    expect(el.querySelectorAll("mark")).toHaveLength(1);
    model.dispose();
  });

  it("reports the limited flag once the match cap is reached", () => {
    const el = host("<p>x x x x x</p>");
    const model = new PreviewFindModel(el, { matchLimit: 2, rehighlightDelayMs: 0 });
    model.open();
    model.setSearch("x");
    expect(model.getSnapshot().total).toBe(2);
    expect(model.getSnapshot().limited).toBe(true);
    model.dispose();
  });

  it("re-highlights after the host DOM changes under it", async () => {
    const el = host("<p>alpha</p>");
    const model = new PreviewFindModel(el, { rehighlightDelayMs: 0 });
    model.open();
    model.setSearch("beta");
    expect(model.getSnapshot().total).toBe(0);
    const paragraph = document.createElement("p");
    paragraph.textContent = "beta beta";
    el.appendChild(paragraph);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(model.getSnapshot().total).toBe(2);
    model.dispose();
  });
});
