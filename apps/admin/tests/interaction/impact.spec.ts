import { expect, test, type Page } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";
import { exchangeRatesFixture, impactFixtures } from "../impact-fixtures";

/** The Impact pages against a stubbed API: lists, filters in the URL, panels, read-only views. */
async function signIn(
  page: Page,
  {
    overrides = {},
    extra = {},
  }: {
    overrides?: Record<string, (input: unknown) => unknown>;
    extra?: Record<string, unknown>;
  } = {},
) {
  await stubAnalysisApi(page, { overrides, extra: { ...impactFixtures(), ...extra } });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
}

test("the Impact group follows Regranting in the nav", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of [
    "Cost estimates",
    "Fund grants",
    "Charities & interventions",
    "Exchange rates",
  ])
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  const text = await nav.innerText();
  expect(text.indexOf("Impact")).toBeGreaterThan(text.indexOf("Payees & funds"));
  expect(text.indexOf("Impact")).toBeLessThan(text.indexOf("Analysis"));
});

test("estimates filter by charity and year in the URL, and a row opens the charity's timeline", async ({
  page,
}) => {
  const inputs: unknown[] = [];
  await signIn(page, {
    overrides: {
      "impact.estimates.list": (input) => {
        inputs.push(input);
        return impactFixtures()["impact.estimates.list"];
      },
    },
  });
  await page.goto("/impact/estimates?charity=1&year=2022");
  const table = page.getByRole("table", { name: "Cost estimates" });
  await expect(table).toContainText("Against Malaria Foundation");
  expect(inputs.at(-1)).toEqual({ charityIds: [1], year: 2022 });
  await expect(table).toContainText("5,85 USD");
  await expect(table).toContainText("58,50 kr");
  await expect(table).toContainText("From Jan 2023");
  await expect(table).toContainText("Jan 2021 – Dec 2022");

  await table
    .getByRole("row", { name: /Against Malaria Foundation/ })
    .first()
    .click();
  const panel = page.getByRole("region", { name: "Charity #1 estimates", exact: true });
  await expect(panel.getByRole("heading", { name: "Against Malaria Foundation" })).toBeVisible();
  const estimates = panel.getByRole("table", { name: "Estimates" });
  // Newest first, with the months each covers
  await expect(estimates.getByRole("row").nth(1)).toContainText("From Jan 2023");
  await expect(estimates.getByRole("row").nth(1)).toContainText("In effect");
  await expect(estimates.getByRole("row").nth(3)).toContainText("Jan 2020 – Dec 2020");
  await expect(panel).toContainText("Donations before Jan 2020 have no estimate");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/charity=1/);
});

test("a fund grant shows its split by charity and each allotment's cost per output", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/impact/grants");
  const table = page.getByRole("table", { name: "Fund grants" });
  await expect(table).toContainText("Malaria Consortium, Against Malaria Foundation");
  await table.getByRole("row", { name: /TCF/ }).click();
  const panel = page.getByRole("region", { name: "Fund grant #33", exact: true });
  await expect(panel.getByRole("heading", { name: "Top Charities Fund, Feb 2025" })).toBeVisible();
  await expect(panel.getByRole("img", { name: /Malaria Consortium/ })).toBeVisible();
  const allotments = panel.getByRole("table", { name: "Allotments" });
  await expect(allotments).toContainText("71,2 %");
  await expect(allotments).toContainText("9,62 USD");
  await expect(panel.getByRole("link", { name: "Previous grant" })).toHaveAttribute(
    "href",
    "/impact/grants/29",
  );
});

test("charities and interventions show links, abbreviations and texts per language", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/impact/settings");
  const charities = page.getByRole("table", { name: "Charities" });
  await expect(charities).toContainText("AMF");
  await expect(charities.getByRole("row", { name: /Malaria Consortium/ })).toContainText(
    "Not linked",
  );
  await page.getByRole("button", { name: /Interventions/ }).click();
  await expect(page).toHaveURL(/section=interventions/);
  const interventions = page.getByRole("table", { name: "Interventions" });
  await expect(interventions.getByRole("row", { name: /Bednets/ })).toContainText("Myggnett");
});

test("exchange rates show the newest rate per currency and link the job's runs", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/impact/exchange-rates");
  await expect(page.getByRole("table", { name: "Currencies" })).toContainText("10,1235");
  await expect(page.getByRole("link", { name: /30\.10\.2026/ })).toHaveAttribute(
    "href",
    "/logs/900",
  );
  await expect(page.getByText("The rates are behind")).toBeHidden();
});

