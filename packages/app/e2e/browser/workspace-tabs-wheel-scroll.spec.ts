import { test } from "../support/fixtures";
import { exerciseWorkspaceTabsWheelScroll } from "../support/helpers/workspace-tabs-wheel-scroll";

test("a vertical mouse wheel pans the overflowing workspace tab strip", async ({ page }) => {
  await exerciseWorkspaceTabsWheelScroll(page);
});
