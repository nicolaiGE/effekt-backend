import { expect, test, type Page } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";

/**
 * Reports › Tax deduction against a stubbed API: the year, control figures, the deviation lists
 * with donor links and no national IDs, the test-mode notice and the XML download.
 */
const lastYear = new Date().getFullYear() - 1;

const overview = (year: number, difference = "0.00") => ({
  year,
  minSum: 500,
  maximumDeduction: 25000,
  totals: {
    all: "33100.39",
    reported: "31500.10",
    belowMinimum: "599.99",
    withoutTaxUnit: "1000.30",
    difference,
  },
  counts: {
    donations: 40,
    reportedUnits: 3,
    persons: 2,
    organizations: 1,
    belowMinimumUnits: 2,
    aboveMaximum: 1,
  },
  withoutTaxUnit: [
    {
      donorId: 20,
      donationsSum: "1000.30",
      fundraiserSum: "0.00",
      donations: 3,
      taxUnits: 0,
      exclusion: null,
      exclusionLabel: null,
    },
    {
      donorId: 1464,
      donationsSum: "90000.00",
      fundraiserSum: "85000.00",
      donations: 400,
      taxUnits: 0,
      exclusion: "anonymous",
      exclusionLabel: "Anonymous donor",
    },
  ],
  duplicates: [{ reason: "sameNumber", donorIds: [10, 11], taxUnitIds: [1, 2], sum: "500.10" }],
  invalidNumbers: [
    {
      donorIds: [13],
      taxUnitIds: [5],
      problem: "Invalid check digit (national ID)",
      sum: "1000.00",
      reported: true,
    },
  ],
});

type Calls = { overview: unknown[]; notice: unknown[] };

