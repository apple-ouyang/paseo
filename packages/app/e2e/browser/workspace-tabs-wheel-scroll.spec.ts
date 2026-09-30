import { test } from "../support/fixtures";
import { gotoWorkspace, pressNewTabShortcut } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import { panWorkspaceTabsWithWheel } from "../support/helpers/workspace-tabs";

// The strip keeps every tab at its minimum width once they stop fitting, so a
// narrow-but-desktop viewport reaches the overflow state with a handful of tabs.
const TABS_TO_OPEN = 12;
const VIEWPORT = { width: 760, height: 800 };

test("a vertical mouse wheel pans the overflowing workspace tab strip", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "workspace-tabs-wheel-" });
  try {
    await page.setViewportSize(VIEWPORT);
    await gotoWorkspace(page, workspace.workspaceId);

    for (let index = 0; index < TABS_TO_OPEN; index += 1) {
      await pressNewTabShortcut(page);
    }

    await panWorkspaceTabsWithWheel(page);
  } finally {
    await workspace.cleanup();
  }
});
