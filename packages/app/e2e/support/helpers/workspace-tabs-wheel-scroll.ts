import type { Page } from "@playwright/test";
import { gotoWorkspace, pressNewTabShortcut } from "./launcher";
import { panWorkspaceTabsWithWheel } from "./workspace-tabs";

const OVERFLOWING_TABS_VIEWPORT = { width: 760, height: 800 };
const OVERFLOWING_TABS_COUNT = 12;

/** Open a narrow workspace with enough tabs to exercise the horizontal strip. */
export async function openOverflowingWorkspaceTabs(page: Page, workspaceId: string): Promise<void> {
  await page.setViewportSize(OVERFLOWING_TABS_VIEWPORT);
  await gotoWorkspace(page, workspaceId);

  for (let index = 0; index < OVERFLOWING_TABS_COUNT; index += 1) {
    await pressNewTabShortcut(page);
  }
}

export { panWorkspaceTabsWithWheel };
