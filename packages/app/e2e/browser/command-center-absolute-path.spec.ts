import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "../support/fixtures";
import { expectFileTabOpen } from "../support/helpers/file-explorer";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import { createTempDirectory } from "../support/helpers/workspace";

const OUTSIDE_FILE_NAME = "outside-plan.md";
const OUTSIDE_FILE_MARKER = "outside-workspace-marker-7f3a";
const HIDDEN_FILE_NAME = ".hidden-plan.md";
const HIDDEN_FILE_MARKER = "hidden-outside-workspace-marker-91c4";

test.use({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/145.0 Safari/537.36",
});

test("file search opens a file named by an absolute path outside the workspace", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-absolute-path-",
    title: "Absolute path file search",
  });
  // The whole point: the file lives nowhere near the workspace the search runs in.
  const outside = await createTempDirectory("paseo-outside-");
  const outsideFile = path.join(outside.path, OUTSIDE_FILE_NAME);
  await writeFile(outsideFile, `# ${OUTSIDE_FILE_MARKER}\n`);

  try {
    await gotoWorkspace(page, seeded.workspaceId);
    await page.keyboard.press("Meta+P");

    const panel = page.getByTestId("command-center-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("command-center-files-scope")).toBeVisible();

    await panel.getByTestId("command-center-input").fill(outsideFile);
    const row = panel.getByRole("button", { name: new RegExp(OUTSIDE_FILE_NAME) }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.click();
    await expectFileTabOpen(page, outsideFile);
    // The tab only proves the click landed; the file content proves the daemon was asked for the
    // right path -- the pane reads paths outside the workspace by rooting the request at "/".
    await expect(page.getByText(OUTSIDE_FILE_MARKER)).toBeVisible({ timeout: 30_000 });
  } finally {
    await seeded.cleanup();
    await outside.cleanup();
  }
});

test("file search resolves a hidden file and a path that leaves through parent segments", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-hidden-path-",
    title: "Hidden and parent-segment file search",
  });
  // A sibling of the workspace directory, so the same file is reachable by absolute path and by a
  // path that starts inside the workspace and steps out with `..`.
  const outsideRoot = path.join(path.dirname(seeded.workspaceDirectory), "paseo-hidden-outside");
  const hiddenFile = path.join(outsideRoot, HIDDEN_FILE_NAME);
  const throughParent = `${seeded.workspaceDirectory}/../${path.basename(outsideRoot)}/${HIDDEN_FILE_NAME}`;
  await mkdir(outsideRoot, { recursive: true });
  await writeFile(hiddenFile, `# ${HIDDEN_FILE_MARKER}\n`);

  try {
    await gotoWorkspace(page, seeded.workspaceId);

    for (const typed of [hiddenFile, throughParent]) {
      await page.keyboard.press("Meta+P");
      const panel = page.getByTestId("command-center-panel");
      await expect(panel).toBeVisible({ timeout: 30_000 });

      await panel.getByTestId("command-center-input").fill(typed);
      // Discovery filters hidden names, so only the named-path lookup can offer this row.
      const row = panel.getByRole("button", { name: new RegExp(HIDDEN_FILE_NAME) }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });

      await row.click();
      await expectFileTabOpen(page, hiddenFile);
      await expect(page.getByText(HIDDEN_FILE_MARKER)).toBeVisible({ timeout: 30_000 });
    }
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
    await seeded.cleanup();
  }
});
