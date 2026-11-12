import { describe, it, beforeEach, afterEach } from "vitest";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import type { Request, Response } from "express";
import sinon from "sinon";
import { DAO } from "../custom_modules/DAO";
import type { DonorWithoutTaxUnitRow, TaxUnitYearSum } from "../custom_modules/DAO_modules/tax";
import type { TaxUnitNoticeRow } from "../custom_modules/DAO_modules/taxunitnotices";
import {
  ANONYMOUS_DONOR_ID,
  classifyDonorsWithoutTaxUnit,
  noticeRecipients,
  sendMissingTaxUnitNotices,
} from "../custom_modules/missingTaxUnitNotices";
import * as mail from "../custom_modules/mail";
import { donationHelpers } from "../custom_modules/donationHelpers";
import { checkNorwegianId, maskIdNumbers } from "../custom_modules/norwegianId";
import { osloYearRange } from "../custom_modules/osloDays";
import { LAST_UTC_TAX_YEAR, taxYearRange } from "../custom_modules/DAO_modules/tax";
import {
  createXMLReportToTaxAuthorities,
  compareDonors,
  getTaxReportOverview,
  groupTaxUnitsBySsn,
} from "../custom_modules/tax";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

/**
 * Synthetic numbers only: the national IDs are Tenor test numbers (month + 80), which pass the
 * mod 11 check but never belong to a real person; the organization numbers are made up.
 */
const PERSON_A = "01018512366";
const PERSON_B = "15029045604";
const PERSON_C = "31129930090";
const ORGANIZATION = "923456783";
/** PERSON_A with the last check digit changed */
const PERSON_BAD_CHECK = "01018512367";

const xsd = fs.readFileSync(
  path.join(__dirname, "data", "tax", "gavefrivilligorganisasjon_v2_0.xsd"),
  "utf8",
);
const contact = {
  name: "Test Testesen",
  email: "test@example.org",
  phoneNumber: "+4799999999",
  smsNumber: "+4799999999",
};

const unit = (
  taxUnitId: number,
  donorId: number,
  ssn: string | null,
  donationsSum: string,
): TaxUnitYearSum => ({ taxUnitId, donorId, ssn, name: `Unit ${taxUnitId}`, donationsSum });

const withoutUnit = (row: Partial<DonorWithoutTaxUnitRow> & { donorId: number }) => ({
  email: `donor${row.donorId}@example.org`,
  name: `Donor ${row.donorId}`,
  trashed: false,
  donationsSum: "1000.00",
  fundraiserSum: "0.00",
  donations: 1,
  taxUnits: 0,
  ...row,
});

const csv = (rows: [string, string, string, string][]) =>
  Buffer.from(["Name,ssn,Sum,Gieffektivt", ...rows.map((row) => row.join(","))].join("\n"), "utf8");

const createCaller = createCallerFactory(appRouter);
const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions, email: "admin@example.org" } : undefined,
  });

const ADMIN = "admin@example.org";
const file = (id: number, submitted: Date | null) => ({
  id,
  year: 2025,
  units: 3,
  sum: "31500.00",
  giverportalSum: "0.00",
  leftOut: 0,
  createdBy: ADMIN,
  created: new Date("2026-01-15T09:00:00Z"),
  submitted,
  submittedBy: submitted ? ADMIN : null,
});
const notice = (
  donorId: number,
  status: TaxUnitNoticeRow["status"],
  updated = new Date("2026-11-10T09:00:00Z"),
): TaxUnitNoticeRow => ({
  donorId,
  status,
  updatedBy: ADMIN,
  updated,
  reminders: 0,
  lastReminded: null,
  lastRemindedBy: null,
});

// Tax_report_exclusions: none unless a test says otherwise
// Tax_reports: no files unless a test says otherwise
beforeEach(() => {
  sinon.stub(DAO.taxreportexclusions, "getForYear").resolves([]);
  sinon.stub(DAO.taxreports, "getForYear").resolves([]);
  sinon.stub(DAO.taxreports, "record").resolves(77);
});
afterEach(() => sinon.restore());

describe("Norwegian ID check (mod 11)", () => {
  it("accepts valid national IDs and organization numbers", () => {
    for (const id of [PERSON_A, PERSON_B, PERSON_C]) {
      expect(checkNorwegianId(id), id).to.deep.equal({ kind: "person", problem: null });
    }
    expect(checkNorwegianId(ORGANIZATION)).to.deep.equal({
      kind: "organization",
      problem: null,
    });
  });

  it("rejects a wrong check digit", () => {
    expect(checkNorwegianId(PERSON_BAD_CHECK).problem).to.equal("checkDigit");
    // First check digit wrong, second recomputed would not save it
    expect(checkNorwegianId("01018512376").problem).to.equal("checkDigit");
    expect(checkNorwegianId("923456784")).to.deep.equal({
      kind: "organization",
      problem: "checkDigit",
    });
  });

  it("rejects numbers whose first check digit would be 10", () => {
    // 91234567: remainder 1, so no valid check digit exists for any ninth digit
    for (let last = 0; last <= 9; last++) {
      expect(checkNorwegianId(`91234567${last}`).problem).to.equal("checkDigit");
    }
  });

  it("reports wrong length, non-digits and missing numbers", () => {
    expect(checkNorwegianId("1234567890")).to.deep.equal({ kind: null, problem: "length" });
    expect(checkNorwegianId("0101851236A").problem).to.equal("notDigits");
    expect(checkNorwegianId("").problem).to.equal("missing");
    expect(checkNorwegianId(null).problem).to.equal("missing");
  });

  it("masks number-like digit runs in messages", () => {
    expect(maskIdNumbers(`Value '${PERSON_A}' is not accepted, row 12`)).to.equal(
      "Value '•••' is not accepted, row 12",
    );
  });
});