test("exchange rates warn when the newest rate is more than four days old", async ({ page }) => {
  await signIn(page, {
    extra: {
      "impact.exchangeRates": exchangeRatesFixture({
        daysSinceLatest: 9,
        gaps: [{ from: "2026-10-01", to: "2026-10-08", days: 8 }],
      }),
    },
  });
  await page.goto("/impact/exchange-rates");
  await expect(page.getByText("The rates are behind")).toBeVisible();
  await expect(page.getByText("(8 days)")).toBeVisible();
});

const previewFixture = {
  charityId: 1,
  before: {
    validFrom: "2023-01-01",
    centsPerOutput: 585,
    interventionName: "Bednets",
    costPerOutputNok: "58.50",
  },
  after: {
    validFrom: "2023-01-01",
    centsPerOutput: 610,
    interventionName: "Bednets",
    costPerOutputNok: "61.00",
  },
  changedMonths: [{ from: "2023-01-01", to: null }],
  monthsChanged: 47,
  donations: 2614,
  donors: 840,
  organizationLinked: true,
  nokRate: { date: "2026-10-30", perUsd: 10 },
};

test("editing an estimate validates inline, shows the effect and confirms before → after", async ({
  page,
}) => {
  const updates: unknown[] = [];
  const previews: unknown[] = [];
  await signIn(page, {
    overrides: {
      "impact.estimates.preview": (input) => {
        previews.push(input);
        return previewFixture;
      },
      "impact.estimates.update": (input) => {
        updates.push(input);
        return { id: 71 };
      },
    },
  });
  await page.goto("/impact/estimates/1");
  await page.getByRole("link", { name: "Edit the estimate from Jan 2023" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit estimate" })).toBeVisible();

  const cost = page.getByRole("textbox", { name: /Cost per output/ });
  await cost.fill("6,10");
  await page.getByRole("textbox", { name: /High end/ }).fill("5");
  await page.getByRole("button", { name: "Save estimate…" }).click();
  await expect(page.getByText("The high end can't be below the estimate")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  await page.getByRole("textbox", { name: /High end/ }).fill("");
  const preview = page.getByTestId("estimate-preview");
  await expect(preview).toContainText("5,85 USD → 6,10 USD");
  await expect(preview).toContainText("2 614 donations from 840 donors");
  expect(previews.at(-1)).toEqual({
    id: 71,
    charityId: 1,
    interventionId: 2,
    validFrom: "2023-01-01",
    centsPerOutput: 610,
  });

  await page.getByRole("button", { name: "Save estimate…" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Change AMF's estimate from Jan 2023?");
  await expect(confirm).toContainText("5,85 USD → 6,10 USD");
  await expect(confirm).toContainText("From Jan 2023 (47 months so far)");
  expect(updates).toEqual([]);
  await confirm.getByRole("button", { name: "Save estimate" }).click();
  await expect(page).toHaveURL(/\/impact\/estimates\/1$/);
  expect(updates).toEqual([
    {
      id: 71,
      interventionId: 2,
      validFrom: "2023-01-01",
      centsPerOutput: 610,
      centsPerOutputLowerBound: 0,
      centsPerOutputUpperBound: null,
      sourceName: "GiveWell directed grants",
      sourceUrl: "https://docs.google.com/spreadsheets/d/example",
      comment: "",
    },
  ]);
});

test("a month that already has an estimate is refused, and the reason shown", async ({ page }) => {
  await signIn(page, {
    overrides: {
      "impact.estimates.preview": () => previewFixture,
      "impact.estimates.create": () => ({
        error: {
          code: "BAD_REQUEST",
          httpStatus: 400,
          message: "AMF already has an estimate from Jan 2023; edit that one instead",
        },
      }),
    },
  });
  await page.goto("/impact/estimates/1/new");
  await page.getByRole("textbox", { name: /From month/ }).fill("01.2023");
  await page.getByRole("textbox", { name: /Cost per output/ }).fill("6");
  await page.getByRole("textbox", { name: /^Source/ }).fill("GiveWell");
  await page.getByRole("textbox", { name: /^Link/ }).fill("https://www.givewell.org/x");
  await page.getByRole("button", { name: "Add estimate…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Add estimate" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "already has an estimate from Jan 2023",
  );
});

test("deleting an estimate says what its months fall back to", async ({ page }) => {
  const deleted: unknown[] = [];
  await signIn(page, {
    overrides: {
      "impact.estimates.preview": () => ({
        ...previewFixture,
        before: previewFixture.before,
        after: { ...previewFixture.before, validFrom: "2021-01-01", centsPerOutput: 487 },
      }),
      "impact.estimates.delete": (input) => {
        deleted.push(input);
        return input;
      },
    },
  });
  await page.goto("/impact/estimates/1");
  await page.getByRole("button", { name: "Delete the estimate from Jan 2023" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Its months use 4,87 USD (the estimate from Jan 2021)");
  await confirm.getByRole("button", { name: "Delete estimate" }).click();
  await expect(confirm).toBeHidden();
  expect(deleted).toEqual([{ id: 71 }]);
});

test("editing a grant keeps allotment ids, recomputes the split and confirms it", async ({
  page,
}) => {
  const updates: unknown[] = [];
  await signIn(page, {
    overrides: {
      "impact.grants.update": (input) => {
        updates.push(input);
        return { id: 33 };
      },
    },
  });
  await page.goto("/impact/grants/33/edit");
  await expect(page.getByTestId("share-0")).toHaveText("71,2 %");
  const second = page.getByRole("listitem", { name: "Allotment 2" });
  await second.getByRole("textbox", { name: /Sum/ }).fill("8900000");
  await expect(page.getByTestId("share-0")).toHaveText("50,0 %");
  await page.getByRole("button", { name: "Save grant…" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Against Malaria Foundation: 28,8 % → 50,0 %");
  await confirm.getByRole("button", { name: "Save grant" }).click();
  await expect(page).toHaveURL(/\/impact\/grants\/33$/);
  expect(
    (updates[0] as { allotments: { id?: number; sumInCents: number }[] }).allotments.map((a) => [
      a.id,
      a.sumInCents,
    ]),
  ).toEqual([
    [48, 890000000],
    [49, 890000000],
  ]);
});

test("a charity's abbreviation is fixed once created", async ({ page }) => {
  const updates: unknown[] = [];
  await signIn(page, {
    overrides: {
      "impact.charities.update": (input) => {
        updates.push(input);
        return { id: 1 };
      },
    },
  });
  await page.goto("/impact/settings");
  await page.getByRole("button", { name: "Edit Against Malaria Foundation" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Against Malaria Foundation" });
  await expect(dialog.getByRole("textbox", { name: /Abbreviation/ })).toBeDisabled();
  await dialog.getByRole("textbox", { name: /Name/ }).fill("Against Malaria Foundation (AMF)");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  expect(updates).toEqual([
    { id: 1, name: "Against Malaria Foundation (AMF)", organizationId: 12 },
  ]);
});

const changesFixture = [
  {
    id: 8,
    entity: "estimate",
    entityId: 71,
    action: "update",
    charityId: 1,
    summary: "AMF estimate from Jan 2023",
    changedBy: "ops@example.org",
    changedAt: "2026-11-01T14:42:45.000Z",
    fields: [
      { field: "centsPerOutput", before: 585, after: 610 },
      { field: "validFrom", before: "2023-01-01", after: "2023-02-01" },
    ],
  },
  {
    id: 7,
    entity: "grant",
    entityId: 33,
    action: "delete",
    charityId: null,
    summary: "TCF grant from Feb 2025",
    changedBy: "finance@example.org",
    changedAt: "2026-11-01T13:00:00.000Z",
    fields: [],
  },
];

test("the change log shows who changed what, before → after, filtered by kind", async ({
  page,
}) => {
  const inputs: unknown[] = [];
  await signIn(page, {
    overrides: {
      "impact.changes.list": (input) => {
        inputs.push(input);
        return changesFixture;
      },
    },
  });
  await page.goto("/impact/changes");
  const table = page.getByRole("table", { name: "Change log" });
  const row = table.getByRole("row", { name: /AMF estimate/ });
  await expect(row).toContainText("ops@example.org");
  await expect(row).toContainText("Cost per output: 5,85 USD → 6,10 USD");
  await expect(row).toContainText("From month: Jan 2023 → Feb 2023");
  await expect(row.getByRole("link", { name: "AMF estimate from Jan 2023" })).toHaveAttribute(
    "href",
    "/impact/estimates/1",
  );
  // A deleted grant has no page to link to
  await expect(table.getByRole("row", { name: /TCF grant/ }).getByRole("link")).toHaveCount(0);
  await page.goto("/impact/changes?entity=grant");
  await expect.poll(() => inputs.at(-1)).toEqual({ entity: "grant", limit: 500 });
});

test("a charity's page lists its history", async ({ page }) => {
  const inputs: unknown[] = [];
  await signIn(page, {
    overrides: {
      "impact.changes.list": (input) => {
        inputs.push(input);
        return changesFixture.slice(0, 1);
      },
    },
  });
  await page.goto("/impact/estimates/1");
  await expect(page.getByRole("table", { name: "History" })).toContainText(
    "Cost per output: 5,85 USD → 6,10 USD",
  );
  expect(inputs).toContainEqual({ charityId: 1 });
});
