import { describe, expect, it } from "vitest";
import { applyViewZoom, reloadActiveBrowserOrWindow, type ViewZoomDirection } from "./menu.js";

class FakeWebContents {
  public readonly reloads: string[] = [];

  public constructor(public readonly id: number) {}

  public isLoadingMainFrame(): boolean {
    return false;
  }

  public stop(): void {
    this.reloads.push("stop");
  }

  public reload(): void {
    this.reloads.push("reload");
  }

  public reloadIgnoringCache(): void {
    this.reloads.push("force-reload");
  }
}

class BrowserReloads {
  public readonly firstWindow = { webContents: new FakeWebContents(101) };
  public readonly secondWindow = { webContents: new FakeWebContents(202) };
  public readonly firstBrowser = new FakeWebContents(11);
  public readonly secondBrowser = new FakeWebContents(22);
  public readonly resolvedHostWindowIds: number[] = [];

  public activeBrowserForHostWindow(hostWebContentsId: number): FakeWebContents | null {
    this.resolvedHostWindowIds.push(hostWebContentsId);
    return hostWebContentsId === 101 ? this.firstBrowser : this.secondBrowser;
  }
}

describe("reloadActiveBrowserOrWindow", () => {
  it("reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.firstWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([101]);
    expect(browserReloads.firstBrowser.reloads).toEqual(["reload"]);
    expect(browserReloads.secondBrowser.reloads).toEqual([]);
    expect(browserReloads.firstWindow.webContents.reloads).toEqual([]);
  });

  it("force reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.secondWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
      ignoreCache: true,
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([202]);
    expect(browserReloads.firstBrowser.reloads).toEqual([]);
    expect(browserReloads.secondBrowser.reloads).toEqual(["force-reload"]);
    expect(browserReloads.secondWindow.webContents.reloads).toEqual([]);
  });
});

class FakeZoomTarget {
  public level = 1;
  public scriptResult: unknown = false;
  public throwScript = false;
  public readonly scripts: Array<{ code: string; userGesture?: boolean }> = [];

  public getZoomLevel(): number {
    return this.level;
  }

  public setZoomLevel(level: number): void {
    this.level = level;
  }

  public executeJavaScript(code: string, userGesture?: boolean): Promise<unknown> {
    this.scripts.push({ code, userGesture });
    if (this.throwScript) {
      return Promise.reject(new Error("script failed"));
    }
    return Promise.resolve(this.scriptResult);
  }
}

describe("applyViewZoom", () => {
  it("keeps the window zoom when the focused terminal handles the chord", async () => {
    const target = new FakeZoomTarget();
    target.scriptResult = true;

    await applyViewZoom(target, "in");

    expect(target.level).toBe(1);
    expect(target.scripts).toEqual([
      {
        code: 'globalThis.paseoConsumeTerminalZoom?.("in") === true',
        userGesture: true,
      },
    ]);
  });

  it.each([
    ["in", 1.5],
    ["out", 0.5],
    ["reset", 0],
  ] as const)("zooms the window when the page does not handle %s", async (direction, level) => {
    const target = new FakeZoomTarget();

    await applyViewZoom(target, direction as ViewZoomDirection);

    expect(target.level).toBe(level);
  });

  it("zooms the window when the page script throws", async () => {
    const target = new FakeZoomTarget();
    target.throwScript = true;

    await applyViewZoom(target, "out");

    expect(target.level).toBe(0.5);
  });
});
