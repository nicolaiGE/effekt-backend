import { expect, test, type Page } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";

/**
 * Reports › Tax deduction against a stubbed API: the year, control figures, the deviation lists
 * with donor links and no national IDs, the test-mode notice and the XML download.
 */
/** The page opens on the running year */
const thisYear = new Date().getFullYear();

const overview = (year: number, difference = "0.00") => ({
  year,
  minSum: 500,
  maximumDeduction: 25000,
  // Last year's limits are missing in this fixture, to show the warning
  limitsInCode: year !== thisYear - 1,
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
      email: "test.giver@example.org",
      name: "Test Giver",
      donationsSum: "1000.30",
      fundraiserSum: "0.00",
      donations: 3,
      taxUnits: 0,
      exclusion: null,
      exclusionLabel: null,
      status: "notice",
      statusBy: null,
      statusAt: null,
      reminders: 0,
      lastReminded: null,
      canRemind: false,
    },
    {
      donorId: 1464,
      email: "anonym@example.org",
      name: "Anonym giver",
      donationsSum: "90000.00",
      fundraiserSum: "85000.00",
      donations: 400,
      taxUnits: 0,
      exclusion: "anonymous",
      exclusionLabel: "Anonymous donor",
      status: "excluded",
      statusBy: null,
      statusAt: null,
      reminders: 0,
      lastReminded: null,
      canRemind: false,
    },
    {
      donorId: 30,
      email: "linjeforening@example.org",
      name: "Linjeforening Testinnsamling",
      donationsSum: "4000.00",
      fundraiserSum: "4000.00",
      donations: 12,
      taxUnits: 0,
      exclusion: "leftOut",
      exclusionLabel: "Left out by hand",
      status: "excluded",
      statusBy: "admin@example.org",
      statusAt: "2026-11-10T09:00:00.000Z",
      reminders: 0,
      lastReminded: null,
      canRemind: false,
    },
    {
      donorId: 40,
      email: "sendt@example.org",
      name: "Sendt Testesen",
      donationsSum: "700.00",
      fundraiserSum: "0.00",
      donations: 1,
      taxUnits: 0,
      exclusion: null,
      exclusionLabel: null,
      status: "sent",
      statusBy: "admin@example.org",
      statusAt: "2026-11-10T09:00:00.000Z",
      reminders: 1,
      lastReminded: "2026-12-01T09:00:00.000Z",
      canRemind: true,
    },
  ],
  sentNoLongerWithout: 2,
  duplicates: [{ reason: "sameNumber", donorIds: [10, 11], taxUnitIds: [1, 2], sum: "500.10" }],
  invalidNumbers: [
    {
      donorIds: [13],
      taxUnitIds: [5],
      name: "Ugyldig Testesen",
      maskedNumber: "0101•••••••",
      problem: "Invalid check digit (national ID)",
      sum: "1000.00",
      reported: true,
    },
  ],
});

type Calls = { overview: unknown[]; notice: unknown[]; status?: unknown[]; preview?: unknown[] };

