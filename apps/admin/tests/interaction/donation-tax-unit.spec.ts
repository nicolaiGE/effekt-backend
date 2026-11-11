import { expect, test } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";

/**
 * Editing a donation's tax unit: a donor with a personal and a company tax unit gave a donation
 * without one, and it belongs to the company. Choosing the company sends the donation's
 * distribution with the company's tax unit and the same split, so the API moves just this
 * donation to a KID with that tax unit. Synthetic donor, numbers and amounts.
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
  sum: "336000.00",
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

const taxUnits = [
  {
    id: 71,
    donorId: 700,
    name: "Ola Eksempel",
    ssn: "01019012345",
    archived: null,
    registered: "2024-01-01T00:00:00.000Z",
    numDonations: 3,
    sumDonations: "15000.00",
  },
  {
    id: 72,
    donorId: 700,
    name: "Eksempel Invest AS",
    ssn: "923456789",
    archived: null,
    registered: "2025-01-01T00:00:00.000Z",
    numDonations: 1,
    sumDonations: "50000.00",
  },
];

test("a donation without a tax unit moves to the donor's company", async ({ page }) => {
  const updates: unknown[] = [];
  await stubAnalysisApi(page, {
    extra: {
      "donations.get": donation,
      "config.causeAreas.listActive": causeAreas,
      "config.causeAreas.listAll": causeAreas,
      "config.paymentMethods.list": [{ id: 2, name: "Bank", abbriviation: "Bank" }],
      "meta.owners": [{ id: 3, name: "EAN + Effekt", default: true }],
      "donors.taxUnits.list": taxUnits,
    },
    overrides: {
      "donations.update": (input) => {
        updates.push(input);
        return null;
      },
    },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
  await page.goto(`/donations/${donation.id}/edit`);

  const taxUnit = page.getByRole("combobox", { name: "Tax unit" });
  await expect(taxUnit).toHaveText("No tax unit");
  await taxUnit.click();
  // The person's number is masked; the company's org number is shown in full
  await expect(page.getByRole("option", { name: "Ola Eksempel · 010190 •••••" })).toBeVisible();
  await page.getByRole("option", { name: "Eksempel Invest AS · 923456789" }).click();

  await page.getByRole("button", { name: "Save changes" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Tax unit: No tax unit → Eksempel Invest AS · 923456789");
  // The split is the same, so it isn't listed as a change
  await expect(confirm).not.toContainText("Distribution:");
  await confirm.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => updates.length).toBe(1);
  expect(updates[0]).toEqual({
    id: donation.id,
    distribution: {
      donorId: 700,
      taxUnitId: 72,
      causeAreas: [
        {
          id: 1,
          percentageShare: "100",
          standardSplit: true,
          organizations: [{ id: 1, percentageShare: "100" }],
        },
      ],
    },
  });
});