describe("Gift year range", () => {
  it("starts and ends the year at midnight in Oslo, not UTC", () => {
    const range = osloYearRange(2025);
    expect(range.from.toISOString()).to.equal("2024-12-31T23:00:00.000Z");
    expect(range.before.toISOString()).to.equal("2025-12-31T23:00:00.000Z");
  });

  it("keeps UTC years for the years already reported that way, so they come out as filed", () => {
    const range = taxYearRange(LAST_UTC_TAX_YEAR);
    expect(range.from.toISOString()).to.equal("2025-01-01T00:00:00.000Z");
    expect(range.before.toISOString()).to.equal("2026-01-01T00:00:00.000Z");
  });

  it("starts the first Oslo year where the last UTC year ended, so no gift is reported twice", () => {
    const first = taxYearRange(LAST_UTC_TAX_YEAR + 1);
    expect(first.from.toISOString()).to.equal("2026-01-01T00:00:00.000Z");
    expect(first.before.toISOString()).to.equal("2026-12-31T23:00:00.000Z");
    const next = taxYearRange(LAST_UTC_TAX_YEAR + 2);
    expect(next.from.toISOString()).to.equal("2026-12-31T23:00:00.000Z");
    expect(next.before.toISOString()).to.equal("2027-12-31T23:00:00.000Z");
    // A gift at 00:30 in Oslo on 1 January 2026 was reported for 2025, and only there
    const gift = new Date("2025-12-31T23:30:00Z");
    const inYear = (y: number) => {
      const r = taxYearRange(y);
      return gift >= r.from && gift < r.before;
    };
    expect([2024, 2025, 2026, 2027].filter(inYear)).to.deep.equal([2025]);
  });

  afterEach(() => sinon.restore());

  it("limits the tax unit sums to the gift year in SQL", async () => {
    const query = sinon.stub(DAO, "query").resolves([[], []] as any);
    await DAO.tax.getTaxXMLReportUnits(2027);
    const sql: string = query.firstCall.args[0];
    expect(sql).to.contain("D.timestamp_confirmed >= '2026-12-31 23:00:00.000'");
    expect(sql).to.contain("D.timestamp_confirmed < '2027-12-31 23:00:00.000'");
    expect(sql).to.not.match(/YEAR\s*\(/);
  });

  it("uses the same bounds for the totals and the donors without tax unit (and the notice)", async () => {
    const query = sinon.stub(DAO, "query").resolves([[{ total: 0, withoutTaxUnit: 0 }], []] as any);
    await DAO.tax.getDonationTotalsInYear(2026);
    await DAO.tax.getDonorsWithoutTaxUnitInYear(2026, 500);
    for (const call of query.getCalls()) {
      expect(call.args[0]).to.contain("D.timestamp_confirmed >= '2026-01-01 00:00:00.000'");
      expect(call.args[0]).to.contain("D.timestamp_confirmed < '2026-12-31 23:00:00.000'");
    }
    expect(query.lastCall.args[1]).to.deep.equal([500]);
  });
});

describe("Who gets the missing tax unit notice", () => {
  const classified = classifyDonorsWithoutTaxUnit(
    [
      withoutUnit({ donorId: 1 }),
      withoutUnit({ donorId: 2, trashed: true }),
      withoutUnit({ donorId: ANONYMOUS_DONOR_ID }),
      withoutUnit({ donorId: 4, email: null }),
      withoutUnit({ donorId: 5, email: "  " }),
      withoutUnit({ donorId: 6, email: "ukjent-6@gieffektivt.no" }),
      withoutUnit({ donorId: 7, email: "kjoper@auksjon.example.org" }),
      withoutUnit({ donorId: 8, taxUnits: 1 }),
      // Mostly or only fundraiser gifts: a tax unit they register covers those too
      withoutUnit({ donorId: 9, donationsSum: "1000.00", fundraiserSum: "1000.00" }),
      withoutUnit({ donorId: 10, donationsSum: "1000.00", fundraiserSum: "500.00" }),
      withoutUnit({ donorId: 11, email: "DONOR1@example.org", donationsSum: "600.00" }),
      withoutUnit({ donorId: 12, donationsSum: "499.99" }),
    ],
    500,
  );

  it("leaves out deleted, anonymous, address-less, internal and tax unit donors, not fundraiser givers", () => {
    expect(classified.map((donor) => [donor.donorId, donor.exclusion])).to.deep.equal([
      [1, null],
      [2, "trashed"],
      [ANONYMOUS_DONOR_ID, "anonymous"],
      [4, "noEmail"],
      [5, "noEmail"],
      [6, "internalEmail"],
      [7, "internalEmail"],
      [8, "hasTaxUnit"],
      [9, null],
      [10, null],
      [11, null],
    ]);
    // Fundraiser gifts count in full; below minSum is not listed at all
    expect(classified.find((donor) => donor.donorId === 9)!.noticeSum).to.equal("1000.00");
    expect(classified.find((donor) => donor.donorId === 10)!.noticeSum).to.equal("1000.00");
  });

  it("sends one notice per address, largest first, without excluded addresses", () => {
    expect(noticeRecipients(classified).map((r) => [r.email, r.donationsSum])).to.deep.equal([
      ["donor1@example.org", 1600],
      ["donor9@example.org", 1000],
      ["donor10@example.org", 1000],
    ]);
    expect(noticeRecipients(classified, ["Donor10@example.org"])).to.have.length(2);
    expect(noticeRecipients(classified)[0].donorIds).to.deep.equal([1, 11]);
  });

  it("moves donors left out by hand to Left out and sent donors to Sent", () => {
    const withStatus = classifyDonorsWithoutTaxUnit(
      [
        withoutUnit({ donorId: 1 }),
        withoutUnit({ donorId: 2 }),
        withoutUnit({ donorId: 3 }),
        // Left out by the rules and by hand: the rule's reason shows
        withoutUnit({ donorId: 4, taxUnits: 1 }),
        // Sent wins over the rules (e.g. the donor got the notice before being trashed)
        withoutUnit({ donorId: 5, trashed: true }),
      ],
      500,
      [notice(2, "excluded"), notice(3, "sent"), notice(4, "excluded"), notice(5, "sent")],
    );
    expect(
      withStatus.map((donor) => [donor.donorId, donor.status, donor.exclusion, donor.statusBy]),
    ).to.deep.equal([
      [1, "notice", null, null],
      [2, "excluded", "leftOut", ADMIN],
      [3, "sent", null, ADMIN],
      [4, "excluded", "hasTaxUnit", null],
      [5, "sent", null, ADMIN],
    ]);
    expect(noticeRecipients(withStatus).map((r) => r.donorIds)).to.deep.equal([[1]]);
  });
});

describe("Tax_unit_notices SQL", () => {
  afterEach(() => sinon.restore());

  it("never turns a sent donor back into left out or into the notice", async () => {
    const query = sinon.stub(DAO, "query").resolves([{ affectedRows: 1 }, []] as any);
    await DAO.taxunitnotices.exclude(2025, [1, 2], ADMIN);
    expect(query.firstCall.args[0]).to.match(/INSERT IGNORE/);
    expect(query.firstCall.args[1]).to.deep.equal([
      [
        [1, 2025, "excluded", ADMIN],
        [2, 2025, "excluded", ADMIN],
      ],
    ]);
    await DAO.taxunitnotices.include(2025, [1]);
    expect(query.secondCall.args[0]).to.contain("Status = 'excluded'");
    await DAO.taxunitnotices.markSent(2025, [1], ADMIN);
    expect(query.thirdCall.args[0]).to.contain("ON DUPLICATE KEY UPDATE Status = 'sent'");
  });

  it("records a reminder only on donors who were sent the notice", async () => {
    const query = sinon.stub(DAO, "query").resolves([{ affectedRows: 1 }, []] as any);
    await DAO.taxunitnotices.markReminded(2025, [1], ADMIN);
    expect(query.firstCall.args[0]).to.contain("Reminders = Reminders + 1");
    expect(query.firstCall.args[0]).to.contain("Status = 'sent'");
    expect(query.firstCall.args[1]).to.deep.equal([ADMIN, 2025, [1]]);
  });

  it("does nothing for an empty list", async () => {
    const query = sinon.stub(DAO, "query");
    expect(await DAO.taxunitnotices.exclude(2025, [], ADMIN)).to.equal(0);
    expect(await DAO.taxunitnotices.include(2025, [])).to.equal(0);
    await DAO.taxunitnotices.markSent(2025, [], ADMIN);
    expect(query.callCount).to.equal(0);
  });
});

describe("Grouping tax units by number", () => {
  it("sums tax units sharing a national ID on several donors, to the øre", () => {
    const grouped = groupTaxUnitsBySsn([
      unit(1, 10, PERSON_A, "300.10"),
      unit(2, 11, PERSON_A, "200.20"),
      unit(3, 12, PERSON_B, "800.00"),
      unit(4, 10, ` ${PERSON_A.slice(0, 6)} ${PERSON_A.slice(6)} `, "0.70"),
    ]);
    expect(grouped).to.have.length(2);
    const a = grouped.find((group) => group.ssn === PERSON_A)!;
    expect(a.sum.toFixed(2)).to.equal("501.00");
    expect(a.donorIds).to.deep.equal([10, 11]);
    expect(a.taxUnitIds).to.deep.equal([1, 2, 4]);
    expect(a.name).to.equal("Unit 4");
  });

  it("keeps tax units without a number apart", () => {
    const grouped = groupTaxUnitsBySsn([unit(1, 10, null, "600"), unit(2, 11, "", "700")]);
    expect(grouped).to.have.length(2);
  });
});

describe("Tax report overview", () => {
  beforeEach(() => {
    sinon
      .stub(DAO.tax, "getTaxXMLReportUnits")
      .resolves([
        unit(1, 10, PERSON_A, "300.10"),
        unit(2, 11, PERSON_A, "200.00"),
        unit(3, 12, PERSON_B, "30000.00"),
        unit(4, 12, ORGANIZATION, "499.99"),
        unit(5, 13, PERSON_BAD_CHECK, "1000.00"),
        unit(6, 14, "1234567890", "100.00"),
      ]);
    sinon.stub(DAO.tax, "getDonationTotalsInYear").resolves({
      total: "33100.39",
      withoutTaxUnit: "1000.30",
      donations: 40,
    });
    sinon
      .stub(DAO.tax, "getDonorsWithoutTaxUnitInYear")
      .resolves([withoutUnit({ donorId: 20, donationsSum: "1000.30", donations: 3 })]);
    sinon.stub(DAO.taxunitnotices, "getForYear").resolves([]);
    sinon.stub(DAO.tax, "getUnconnectedGiftsInYear").resolves([
      {
        donorId: 15,
        name: "Donor 15",
        email: "donor15@example.org",
        donationsSum: "750.00",
        donations: 2,
        kids: 1,
        taxUnits: [{ id: 7, name: "Unit 7", ssn: PERSON_C }],
      },
    ]);
  });
  afterEach(() => sinon.restore());

  it("adds up to all donations in the year, to the øre", async () => {
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.totals).to.deep.equal({
      all: "33100.39",
      reported: "31500.10",
      belowMinimum: "599.99",
      leftOut: "0.00",
      withoutTaxUnit: "1000.30",
      difference: "0.00",
    });
    expect(overview.counts).to.deep.include({
      reportedUnits: 3,
      persons: 3,
      organizations: 0,
      belowMinimumUnits: 2,
      aboveMaximum: 1,
    });
  });

  it("lists donors without tax unit with name and notice status, and counts sent donors since registered", async () => {
    (DAO.tax.getDonorsWithoutTaxUnitInYear as sinon.SinonStub).resolves([
      withoutUnit({ donorId: 20, donationsSum: "600.00" }),
      withoutUnit({ donorId: 21, donationsSum: "400.30" }),
    ]);
    (DAO.taxunitnotices.getForYear as sinon.SinonStub).resolves([
      notice(21, "sent"),
      // Sent, and no longer without a tax unit
      notice(22, "sent"),
      notice(23, "excluded"),
    ]);
    const overview = await getTaxReportOverview(2025, 400);
    expect(overview.withoutTaxUnit.map((row) => [row.donorId, row.name, row.status])).to.deep.equal(
      [
        [20, "Donor 20", "notice"],
        [21, "Donor 21", "sent"],
      ],
    );
    expect(overview.sentNoLongerWithout).to.equal(1);
    // With the email address, to judge who should get the notice
    expect(overview.withoutTaxUnit[0].email).to.equal("donor20@example.org");
  });

  it("says when the year's limits are not in the code", async () => {
    expect((await getTaxReportOverview(2025, 500)).limitsInCode).to.equal(true);
    const future = await getTaxReportOverview(2099, 500);
    expect(future.limitsInCode).to.equal(false);
    expect(future.maximumDeduction).to.equal(25000);
  });

  it("shows a difference when the parts don't add up", async () => {
    (DAO.tax.getDonationTotalsInYear as sinon.SinonStub).resolves({
      total: "33100.40",
      withoutTaxUnit: "1000.30",
      donations: 40,
    });
    expect((await getTaxReportOverview(2025, 500)).totals.difference).to.equal("0.01");
  });

  it("counts units left out by an admin apart, still adding up, and lists them with the reason", async () => {
    (DAO.taxreportexclusions.getForYear as sinon.SinonStub).resolves([
      // One of the two units with PERSON_A takes the whole number out
      { taxUnitId: 2, reason: "Altinn: unknown number", createdBy: ADMIN, created: new Date() },
      { taxUnitId: 5, reason: "Can't reach the donor", createdBy: ADMIN, created: new Date() },
    ]);
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.totals).to.deep.include({
      reported: "30000.00",
      leftOut: "1500.10",
      difference: "0.00",
    });
    expect(overview.counts).to.deep.include({ reportedUnits: 1, leftOutUnits: 2 });
    expect(
      overview.leftOut.map((unit) => [unit.taxUnitIds, unit.reason, unit.aboveMinimum]),
    ).to.deep.equal([
      [[5], "Can't reach the donor", true],
      [[1, 2], "Altinn: unknown number", true],
    ]);
    // A left-out unit with an invalid number no longer blocks the file
    expect(overview.invalidNumbers[0]).to.deep.include({ reported: false, leftOut: true });
    expect(JSON.stringify(overview)).to.not.contain(PERSON_A);
  });

  it("lists no changes until a file is marked as sent", async () => {
    (DAO.taxreports.getForYear as sinon.SinonStub).resolves([file(3, null)]);
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.files).to.have.length(1);
    expect(overview.changes).to.equal(null);
  });

  it("lists units whose amount in the report changed since the sent file, in whole kroner", async () => {
    (DAO.taxreports.getForYear as sinon.SinonStub).resolves([file(4, null), file(3, new Date())]);
    const amounts = sinon.stub(DAO.taxreports, "getUnitAmounts").resolves(
      new Map([
        // PERSON_A: 300.10 + 200.00 now; filed 300.10 + 100.00
        [1, "300.10"],
        [2, "100.00"],
        // PERSON_B: unchanged
        [3, "30000.00"],
        // Unit 5 (invalid number) is reported now too, unchanged
        [5, "1000.00"],
        // In the file, no gifts in the year now
        [40, "800.00"],
      ]),
    );
    sinon.stub(DAO.tax, "getById").resolves(null);
    const overview = await getTaxReportOverview(2025, 500);
    expect(amounts.firstCall.args).to.deep.equal([3]);
    expect(overview.changes?.basis.id).to.equal(3);
    expect(
      overview.changes?.rows.map((row) => [row.taxUnitIds, row.filed, row.now, row.difference]),
    ).to.deep.equal([
      [[40], "800.00", "0.00", "-800.00"],
      [[1, 2], "400.00", "500.00", "100.00"],
    ]);
    expect(JSON.stringify(overview.changes)).to.not.contain(PERSON_A);
  });

  it("lists gifts not on the donor's own tax unit, with the units masked", async () => {
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.unconnected).to.deep.equal([
      {
        donorId: 15,
        name: "Donor 15",
        email: "donor15@example.org",
        donationsSum: "750.00",
        donations: 2,
        kids: 1,
        taxUnits: [{ id: 7, name: "Unit 7", maskedNumber: `${PERSON_C.slice(0, 4)}•••••••` }],
      },
    ]);
    expect(JSON.stringify(overview)).to.not.contain(PERSON_C);
  });

  it("lists duplicates and invalid numbers by donor, without the numbers", async () => {
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.duplicates).to.deep.equal([
      { reason: "sameNumber", donorIds: [10, 11], taxUnitIds: [1, 2], sum: "500.10" },
      { reason: "severalUnits", donorIds: [12], taxUnitIds: [3, 4], sum: "30499.99" },
    ]);
    expect(overview.invalidNumbers).to.deep.equal([
      {
        donorIds: [13],
        taxUnitIds: [5],
        name: "Unit 5",
        maskedNumber: `${PERSON_BAD_CHECK.slice(0, 4)}•••••••`,
        problem: "Invalid check digit (national ID)",
        sum: "1000.00",
        reported: true,
        leftOut: false,
      },
      {
        donorIds: [14],
        taxUnitIds: [6],
        name: "Unit 6",
        maskedNumber: "1234••••••",
        problem: "Wrong length (10 characters, expected 11 or 9)",
        sum: "100.00",
        reported: false,
        leftOut: false,
      },
    ]);
    const json = JSON.stringify(overview);
    for (const id of [PERSON_A, PERSON_B, ORGANIZATION, PERSON_BAD_CHECK, "1234567890"]) {
      expect(json).to.not.contain(id);
    }
  });
});

