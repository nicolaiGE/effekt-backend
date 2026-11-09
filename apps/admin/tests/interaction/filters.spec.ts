import { expect, test } from "@playwright/test";

// Every entry in "Add filter" must open that filter's editor and survive the menu closing.
// Opening the editor while the menu was still closing used to dismiss it at random.
for (const path of ["/design/list", "/design/components"]) {
  test(`every Add filter entry opens its editor on ${path}`, async ({ page }) => {
    await page.goto(path);
    const addFilter = page.getByRole("button", { name: /^(add filter|filter)$/i }).first();
    await addFilter.click();
    const names = await page.getByRole("menuitem").allInnerTexts();
    await page.keyboard.press("Escape");
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      await addFilter.click();
      await page.getByRole("menuitem", { name, exact: true }).click();
      const editor = page.getByRole("dialog", { name: `${name} filter` });
      await expect(editor, `${name} editor`).toBeVisible();
      // Give a late dismissal a chance to happen before checking it stayed open
      await page.waitForTimeout(250);
      await expect(editor, `${name} editor stays open`).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(editor).toBeHidden();
    }
  });
}

test("picking an option keeps the chip and puts the filter in the URL", async ({ page }) => {
  await page.goto("/design/list");
  await page
    .getByRole("button", { name: /^(add filter|filter)$/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Payment method", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Payment method filter" });
  await editor.getByRole("listitem").first().getByRole("checkbox").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-slot=filter-chip][data-field=method]")).toBeVisible();
  await expect(page).toHaveURL(/[?&]method=/);
});

// "All except one" is the common case: select all, then untick the one to leave out.
test("select all ticks every option and unticking one leaves the rest", async ({ page }) => {
  await page.goto("/design/list");
  await page
    .getByRole("button", { name: /^(add filter|filter)$/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Payment method", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Payment method filter" });
  const options = editor.getByRole("listitem").getByRole("checkbox");
  const selectAll = editor.getByRole("checkbox", { name: "Select all" });
  const chip = page.locator("[data-slot=filter-chip][data-field=method]");

  await selectAll.click();
  for (const option of await options.all()) await expect(option).toBeChecked();
  await expect(chip).toContainText("All");

  const first = editor.getByRole("listitem").first();
  const name = await first.innerText();
  await first.getByRole("checkbox").click();
  await expect(selectAll).toHaveAttribute("data-state", "indeterminate");
  await expect(chip).toContainText(`All except ${name.split("\n")[0].trim()}`);

  // Ticking it again goes back to all; once more clears the filter
  await selectAll.click();
  await expect(selectAll).toBeChecked();
  await selectAll.click();
  for (const option of await options.all()) await expect(option).not.toBeChecked();
});