async function open(page: Page, calls: Calls, xmlResult: unknown) {
  await stubAnalysisApi(page, {
    overrides: {
      "reports.tax.overview": (input) => {
        calls.overview.push(input);
        const year = (input as { year: number }).year;
        return overview(year, year === thisYear ? "0.00" : "0.01");
      },
      "reports.tax.missingTaxUnitNotice": (input) => {
        calls.notice.push(input);
        const { round = "notice", testEmail } = input as { round?: string; testEmail?: string };
        return {
          round,
          total: 2,
          success: 2,
          failed: 0,
          testMode: !!testEmail,
          donorsMarkedSent: testEmail ? 0 : 1,
        };
      },
      "reports.tax.noticePreview": (input) => {
        (calls.preview ??= []).push(input);
        const { round } = input as { round: string };
        return {
          round,
          emails: 1,
          donors: 1,
          example: {
            donorIds: [20],
            name: "Test Giver",
            email: "test.giver@example.org",
            donationsSum: 1000.3,
          },
          mail: {
            templateId: "tmpl-test",
            personalization: {
              name: "Test",
              year: String(thisYear),
              donationTotalSum: "1 000,3 kr",
              deductionPercentage: "22%",
              maxDeduction: "25 000 kr",
              organizations: [
                {
                  name: "Testorganisasjon",
                  sum: "1 000,3 kr",
                  percentage: "100%",
                  outputs: ["3 myggnett"],
                },
              ],
              profilePageUrl: "https://example.org/min-side",
              profilePageLinkTitle: "Logg inn",
              reminder: round === "reminder",
            },
          },
          problem: null,
        };
      },
      "reports.tax.noticeStatus": (input) => {
        (calls.status ??= []).push(input);
        return { changed: (input as { donorIds: number[] }).donorIds.length };
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
  await expect.poll(() => calls.overview[0]).toEqual({ year: thisYear, minSum: 500 });
  await expect(page.getByText("31 500,10 kr")).toBeVisible();
  await expect(page.getByText("Adds up to the øre")).toBeVisible();
  await expect(page.getByRole("table", { name: "Reconciliation" })).toContainText("33 100,39 kr");

  // Only the donors who get the notice by default; the left-out ones say why
  const without = page.getByRole("table", { name: "Donors without tax unit" });
  await expect(without.getByRole("link", { name: "#20" })).toHaveAttribute("href", "/donors/20");
  await expect(without).toContainText("Test Giver");
  await expect(without.getByRole("link", { name: "#1464" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Left out (2)" }).click();
  await expect(without.getByRole("row", { name: /#1464/ })).toContainText("Anonymous donor");
  await expect(without.getByRole("row", { name: /#1464/ })).toContainText("85 000,00 kr");
  await expect(without.getByRole("row", { name: /#30/ })).toContainText("Left out by hand");
  await page.getByRole("radio", { name: "Sent (1)" }).click();
  await expect(without.getByRole("row", { name: /#40/ })).toContainText("admin@example.org");
  await expect(page.getByText("2 more donors who got the notice have since")).toBeVisible();
  await page.getByRole("radio", { name: "All (4)" }).click();
  await expect(without.getByRole("row")).toHaveCount(5);
  // Search by name or donor ID
  await page.getByLabel("Search donors").fill("linjeforening");
  await expect(without.getByRole("row")).toHaveCount(2);
  await page.getByLabel("Search donors").fill("linjeforening@example");
  await expect(without.getByRole("row")).toHaveCount(2);
  await expect(without).toContainText("linjeforening@example.org");
  await page.getByLabel("Search donors").fill("#40");
  await expect(without.getByRole("row", { name: /#40/ })).toBeVisible();
  await page.getByLabel("Search donors").fill("");
  const duplicates = page.getByRole("table", { name: "Possible duplicate donors" });
  await expect(duplicates.getByRole("link", { name: "#10" })).toBeVisible();
  await expect(duplicates.getByRole("link", { name: "#11" })).toBeVisible();
  const invalid = page.getByRole("table", { name: "Invalid numbers" });
  await expect(invalid).toContainText("Invalid check digit (national ID)");
  await expect(invalid).toContainText("Yes, blocks the file");
  await expect(invalid).toContainText("Ugyldig Testesen");
  await expect(invalid).toContainText("0101•••••••");
  await expect(invalid.getByRole("link", { name: "Fix the number on donor #13" })).toHaveAttribute(
    "href",
    "/donors/13?tab=tax",
  );
  await expect(page.getByText("Invalid numbers will stop the file")).toBeVisible();
  // No 9- or 11-digit numbers anywhere on the page
  expect(await page.locator("main").innerText()).not.toMatch(/\b\d{9}(\d{2})?\b/);

  // The running year is open by default, and says so; its limits are in the code
  await expect(page.getByText("are not in the code")).toHaveCount(0);
  await expect(page.getByText("The year isn't over")).toBeVisible();

  // Last year (the one reported in January) asks again; a difference is called out
  await page.getByLabel("Gift year").click();
  await page.getByRole("option", { name: String(thisYear - 1) }).click();
  await expect.poll(() => calls.overview.at(-1)).toEqual({ year: thisYear - 1, minSum: 500 });
  await expect(page.getByText("The year isn't over")).toHaveCount(0);
  await expect(
    page.getByText(`The tax deduction limits for ${thisYear - 1} are not in the code`),
  ).toBeVisible();
  await expect(page.getByText("The figures don't add up")).toBeVisible();
});

test("tax deduction: the missing tax unit notice in test mode goes to the test address", async ({
  page,
}) => {
  const calls: Calls = { overview: [], notice: [] };
  await open(page, calls, null);

  await page.getByRole("button", { name: "Send missing tax unit notice" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByLabel("Test mode")).toBeChecked();
  // The preview: how many, the first recipient and the values the template gets
  const preview = dialog.getByRole("region", { name: "Preview" });
  await expect(preview).toContainText("1 email to 1 donor");
  await expect(preview).toContainText("test.giver@example.org");
  await expect(preview).toContainText("Testorganisasjon: 1 000,3 kr (100%) · 3 myggnett");
  await expect(preview).toContainText("template tmpl-test");
  await expect
    .poll(() => calls.preview?.[0])
    .toEqual({ year: thisYear, minSum: 500, round: "notice" });
  const send = dialog.getByRole("button", { name: "Send test" });
  await expect(send).toBeDisabled();
  await dialog.getByLabel("Send to").fill("test@example.org");
  await send.click();
  await expect
    .poll(() => calls.notice[0])
    .toEqual({
      year: thisYear,
      minSum: 500,
      round: "notice",
      testEmail: "test@example.org",
      testLimit: 3,
    });
  await expect(page.getByText("Test sent").first()).toBeVisible();

  // Real sending needs the year typed
  await page.getByRole("button", { name: "Send missing tax unit notice" }).click();
  await dialog.getByLabel("Test mode").click();
  await expect(dialog).toContainText("1 donor in “Gets the notice” get the email");
  const realSend = dialog.getByRole("button", { name: "Send to donors" });
  await expect(realSend).toBeDisabled();
  // The typed year goes to the API too, which refuses a real send without it
  await dialog.getByLabel(/to confirm/).fill(String(thisYear));
  await realSend.click();
  await expect
    .poll(() => calls.notice[1])
    .toEqual({ year: thisYear, minSum: 500, round: "notice", confirmYear: thisYear });
});

test("tax deduction: ticked donors move to Left out and back", async ({ page }) => {
  const calls: Calls = { overview: [], notice: [] };
  await open(page, calls, null);
  const without = page.getByRole("table", { name: "Donors without tax unit" });

  await without.getByRole("row", { name: /#20/ }).getByRole("checkbox").click();
  await page.getByRole("button", { name: "Move to Left out" }).click();
  await expect
    .poll(() => calls.status?.[0])
    .toEqual({ year: thisYear, donorIds: [20], status: "excluded" });
  await expect(page.getByText("Moved 1 donor to Left out")).toBeVisible();

  // Only those left out by hand go back; the rules' own exclusions stay
  await page.getByRole("radio", { name: "Left out (2)" }).click();
  await without.getByRole("checkbox", { name: /select all/i }).click();
  await expect(page.getByText("1 donor left out by the rules can't be moved back")).toBeVisible();
  await page.getByRole("button", { name: "Move back to Gets the notice" }).click();
  await expect
    .poll(() => calls.status?.[1])
    .toEqual({ year: thisYear, donorIds: [30], status: "notice" });

  // Ticked donors in Gets the notice can get the notice alone
  await page.getByRole("radio", { name: "Gets the notice (1)" }).click();
  await without.getByRole("row", { name: /#20/ }).getByRole("checkbox").click();
  await page.getByRole("button", { name: "Send notice to ticked" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("1 ticked donor");
  await expect
    .poll(() => calls.preview?.at(-1))
    .toEqual({ year: thisYear, minSum: 500, round: "notice", donorIds: [20] });
  await dialog.getByLabel("Test mode").click();
  await dialog.getByLabel(/to confirm/).fill(String(thisYear));
  await dialog.getByRole("button", { name: "Send to donors" }).click();
  await expect
    .poll(() => calls.notice.at(-1))
    .toEqual({
      year: thisYear,
      minSum: 500,
      round: "notice",
      donorIds: [20],
      confirmYear: thisYear,
    });
  await expect(page.getByText("1 donor moved to Sent", { exact: false }).first()).toBeVisible();
});

test("tax deduction: reminders go to donors in Sent, shown with the last one", async ({ page }) => {
  const calls: Calls = { overview: [], notice: [] };
  await open(page, calls, null);
  const without = page.getByRole("table", { name: "Donors without tax unit" });

  await page.getByRole("radio", { name: "Sent (1)" }).click();
  await expect(without.getByRole("row", { name: /#40/ })).toContainText("1 reminder, last");

  await without.getByRole("row", { name: /#40/ }).getByRole("checkbox").click();
  await page.getByRole("button", { name: "Send reminder to ticked" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Send a test of the reminder");
  await expect(dialog.getByRole("region", { name: "Preview" })).toContainText("reminder = Yes");
  await dialog.getByLabel("Test mode").click();
  await dialog.getByLabel(/to confirm/).fill(String(thisYear));
  await dialog.getByRole("button", { name: "Send to donors" }).click();
  await expect
    .poll(() => calls.notice.at(-1))
    .toEqual({
      year: thisYear,
      minSum: 500,
      round: "reminder",
      donorIds: [40],
      confirmYear: thisYear,
    });
  await expect(page.getByText("Reminders sent").first()).toBeVisible();
  await expect(
    page.getByText("The reminder is recorded on 1 donor", { exact: false }).first(),
  ).toBeVisible();

  // The header button reminds all who can be reminded
  await expect(page.getByRole("button", { name: "Send reminder", exact: true })).toBeEnabled();
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
  expect(body).toContain(`name="year"\r\n\r\n${thisYear}`);
  expect(body).toContain('name="minSum"\r\n\r\n500');
  expect(body).toContain('filename="giverportal.csv"');
  await expect(page.getByText("No file was made")).toBeVisible();
  await expect(page.getByText("Tax unit 5: Invalid check digit (national ID)")).toBeVisible();

  result.current = {
    file: {
      filename: `skattefradrag_${thisYear}.xml`,
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
  expect((await file).suggestedFilename()).toBe(`skattefradrag_${thisYear}.xml`);
  await expect(page.getByText("File downloaded")).toBeVisible();

  // Contact details are remembered after a reload
  await page.reload();
  await expect(page.getByLabel("Contact person")).toHaveValue("Test Testesen");
});

test("tax deduction: compare possible duplicates and merge into the donor to keep", async ({
  page,
}) => {
  const compared: unknown[] = [];
  const merged: unknown[] = [];
  const donor = (id: number, email: string, donations: number) => ({
    id,
    name: "Dobbel Testesen",
    email,
    registered: "2024-03-01T10:00:00.000Z",
    trashed: false,
    donations,
    donationsSum: `${donations * 100}.00`,
    lastDonation: "2026-10-01T10:00:00.000Z",
    kids: 2,
    agreements: 1,
    activeAgreements: id === 10 ? 1 : 0,
    taxUnits: [{ id, name: "Dobbel Testesen", maskedNumber: "0101•••••••", archived: false }],
  });
  await stubAnalysisApi(page, {
    overrides: {
      "reports.tax.overview": (input) => overview((input as { year: number }).year),
      "reports.tax.compareDonors": (input) => {
        compared.push(input);
        return [donor(10, "dobbel@example.org", 5), donor(11, "dobbel.gammel@example.org", 2)];
      },
      "donors.merge": (input) => {
        merged.push(input);
        return true;
      },
    },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
  await page.goto("/reports?section=tax-deduction");

  const duplicates = page.getByRole("table", { name: "Possible duplicate donors" });
  await duplicates.getByRole("button", { name: "Compare" }).click();
  const dialog = page.getByRole("dialog", { name: "Compare donors #10 and #11" });
  await expect.poll(() => compared[0]).toEqual({ donorIds: [10, 11] });
  const table = dialog.getByRole("table", { name: "Donors compared" });
  await expect(table).toContainText("dobbel@example.org");
  await expect(table).toContainText("dobbel.gammel@example.org");
  await expect(table).toContainText("0101•••••••");
  await expect(table).toContainText("1 (1 active)");

  // Nothing merges before the donor to keep is picked and its id typed
  await expect(dialog.getByRole("button", { name: "Pick the donor to keep" })).toBeDisabled();
  await dialog.getByRole("radio", { name: /Keep #10/ }).click();
  await dialog.getByRole("button", { name: "Merge into #10" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(
    "2 donations, 1 agreement, 1 tax unit and 2 KIDs move to #10",
  );
  await expect(confirm).toContainText("#11 (dobbel.gammel@example.org) is deleted");
  await confirm.getByLabel(/to confirm/).fill("10");
  await confirm.getByRole("button", { name: "Merge into #10" }).click();
  await expect.poll(() => merged).toEqual([{ originId: 11, destinationId: 10 }]);
  await expect(page.getByText("Donors merged")).toBeVisible();
});