describe("Skatteetaten XML report", () => {
  afterEach(() => sinon.restore());
  const fetchXsd = async () => xsd;

  it("reports one entry per national ID with the summed amount", async () => {
    sinon
      .stub(DAO.tax, "getTaxXMLReportUnits")
      .resolves([
        unit(1, 10, PERSON_A, "300.40"),
        unit(2, 11, PERSON_A, "300.40"),
        unit(3, 12, ORGANIZATION, "499.00"),
      ]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([
        ["Org AS", ORGANIZATION, "100", "TRUE"],
        ["Only EA", PERSON_C, '"1,000.50"', "FALSE"],
      ]),
      contact,
      fetchXsd,
    );
    if (!result.ok) expect.fail(JSON.stringify(result.errors));
    expect(result.xml.match(/<oppgave>/g)).to.have.length(3);
    expect(result.xml).to.contain(["<foedselsnummer>", PERSON_A, "</foedselsnummer>"].join(""));
    expect(result.xml).to.contain("<beloep>601</beloep>");
    expect(result.xml).to.contain("<beloep>599</beloep>");
    expect(result.xml).to.contain("<beloep>1001</beloep>");
    expect(result.xml).to.contain("<antallOppgaver>3</antallOppgaver>");
    expect(result.xml).to.contain("<sumBeloep>2201</sumBeloep>");
    expect(result).to.deep.include({
      units: 3,
      sum: "2201.00",
      giverportalSum: "1100.50",
      leftOut: 0,
    });
    // Our units in the file with their own amounts, for Tax_reports
    expect(result.ourUnits).to.deep.equal([
      { taxUnitId: 1, amount: "300.40" },
      { taxUnitId: 2, amount: "300.40" },
      { taxUnitId: 3, amount: "499.00" },
    ]);
  });

  it("leaves units out of the file by number, EA Giverportal's row too", async () => {
    sinon
      .stub(DAO.tax, "getTaxXMLReportUnits")
      .resolves([
        unit(1, 10, PERSON_A, "600"),
        unit(2, 12, PERSON_BAD_CHECK, "800"),
        unit(3, 13, ORGANIZATION, "700"),
      ]);
    (DAO.taxreportexclusions.getForYear as sinon.SinonStub).resolves([
      { taxUnitId: 1, reason: "Altinn", createdBy: ADMIN, created: new Date() },
      { taxUnitId: 2, reason: "Bad number", createdBy: ADMIN, created: new Date() },
    ]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      // TRUE for a number we left out would otherwise be an error
      csv([["Left out", PERSON_A, "100", "TRUE"]]),
      contact,
      fetchXsd,
    );
    if (!result.ok) expect.fail(JSON.stringify(result.errors));
    expect(result.xml).to.not.contain(PERSON_A);
    expect(result.xml).to.not.contain(PERSON_BAD_CHECK);
    expect(result).to.deep.include({ units: 1, sum: "700.00", giverportalSum: "0.00", leftOut: 2 });
  });

  it("returns invalid numbers as errors instead of skipping them, without the number", async () => {
    sinon
      .stub(DAO.tax, "getTaxXMLReportUnits")
      .resolves([unit(1, 10, PERSON_BAD_CHECK, "800"), unit(2, 11, "1234567890", "900")]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([["EA person", "01018512376", "600", "FALSE"]]),
      contact,
      fetchXsd,
    );
    if (result.ok) expect.fail("expected errors");
    expect(result.errors.map((error) => [error.kind, error.donorIds])).to.deep.equal([
      ["invalidNumber", undefined],
      ["invalidNumber", [11]],
      ["invalidNumber", [10]],
    ]);
    const json = JSON.stringify(result.errors);
    for (const id of [PERSON_BAD_CHECK, "1234567890", "01018512376"]) {
      expect(json).to.not.contain(id);
    }
  });

  it("returns mismatches with EA Giverportal as errors", async () => {
    sinon.stub(DAO.tax, "getTaxXMLReportUnits").resolves([unit(1, 10, PERSON_A, "800")]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([
        ["A", PERSON_A, "100", "FALSE"],
        ["B", PERSON_B, "100", "TRUE"],
      ]),
      contact,
      fetchXsd,
    );
    if (result.ok) expect.fail("expected errors");
    expect(result.errors.map((error) => error.kind)).to.deep.equal(["giverportal", "giverportal"]);
    expect(result.errors[0].donorIds).to.deep.equal([10]);
  });

  it("stops on schema errors and when the schema can't be fetched", async () => {
    sinon.stub(DAO.tax, "getTaxXMLReportUnits").resolves([unit(1, 10, PERSON_A, "800")]);
    // Skatteetaten allows 20 characters
    const longName = { ...contact, phoneNumber: "+47 999 99 999 / 999 99 999" };
    const invalid = await createXMLReportToTaxAuthorities(2025, 500, csv([]), longName, fetchXsd);
    if (invalid.ok) expect.fail("expected schema errors");
    expect(invalid.errors[0].kind).to.equal("xsd");

    const offline = await createXMLReportToTaxAuthorities(2025, 500, csv([]), contact, () =>
      Promise.reject(new Error("offline")),
    );
    if (offline.ok) expect.fail("expected an error");
    expect(offline.errors[0].message).to.contain("Could not fetch");
  });

  it("returns CSV problems as errors without the number", async () => {
    sinon.stub(DAO.tax, "getTaxXMLReportUnits").resolves([]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([["A", "0101851236", "100", "TRUE"]]),
      contact,
      fetchXsd,
    );
    if (result.ok) expect.fail("expected an error");
    expect(result.errors[0].kind).to.equal("csv");
    expect(result.errors[0].message).to.not.contain("0101851236");
  });
});