async function open(page: Page, calls: Calls, xmlResult: unknown) {
  await stubAnalysisApi(page, {
    overrides: {
      "reports.tax.overview": (input) => {
        calls.overview.push(input);
        const year = (input as { year: number }).year;
        return overview(year, year === lastYear ? "0.00" : "0.01");
      },
      "reports.tax.missingTaxUnitNotice": (input) => {
        calls.notice.push(input);
        return { total: 2, success: 2, failed: 0, testMode: true };
      },
      "reports.tax.skatteetaten": () => xmlResult,
    },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
  await page.goto("/reports?section=tax-deduction");
}

test("tax deduction: control figures, deviation lists without national IDs, year in the request", async ({
  page,
}) => {
  const calls: Calls = { overview: [], notice: [] };
  await open(page, calls, null);

  await expect(page.getByRole("heading", { name: "Control figures" })).toBeVisible();
  await expect.poll(() => calls.overview[0]).toEqual({ year: lastYear, minSum: 500 });
  await expect(page.getByText("31 500,10 kr")).toBeVisible();
  await expect(page.getByText("Adds up to the øre")).toBeVisible();
  await expect(page.getByRole("table", { name: "Reconciliation" })).toContainText("33 100,39 kr");

  // Only the donors who get the notice by default; the left-out ones say why
  const without = page.getByRole("table", { name: "Donors without tax unit" });
  await expect(without.getByRole("link", { name: "#20" })).toHaveAttribute("href", "/donors/20");
  await expect(without.getByRole("link", { name: "#1464" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Left out (1)" }).click();
  await expect(without.getByRole("row").nth(1)).toContainText("Anonymous donor");
  await expect(without.getByRole("row").nth(1)).toContainText("85 000,00 kr");
  await page.getByRole("radio", { name: "All (2)" }).click();
  await expect(without.getByRole("row")).toHaveCount(3);
  const duplicates = page.getByRole("table", { name: "Possible duplicate donors" });
  await expect(duplicates.getByRole("link", { name: "#10" })).toBeVisible();
  await expect(duplicates.getByRole("link", { name: "#11" })).toBeVisible();
  const invalid = page.getByRole("table", { name: "Invalid numbers" });
  await expect(invalid).toContainText("Invalid check digit (national ID)");
  await expect(invalid).toContainText("Yes, blocks the file");
  await expect(page.getByText("Invalid numbers will stop the file")).toBeVisible();
  // No 9- or 11-digit numbers anywhere on the page
  expect(await page.locator("main").innerText()).not.toMatch(/\b\d{9}(\d{2})?\b/);

  // Another year asks again; a difference is called out
  await page.getByLabel("Gift year").click();
  await page.getByRole("option", { name: String(lastYear - 1) }).click();
  await expect.poll(() => calls.overview.at(-1)).toEqual({ year: lastYear - 1, minSum: 500 });
  await expect(page.getByText("The figures don't add up")).toBeVisible();
});

test("tax deduction: the missing tax unit notice in test mode goes to the test address", async ({
  page,
}) => {
  const calls: Calls = { overview: [], notice: [] };
  await open(page, calls, null);

  await page.getByRole("button", { name: "Send missing tax unit notice" }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog.getByLabel("Test mode")).toBeChecked();
  const send = dialog.getByRole("button", { name: "Send test" });
  await expect(send).toBeDisabled();
  await dialog.getByLabel("Send to").fill("test@example.org");
  await send.click();
  await expect
    .poll(() => calls.notice[0])
    .toEqual({
      year: lastYear,
      minSum: 500,
      testEmail: "test@example.org",
      testLimit: 3,
    });
  await expect(page.getByText("Test sent")).toBeVisible();

  // Real sending needs the year typed
  await page.getByRole("button", { name: "Send missing tax unit notice" }).click();
  await dialog.getByLabel("Test mode").click();
  await expect(dialog).toContainText("1 donor in “Gets the notice” get the email");
  const realSend = dialog.getByRole("button", { name: "Send to donors" });
  await expect(realSend).toBeDisabled();
  // The typed year goes to the API too, which refuses a real send without it
  await dialog.getByLabel(/to confirm/).fill(String(lastYear));
  await realSend.click();
  await expect
    .poll(() => calls.notice[1])
    .toEqual({ year: lastYear, minSum: 500, confirmYear: lastYear });
});

test("tax deduction: the XML needs contact details and the CSV, shows errors and downloads", async ({
  page,
}) => {
  const result = {
    current: {
      file: null,
      errors: [
        {
          kind: "invalidNumber",
          message: "Tax unit 5: Invalid check digit (national ID)",
          donorIds: [13],
        },
      ],
    } as unknown,
  };
  await stubAnalysisApi(page, {
    overrides: {
      "reports.tax.overview": (input) => overview((input as { year: number }).year),
      "reports.tax.skatteetaten": () => result.current,
    },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
  await page.goto("/reports?section=tax-deduction");

  const download = page.getByRole("button", { name: "Download XML" });
  await download.click();
  await expect(page.getByText("Enter the contact person's name")).toBeVisible();
  await expect(page.getByText("Choose the CSV from EA Giverportal")).toBeVisible();

  await page.getByLabel("Contact person").fill("Test Testesen");
  await page.getByLabel("Email for notices").fill("test@example.org");
  await page.getByLabel("Phone", { exact: true }).fill("+47 999 99 999");
  await page.getByLabel("Mobile for SMS notices").fill("+47 999 99 999");
  await page.locator("input[type=file]").setInputFiles({
    name: "giverportal.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,ssn,Sum,Gieffektivt\n"),
  });

  const request = page.waitForRequest((r) => r.url().includes("reports.tax.skatteetaten"));
  await download.click();
  const body = (await request).postData() ?? "";
  expect(body).toContain(`name="year"\r\n\r\n${lastYear}`);
  expect(body).toContain('name="minSum"\r\n\r\n500');
  expect(body).toContain('filename="giverportal.csv"');
  await expect(page.getByText("No file was made")).toBeVisible();
  await expect(page.getByText("Tax unit 5: Invalid check digit (national ID)")).toBeVisible();

  result.current = {
    file: {
      filename: `skattefradrag_${lastYear}.xml`,
      contentType: "application/xml",
      content: "<x/>",
    },
    errors: [],
    units: 3,
    sum: "32601.00",
    giverportalSum: "1100.50",
  };
  const file = page.waitForEvent("download");
  await download.click();
  expect((await file).suggestedFilename()).toBe(`skattefradrag_${lastYear}.xml`);
  await expect(page.getByText("File downloaded")).toBeVisible();

  // Contact details are remembered after a reload
  await page.reload();
  await expect(page.getByLabel("Contact person")).toHaveValue("Test Testesen");
});
