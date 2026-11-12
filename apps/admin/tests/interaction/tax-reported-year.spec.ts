import { expect, test, type Page } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";

/**
 * Editing a gift whose year has been reported to Skatteetaten warns that a change needs a
 * correction (RF-1310). Synthetic donor and amounts.
 */
const causeAreas = [
  {
    id: 1,
    name: "Global health",
    standardPercentageShare: 100,
    shortDescription: null,
    longDescription: null,
    informationUrl: null,
    isActive: true,
    ordering: 1,
    organizations: [
      {
        id: 1,
        causeAreaId: 1,
        name: "Against Malaria Foundation",
        standardShare: 100,
        isActive: true,
        ordering: 1,
      },
    ],
  },
];

const split = {
  kid: "000700000000001",
  donorId: 700,
  taxUnitId: null,
  causeAreas: [
    {
      id: 1,
      name: "Global health",
      percentageShare: "100.000000000000000",
      standardSplit: true,
      organizations: [
        { id: 1, name: "Against Malaria Foundation", percentageShare: "100.000000000000000" },
      ],
    },
  ],
};

const donation = {
  id: 20001,
  donor: "Ola Eksempel",
  donorId: 700,
  email: "ola@example.org",
  sum: "1000.00",
  transactionCost: "0.00",
  timestamp: "2026-10-15T10:00:00.000Z",
  paymentId: 2,
  paymentExternalRef: "bank-1",
  paymentMethod: "Bank",
  KID: split.kid,
  metaOwnerId: 3,
  fundraiserId: null,
  distribution: split,
};

async function openEdit(page: Page, submittedYears: unknown[]) {
  await stubAnalysisApi(page, {
    extra: {
      "donations.get": donation,
      "config.causeAreas.listActive": causeAreas,
      "config.causeAreas.listAll": causeAreas,
      "config.paymentMethods.list": [{ id: 2, name: "Bank", abbriviation: "Bank" }],
      "meta.owners": [{ id: 3, name: "EAN + Effekt", default: true }],
      "reports.tax.submittedYears": submittedYears,
    },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
  await page.goto(`/donations/${donation.id}/edit`);
  await expect(page.getByRole("heading", { name: "Edit donation" })).toBeVisible();
}

test("editing a gift in a year reported to Skatteetaten warns that it needs a correction", async ({
  page,
}) => {
  await openEdit(page, [{ year: 2026, submitted: "2027-01-19T10:00:00.000Z" }]);
  await expect(page.getByText("2026 is reported to Skatteetaten")).toBeVisible();
  await expect(page.getByText("needs a correction")).toBeVisible();
});

test("editing a gift in a year not yet reported shows no warning", async ({ page }) => {
  await openEdit(page, [{ year: 2025, submitted: "2026-01-19T10:00:00.000Z" }]);
  await expect(page.getByText("is reported to Skatteetaten")).toHaveCount(0);
});