describe("tRPC reports.tax", () => {
  let markSent: sinon.SinonStub;
  beforeEach(() => {
    sinon.stub(DAO.taxunitnotices, "getForYear").resolves([]);
    markSent = sinon.stub(DAO.taxunitnotices, "markSent").resolves();
  });
  afterEach(() => sinon.restore());

  it("is for admins only", async () => {
    try {
      await callerWith().reports.tax.overview({ year: 2025, minSum: 500 });
      expect.fail("expected UNAUTHORIZED");
    } catch (err: any) {
      expect(err.code).to.equal("UNAUTHORIZED");
    }
  });

  it("returns errors from the XML builder instead of a file", async () => {
    sinon.stub(DAO.tax, "getTaxXMLReportUnits").resolves([unit(1, 10, PERSON_BAD_CHECK, "800")]);
    const formData = new FormData();
    formData.append("report", new File([csv([])], "giverportal.csv", { type: "text/csv" }));
    for (const [key, value] of Object.entries({ ...contact, year: "2025", minSum: "500" })) {
      formData.append(key, value);
    }
    const result = await callerWith(["admin"]).reports.tax.skatteetaten(formData);
    expect(result.file).to.equal(null);
    expect(result.errors).to.have.length(1);
    // Only files actually made are recorded
    expect((DAO.taxreports.record as sinon.SinonStub).callCount).to.equal(0);
  });

  it("marks a file as sent, saying who, and lists the years with a sent file", async () => {
    const mark = sinon.stub(DAO.taxreports, "markSubmitted").resolves(true);
    sinon
      .stub(DAO.taxreports, "getSubmittedYears")
      .resolves([{ year: 2025, submitted: new Date("2026-01-19T10:00:00Z") }]);
    const caller = callerWith(["admin"]).reports.tax;
    expect(await caller.markSubmitted({ reportId: 3 })).to.deep.equal({ changed: true });
    expect(mark.firstCall.args).to.deep.equal([3, ADMIN]);
    expect(await caller.submittedYears()).to.deep.equal([
      { year: 2025, submitted: new Date("2026-01-19T10:00:00Z") },
    ]);
  });

  it("sends the missing tax unit notice in test mode to the test address", async () => {
    sinon
      .stub(DAO.tax, "getDonorsWithoutTaxUnitInYear")
      .resolves([
        withoutUnit({ donorId: 1, email: "a@example.org", donationsSum: "900.00" }),
        withoutUnit({ donorId: 2, email: "b@example.org", donationsSum: "800.00" }),
      ]);
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      testEmail: "test@example.org",
      testLimit: 1,
    });
    expect(result).to.deep.equal({
      round: "notice",
      total: 1,
      success: 1,
      failed: 0,
      testMode: true,
      donorsMarkedSent: 0,
    });
    expect(send.callCount).to.equal(1);
    expect(send.firstCall.args[2]).to.equal("test@example.org");
    // A test moves nobody to Sent
    expect(markSent.callCount).to.equal(0);
  });

  const twoDonors = () =>
    sinon
      .stub(DAO.tax, "getDonorsWithoutTaxUnitInYear")
      .resolves([
        withoutUnit({ donorId: 1, email: "a@example.org", donationsSum: "900.00" }),
        withoutUnit({ donorId: 2, email: "b@example.org", donationsSum: "800.00" }),
      ]);

  it("refuses to email the donors without the year repeated in confirmYear", async () => {
    twoDonors();
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    for (const input of [
      { year: 2025, minSum: 500 },
      { year: 2025, minSum: 500, confirmYear: 2024 },
    ]) {
      try {
        await callerWith(["admin"]).reports.tax.missingTaxUnitNotice(input);
        expect.fail("expected BAD_REQUEST");
      } catch (err: any) {
        expect(err.code).to.equal("BAD_REQUEST");
      }
    }
    expect(send.callCount).to.equal(0);
  });

  it("refuses testLimit without testEmail, which would email real donors", async () => {
    twoDonors();
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    try {
      await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
        year: 2025,
        minSum: 500,
        testLimit: 1,
      });
      expect.fail("expected BAD_REQUEST");
    } catch (err: any) {
      expect(err.code).to.equal("BAD_REQUEST");
    }
    expect(send.callCount).to.equal(0);
  });

  it("emails the donors themselves when the year is confirmed, and says it isn't a test", async () => {
    twoDonors();
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
    });
    expect(result).to.deep.equal({
      round: "notice",
      total: 2,
      success: 2,
      failed: 0,
      testMode: false,
      donorsMarkedSent: 2,
    });
    expect(send.getCalls().map((call) => call.args[2])).to.have.members([
      "a@example.org",
      "b@example.org",
    ]);
    expect(markSent.callCount).to.equal(1);
    expect(markSent.firstCall.args).to.deep.equal([2025, [1, 2], ADMIN]);
  });

  it("records only the donors the email reached, and skips those left out or sent before", async () => {
    sinon.stub(DAO.tax, "getDonorsWithoutTaxUnitInYear").resolves([
      withoutUnit({ donorId: 1, email: "a@example.org", donationsSum: "900.00" }),
      withoutUnit({ donorId: 2, email: "b@example.org", donationsSum: "800.00" }),
      withoutUnit({ donorId: 3, email: "c@example.org", donationsSum: "700.00" }),
      withoutUnit({ donorId: 4, email: "d@example.org", donationsSum: "600.00" }),
      // Same address as donor 1: one email, both recorded
      withoutUnit({ donorId: 5, email: "A@example.org", donationsSum: "550.00" }),
    ]);
    (DAO.taxunitnotices.getForYear as sinon.SinonStub).resolves([
      notice(3, "excluded"),
      notice(4, "sent"),
    ]);
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice");
    send.withArgs(sinon.match({ email: "a@example.org" })).resolves(true);
    send.withArgs(sinon.match({ email: "b@example.org" })).resolves(false);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
    });
    expect(send.getCalls().map((call) => call.args[2])).to.have.members([
      "a@example.org",
      "b@example.org",
    ]);
    expect(result).to.deep.include({ total: 2, success: 1, failed: 1, donorsMarkedSent: 2 });
    expect(markSent.firstCall.args).to.deep.equal([2025, [1, 5], ADMIN]);
  });

  it("moves donors to Left out and back, saying who did it", async () => {
    const exclude = sinon.stub(DAO.taxunitnotices, "exclude").resolves(2);
    const include = sinon.stub(DAO.taxunitnotices, "include").resolves(1);
    const caller = callerWith(["admin"]).reports.tax;
    expect(
      await caller.noticeStatus({ year: 2025, donorIds: [1, 2], status: "excluded" }),
    ).to.deep.equal({ changed: 2 });
    expect(exclude.firstCall.args).to.deep.equal([2025, [1, 2], ADMIN]);
    expect(
      await caller.noticeStatus({ year: 2025, donorIds: [1], status: "notice" }),
    ).to.deep.equal({ changed: 1 });
    expect(include.firstCall.args).to.deep.equal([2025, [1]]);
  });

  it("refuses an unconfirmed send in the sending code too (the REST route uses it)", async () => {
    twoDonors();
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    let error: Error | undefined;
    try {
      await sendMissingTaxUnitNotices({ year: 2025, minSum: 500 });
    } catch (err: any) {
      error = err;
    }
    expect(error?.message).to.match(/confirmYear/);
    expect(send.callCount).to.equal(0);
  });
});

