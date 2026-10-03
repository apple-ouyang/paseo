import { test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  openOverflowingWorkspaceTabs,
  panWorkspaceTabsWithWheel,
} from "../support/helpers/workspace-tabs-wheel-scroll";

test("a vertical mouse wheel pans the overflowing workspace tab strip", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "workspace-tabs-wheel-" });
  try {
    await openOverflowingWorkspaceTabs(page, workspace.workspaceId);
    await panWorkspaceTabsWithWheel(page);
  } finally {
    await workspace.cleanup();
  }
});
