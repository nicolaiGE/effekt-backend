import { describe, it, beforeEach, afterEach } from "vitest";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import type { Request, Response } from "express";
import sinon from "sinon";
import { DAO } from "../custom_modules/DAO";
import type { DonorWithoutTaxUnitRow, TaxUnitYearSum } from "../custom_modules/DAO_modules/tax";
import {
  ANONYMOUS_DONOR_ID,
  classifyDonorsWithoutTaxUnit,
  noticeRecipients,
  sendMissingTaxUnitNotices,
} from "../custom_modules/missingTaxUnitNotices";
import * as mail from "../custom_modules/mail";
import { checkNorwegianId, maskIdNumbers } from "../custom_modules/norwegianId";
import { osloYearRange } from "../custom_modules/osloDays";
import { LAST_UTC_TAX_YEAR, taxYearRange } from "../custom_modules/DAO_modules/tax";
import {
  createXMLReportToTaxAuthorities,
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
    auth: permissions ? { permissions } : undefined,
  });

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
  });
  afterEach(() => sinon.restore());

  it("adds up to all donations in the year, to the øre", async () => {
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.totals).to.deep.equal({
      all: "33100.39",
      reported: "31500.10",
      belowMinimum: "599.99",
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

  it("shows a difference when the parts don't add up", async () => {
    (DAO.tax.getDonationTotalsInYear as sinon.SinonStub).resolves({
      total: "33100.40",
      withoutTaxUnit: "1000.30",
      donations: 40,
    });
    expect((await getTaxReportOverview(2025, 500)).totals.difference).to.equal("0.01");
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
        problem: "Invalid check digit (national ID)",
        sum: "1000.00",
        reported: true,
      },
      {
        donorIds: [14],
        taxUnitIds: [6],
        problem: "Wrong length (10 characters, expected 11 or 9)",
        sum: "100.00",
        reported: false,
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
    expect(result).to.deep.include({ units: 3, sum: "2201.00", giverportalSum: "1100.50" });
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
    expect(result).to.deep.equal({ total: 1, success: 1, failed: 0, testMode: true });
    expect(send.callCount).to.equal(1);
    expect(send.firstCall.args[2]).to.equal("test@example.org");
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
    expect(result).to.deep.equal({ total: 2, success: 2, failed: 0, testMode: false });
    expect(send.getCalls().map((call) => call.args[2])).to.have.members([
      "a@example.org",
      "b@example.org",
    ]);
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