describe("Sending to chosen donors, reminders and the preview", () => {
  let markSent: sinon.SinonStub;
  let markReminded: sinon.SinonStub;
  beforeEach(() => {
    sinon.stub(DAO.tax, "getDonorsWithoutTaxUnitInYear").resolves([
      withoutUnit({ donorId: 1, email: "a@example.org", donationsSum: "900.00" }),
      withoutUnit({ donorId: 2, email: "b@example.org", donationsSum: "800.00" }),
      withoutUnit({ donorId: 3, email: "c@example.org", donationsSum: "700.00" }),
      // Sent, and has since been deleted: no reminder
      withoutUnit({ donorId: 4, email: "d@example.org", donationsSum: "600.00", trashed: true }),
    ]);
    sinon.stub(DAO.taxunitnotices, "getForYear").resolves([notice(3, "sent"), notice(4, "sent")]);
    markSent = sinon.stub(DAO.taxunitnotices, "markSent").resolves();
    markReminded = sinon.stub(DAO.taxunitnotices, "markReminded").resolves();
  });
  afterEach(() => sinon.restore());

  it("sends the notice only to the ticked donors of Gets the notice", async () => {
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
      // 3 is in Sent: the notice round doesn't send to it again
      donorIds: [2, 3],
    });
    expect(send.getCalls().map((call) => call.args[2])).to.deep.equal(["b@example.org"]);
    expect(result).to.deep.include({ round: "notice", total: 1, donorsMarkedSent: 1 });
    expect(markSent.firstCall.args).to.deep.equal([2025, [2], ADMIN]);
  });

  it("reminds the donors in Sent the rules still allow, and records the reminder", async () => {
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
      round: "reminder",
    });
    expect(send.getCalls().map((call) => [call.args[2], call.args[3]])).to.deep.equal([
      ["c@example.org", { reminder: true }],
    ]);
    expect(result).to.deep.include({ round: "reminder", total: 1, donorsMarkedSent: 1 });
    expect(markReminded.firstCall.args).to.deep.equal([2025, [3], ADMIN]);
    expect(markSent.callCount).to.equal(0);
  });

  it("a reminder needs the year confirmed like the notice", async () => {
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    try {
      await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
        year: 2025,
        minSum: 500,
        round: "reminder",
      });
      expect.fail("expected BAD_REQUEST");
    } catch (err: any) {
      expect(err.code).to.equal("BAD_REQUEST");
    }
    expect(send.callCount).to.equal(0);
  });

  it("previews the round: how many, and the email for the first recipient, sending nothing", async () => {
    const send = sinon.stub(mail, "sendMissingTaxUnitNotice").resolves(true);
    const build = sinon
      .stub(mail, "buildMissingTaxUnitNotice")
      .resolves({ templateId: "template-1", personalization: { name: "Donor" } });
    const preview = await callerWith(["admin"]).reports.tax.noticePreview({
      year: 2025,
      minSum: 500,
      round: "notice",
    });
    expect(preview).to.deep.include({ round: "notice", emails: 2, donors: 2, problem: null });
    expect(preview.example).to.deep.include({ donorIds: [1], email: "a@example.org" });
    expect(preview.mail).to.deep.equal({
      templateId: "template-1",
      personalization: { name: "Donor" },
    });
    expect(build.firstCall.args[2]).to.deep.equal({ reminder: false });
    expect(send.callCount).to.equal(0);
    expect(markSent.callCount).to.equal(0);

    build.resolves(null);
    const reminder = await callerWith(["admin"]).reports.tax.noticePreview({
      year: 2025,
      minSum: 500,
      round: "reminder",
    });
    expect(reminder).to.deep.include({ emails: 1, mail: null });
    expect(reminder.problem).to.match(/limits/);
  });

  it("shows reminders in the overview, and who a reminder would go to", async () => {
    sinon.stub(DAO.tax, "getTaxXMLReportUnits").resolves([]);
    sinon
      .stub(DAO.tax, "getDonationTotalsInYear")
      .resolves({ total: "0", withoutTaxUnit: "0", donations: 0 });
    sinon.stub(DAO.tax, "getUnconnectedGiftsInYear").resolves([]);
    (DAO.taxunitnotices.getForYear as sinon.SinonStub).resolves([
      { ...notice(3, "sent"), reminders: 2, lastReminded: new Date("2026-12-01T09:00:00Z") },
      notice(4, "sent"),
    ]);
    const overview = await getTaxReportOverview(2025, 500);
    const row = (id: number) => overview.withoutTaxUnit.find((donor) => donor.donorId === id)!;
    expect(row(3)).to.deep.include({ reminders: 2, canRemind: true });
    expect(row(4)).to.deep.include({ reminders: 0, canRemind: false });
    expect(row(1).canRemind).to.equal(false);
  });
});

