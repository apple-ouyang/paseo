import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoWorkspace, pressNewTabShortcut } from "../support/helpers/launcher";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";

// Drag a tab chip onto a sidebar workspace row. Two things used to be wrong:
// the drop label ("Move to workspace…") appeared while the pointer was still
// only reordering inside the strip, and the blue drop frame was painted with an
// inline `outline` on the row, which the sidebar's own re-render wiped mid-drag.
// Both affordances are now fixed overlays and gate on a valid drop target.

const VIEWPORT = { width: 1200, height: 820 };

test("tab drag labels and frames only the sidebar workspace it can move to", async ({ page }) => {
  const source = await seedWorkspace({ repoPrefix: "tab-move-drag-source-" });
  const target = await seedWorkspace({ repoPrefix: "tab-move-drag-target-" });
  try {
    const agent = await source.client.createAgent({
      provider: "mock",
      cwd: source.repoPath,
      workspaceId: source.workspaceId,
      title: "Movable agent",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    await page.setViewportSize(VIEWPORT);
    await gotoWorkspace(page, source.workspaceId);

    const tab = page
      .locator(`[data-testid="workspace-tab-agent_${agent.id}"]`)
      .filter({ visible: true })
      .first();
    await expect(tab).toBeVisible({ timeout: 30_000 });
    const tabBox = await tab.boundingBox();
    if (!tabBox) throw new Error("tab has no box");

    const row = page
      .locator(`[data-testid="sidebar-workspace-row-${getServerId()}:${target.workspaceId}"]`)
      .filter({ visible: true })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const rowBox = await row.boundingBox();
    if (!rowBox) throw new Error("workspace row has no box");

    const ghost = page.getByTestId("workspace-tab-move-ghost");
    const highlight = page.getByTestId("workspace-tab-move-highlight");
    const startX = tabBox.x + 24;
    const startY = tabBox.y + tabBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Reordering inside the strip must not offer a workspace move.
    await page.mouse.move(startX - 48, startY, { steps: 6 });
    await expect(ghost).toHaveCount(0);
    await expect(highlight).toHaveCount(0);

    // Crossing into the sidebar without a row under the pointer stays silent.
    await page.mouse.move(140, startY, { steps: 6 });
    await expect(ghost).toHaveCount(0);
    await expect(highlight).toHaveCount(0);

    // Over a valid workspace row both affordances appear.
    const rowY = rowBox.y + rowBox.height / 2;
    await page.mouse.move(rowBox.x + 30, rowY, { steps: 8 });
    await expect(ghost).toBeVisible();
    await expect(highlight).toBeVisible();

    // Keep nudging inside the row: the frame must survive the sidebar re-render
    // instead of flashing once and being dropped.
    for (let step = 1; step <= 4; step += 1) {
      await page.mouse.move(rowBox.x + 30 + step, rowY + step);
      await expect(highlight).toBeVisible();
    }

    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
    await expect(highlight).toHaveCount(0);
    // The tab left its source workspace.
    await expect(page.locator(`[data-testid="workspace-tab-agent_${agent.id}"]`)).toHaveCount(0);
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});

test("a non-agent tab never offers a workspace move", async ({ page }) => {
  const source = await seedWorkspace({ repoPrefix: "tab-move-drag-plain-" });
  const target = await seedWorkspace({ repoPrefix: "tab-move-drag-plain-target-" });
  try {
    await page.setViewportSize(VIEWPORT);
    await gotoWorkspace(page, source.workspaceId);
    await pressNewTabShortcut(page);

    const tab = page
      .locator('[data-testid^="workspace-tab-"]:not([data-testid^="workspace-tab-context-"])')
      .filter({ visible: true })
      .first();
    await expect(tab).toBeVisible({ timeout: 30_000 });
    const tabBox = await tab.boundingBox();
    if (!tabBox) throw new Error("tab has no box");

    const row = page
      .locator(`[data-testid="sidebar-workspace-row-${getServerId()}:${target.workspaceId}"]`)
      .filter({ visible: true })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const rowBox = await row.boundingBox();
    if (!rowBox) throw new Error("workspace row has no box");

    await page.mouse.move(tabBox.x + 24, tabBox.y + tabBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rowBox.x + 30, rowBox.y + rowBox.height / 2, { steps: 12 });
    await expect(page.getByTestId("workspace-tab-move-ghost")).toHaveCount(0);
    await expect(page.getByTestId("workspace-tab-move-highlight")).toHaveCount(0);
    await page.mouse.up();
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});