describe("Leaving tax units out of the report", () => {
  it("saves the reason and who, and puts units back", async () => {
    sinon
      .stub(DAO.tax, "getById")
      .resolves({ id: 5, donorId: 13, name: "Unit 5", ssn: PERSON_A, archived: null as any });
    const exclude = sinon.stub(DAO.taxreportexclusions, "exclude").resolves(true);
    const include = sinon.stub(DAO.taxreportexclusions, "include").resolves(1);
    const caller = callerWith(["admin"]).reports.tax;
    expect(
      await caller.excludeUnit({ year: 2025, taxUnitId: 5, reason: "  Altinn: unknown  " }),
    ).to.deep.equal({ changed: true });
    expect(exclude.firstCall.args).to.deep.equal([2025, 5, "Altinn: unknown", ADMIN]);
    expect(await caller.includeUnits({ year: 2025, taxUnitIds: [5] })).to.deep.equal({
      changed: 1,
    });
    expect(include.firstCall.args).to.deep.equal([2025, [5]]);
  });

  it("needs a reason", async () => {
    try {
      await callerWith(["admin"]).reports.tax.excludeUnit({ year: 2025, taxUnitId: 5, reason: "" });
      expect.fail("expected BAD_REQUEST");
    } catch (err: any) {
      expect(err.code).to.equal("BAD_REQUEST");
    }
  });
});

describe("Connecting gifts to the donor's tax unit", () => {
  afterEach(() => sinon.restore());

  const setUp = () => {
    sinon
      .stub(DAO.tax, "getById")
      .callsFake(async (id: number) =>
        id === 7
          ? { id: 7, donorId: 15, name: "Unit 7", ssn: PERSON_C, archived: null as any }
          : id === 8
            ? { id: 8, donorId: 15, name: "Old", ssn: PERSON_C, archived: "2024-01-01" as any }
            : { id, donorId: 99, name: "Other", ssn: PERSON_A, archived: null as any },
      );
    sinon.stub(DAO.tax, "getKIDsWithoutTaxUnitInYear").resolves([
      { kid: "111", fundraiser: false, hasEarlier: false },
      // An AvtaleGiro KID with gifts from 2024 too: those stay as reported
      { kid: "222", fundraiser: false, hasEarlier: true },
      { kid: "333", fundraiser: true, hasEarlier: false },
    ]);
    sinon.stub(DAO.distributions, "getAllByDonor").resolves({
      donorID: 15,
      distributions: [{ kid: "222", donorId: 15, taxUnitId: null, causeAreas: [] } as any],
    });
    sinon.stub(donationHelpers, "createKID").resolves("999999999999999");
    return {
      add: sinon.stub(DAO.distributions, "add").resolves(true),
      move: sinon.stub(DAO.tax, "moveDonationsBefore").resolves(4),
      connect: sinon.stub(DAO.distributions, "addTaxUnitToDistribution").resolves(),
    };
  };

  it("puts the year's KIDs on the tax unit and keeps earlier gifts on a copy without it", async () => {
    const { add, move, connect } = setUp();
    const result = await callerWith(["admin"]).reports.tax.connectToTaxUnit({
      year: 2026,
      donorId: 15,
      taxUnitId: 7,
    });
    expect(result).to.deep.equal({ kids: 3, copiedKids: 1, earlierDonationsKept: 4 });
    expect(add.firstCall.args[0]).to.deep.include({ kid: "999999999999999", taxUnitId: null });
    expect(move.firstCall.args.slice(0, 2)).to.deep.equal(["222", "999999999999999"]);
    // From the start of the gift year
    expect((move.firstCall.args[2] as Date).toISOString()).to.equal(
      taxYearRange(2026).from.toISOString(),
    );
    expect(connect.getCalls().map((call) => call.args)).to.deep.equal([
      ["111", 7],
      ["222", 7],
      ["333", 7],
    ]);
  });

  it("refuses another donor's tax unit, and an archived one", async () => {
    const { connect } = setUp();
    for (const taxUnitId of [9, 8]) {
      try {
        await callerWith(["admin"]).reports.tax.connectToTaxUnit({
          year: 2026,
          donorId: 15,
          taxUnitId,
        });
        expect.fail("expected BAD_REQUEST");
      } catch (err: any) {
        expect(err.code).to.equal("BAD_REQUEST");
      }
    }
    expect(connect.callCount).to.equal(0);
  });
});

describe("Comparing possible duplicate donors", () => {
  afterEach(() => sinon.restore());

  it("returns the donors side by side with the numbers masked", async () => {
    sinon.stub(DAO.tax, "getDonorsForComparison").resolves([
      {
        id: 10,
        name: "Donor 10",
        email: "donor10@example.org",
        registered: new Date("2024-01-01T00:00:00Z"),
        trashed: false,
        donations: 3,
        donationsSum: "300.00",
        lastDonation: null,
        kids: 1,
        agreements: 0,
        activeAgreements: 0,
        taxUnits: [{ id: 1, name: "Unit 1", ssn: PERSON_A, archived: false }],
      },
    ]);
    const [donor] = await compareDonors([10, 11]);
    expect(donor.taxUnits).to.deep.equal([
      { id: 1, name: "Unit 1", maskedNumber: `${PERSON_A.slice(0, 4)}•••••••`, archived: false },
    ]);
    expect(JSON.stringify(donor)).to.not.contain(PERSON_A);
  });
});
