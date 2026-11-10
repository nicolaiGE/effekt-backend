import { DateTime } from "luxon";
import { DAO } from "./DAO";
import { donationHelpers } from "./donationHelpers";
import { validateXML } from "xmllint-wasm";
import { Decimal } from "decimal.js";
import { EANTaxUnitsRow, parseEanTaxUnits } from "./parsers/eanTaxUnits";
import type { TaxUnitYearSum } from "./DAO_modules/tax";
import {
  classifyDonorsWithoutTaxUnit,
  noticeExclusionLabels,
  type NoticeExclusion,
  type NoticeStatus,
} from "./missingTaxUnitNotices";
import { checkNorwegianId, describeNorwegianIdProblem, maskIdNumbers } from "./norwegianId";
import { norwegianTaxDeductionLimits } from "./taxdeductions";

export async function connectDonationsForFirstTaxUnit(donorId: number, taxUnitId: number) {
  /**
   * If we add the donors first tax unit, we want to connect all donations for the
   * current year and the previous year to the new tax unit. We should avoid connecting
   * donations from previous years, as we have already reported them to the tax authorities.
   */

  // Get all distributions for the donor
  const { distributions } = await DAO.distributions.getAllByDonor(donorId);

  // Update the distributions to have the new tax unit
  await DAO.distributions.connectFirstTaxUnit(donorId, taxUnitId);

  // Get all the donations given before the current year
  const donations = await DAO.donations.getByDonorId(donorId);

  const filteredDonations = donations.filter((donation) => {
    const donationDate = new Date(donation.timestamp!);
    const currentYear = new Date().getFullYear();
    return donationDate.getFullYear() < currentYear;
  });

  const distributionsNeedingReplacement = new Set(
    filteredDonations.map((donation) => donation.KID),
  );

  for (const KID of distributionsNeedingReplacement) {
    const oldDistribution = distributions.find((distribution) => distribution.kid === KID);

    // Skip fundraiser distributions - they have unique KIDs that should not be replaced
    // Each fundraiser donation has its own KID linked to a specific fundraiser transaction
    if (oldDistribution?.fundraiserTransactionId) {
      continue;
    }

    /**
     * First we make a copy of the old distribution (without a tax unit)
     * and add it with a new KID
     */
    const replacementKID = await donationHelpers.createKID(15, donorId);

    const newDistribution = {
      ...oldDistribution!,
      kid: replacementKID,
    };

    await DAO.distributions.add(newDistribution);

    /**
     * Then we update the donations from before the current year to use the new KID
     * for the distribution that has no tax unit (since those donations are already reported)
     */
    const previousYearStart = DateTime.now().minus({ years: 1 }).startOf("year");
    await DAO.donations.updateKIDBeforeTimestamp(KID, replacementKID, previousYearStart);
  }
}

//region Skatteetaten report

/** Skatteetaten's schema for the report, fetched when the XML is built */
export const SKATTEETATEN_XSD_URL =
  "https://www.skatteetaten.no/contentassets/3bcbe50b50924c4297c2b62eb89a38da/v2_0_3/gavefrivilligorganisasjon_v2_0.xsd";

/** Used when the year has no entry in norwegianTaxDeductionLimits */
const DEFAULT_MAXIMUM_DEDUCTION = 25000;

/** One reportable tax unit: every tax unit in our database with the same number, summed */
export type GroupedTaxUnit = {
  /** The number, without whitespace. Empty when the tax unit has none */
  ssn: string;
  name: string;
  sum: Decimal;
  donorIds: number[];
  taxUnitIds: number[];
};

/**
 * Groups tax unit sums by national ID or organization number and adds them up. The same number on
 * several tax units (often one person registered on several donors) is one unit for Skatteetaten.
 * Tax units without a number are kept apart, one each.
 */
export function groupTaxUnitsBySsn(rows: TaxUnitYearSum[]): GroupedTaxUnit[] {
  const groups = new Map<string, GroupedTaxUnit>();
  for (const row of rows) {
    const ssn = (row.ssn ?? "").replace(/\s/g, "");
    const key = ssn === "" ? `unit:${row.taxUnitId}` : ssn;
    const group = groups.get(key);
    if (group) {
      group.sum = group.sum.add(row.donationsSum);
      if (!group.donorIds.includes(row.donorId)) group.donorIds.push(row.donorId);
      group.taxUnitIds.push(row.taxUnitId);
      // The name of the newest tax unit
      if (row.taxUnitId > Math.max(...group.taxUnitIds.slice(0, -1))) group.name = row.name;
    } else {
      groups.set(key, {
        ssn,
        name: row.name,
        sum: new Decimal(row.donationsSum),
        donorIds: [row.donorId],
        taxUnitIds: [row.taxUnitId],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.sum.comparedTo(a.sum));
}

const money = (value: Decimal) => value.toFixed(2);

export type TaxReportOverview = {
  year: number;
  minSum: number;
  maximumDeduction: number;
  /** Decimal strings in kroner */
  totals: {
    /** All donations confirmed in the year */
    all: string;
    /** On tax units with at least minSum in the year */
    reported: string;
    /** On tax units with less than minSum */
    belowMinimum: string;
    /** On distributions without a tax unit */
    withoutTaxUnit: string;
    /** all - (reported + belowMinimum + withoutTaxUnit); "0.00" when the figures add up */
    difference: string;
  };
  counts: {
    donations: number;
    /** Tax units (grouped by number) with at least minSum */
    reportedUnits: number;
    persons: number;
    organizations: number;
    belowMinimumUnits: number;
    /** Reported units above the maximum deduction */
    aboveMaximum: number;
  };
  /**
   * Donors with at least minSum in the year on distributions without a tax unit, and whether
   * they get the missing tax unit notice, are left out (and why) or have been sent it. Names, no
   * email addresses.
   */
  withoutTaxUnit: {
    donorId: number;
    name: string | null;
    donationsSum: string;
    fundraiserSum: string;
    donations: number;
    taxUnits: number;
    exclusion: NoticeExclusion | null;
    exclusionLabel: string | null;
    status: NoticeStatus;
    /** Who sent the notice or left the donor out by hand, and when */
    statusBy: string | null;
    statusAt: Date | null;
  }[];
  /**
   * Donors sent the notice for the year who are no longer in withoutTaxUnit: they have since
   * registered a tax unit (or their gifts moved onto one)
   */
  sentNoLongerWithout: number;
  /** Possible duplicates, without the number */
  duplicates: {
    reason: "sameNumber" | "severalUnits";
    donorIds: number[];
    taxUnitIds: number[];
    sum: string;
  }[];
  /** Tax units with donations in the year whose number Skatteetaten would reject */
  invalidNumbers: {
    donorIds: number[];
    taxUnitIds: number[];
    problem: string;
    sum: string;
    /** Whether the unit is in the report (at least minSum) */
    reported: boolean;
  }[];
};

/**
 * Control figures and deviation lists for the tax deduction report, from our database only (the
 * EA Giverportal CSV is added when the XML is built). Contains no national IDs.
 */
export async function getTaxReportOverview(
  year: number,
  minSum: number,
): Promise<TaxReportOverview> {
  const [rows, totals, withoutTaxUnit, notices] = await Promise.all([
    DAO.tax.getTaxXMLReportUnits(year),
    DAO.tax.getDonationTotalsInYear(year),
    DAO.tax.getDonorsWithoutTaxUnitInYear(year, minSum),
    DAO.taxunitnotices.getForYear(year),
  ]);
  const stillWithout = new Set(withoutTaxUnit.map((row) => row.donorId));
  const units = groupTaxUnitsBySsn(rows);
  const maximumDeduction =
    norwegianTaxDeductionLimits[year]?.maximumDeductionLimit ?? DEFAULT_MAXIMUM_DEDUCTION;

  const reported = units.filter((unit) => unit.sum.gte(minSum));
  const below = units.filter((unit) => unit.sum.lt(minSum));
  const sumOf = (list: GroupedTaxUnit[]) =>
    list.reduce((acc, unit) => acc.add(unit.sum), new Decimal(0));
  const reportedSum = sumOf(reported);
  const belowSum = sumOf(below);
  const all = new Decimal(totals.total);
  const difference = all.sub(reportedSum).sub(belowSum).sub(totals.withoutTaxUnit);

  const duplicates: TaxReportOverview["duplicates"] = units
    .filter((unit) => unit.donorIds.length > 1)
    .map((unit) => ({
      reason: "sameNumber" as const,
      donorIds: unit.donorIds,
      taxUnitIds: unit.taxUnitIds,
      sum: money(unit.sum),
    }));
  const rowsByDonor = new Map<number, TaxUnitYearSum[]>();
  for (const row of rows)
    rowsByDonor.set(row.donorId, [...(rowsByDonor.get(row.donorId) ?? []), row]);
  for (const [donorId, donorRows] of rowsByDonor) {
    if (donorRows.length < 2) continue;
    duplicates.push({
      reason: "severalUnits",
      donorIds: [donorId],
      taxUnitIds: donorRows.map((row) => row.taxUnitId),
      sum: money(donorRows.reduce((acc, row) => acc.add(row.donationsSum), new Decimal(0))),
    });
  }

  const invalidNumbers = units.flatMap((unit) => {
    const problem = describeNorwegianIdProblem(unit.ssn);
    return problem
      ? [
          {
            donorIds: unit.donorIds,
            taxUnitIds: unit.taxUnitIds,
            problem,
            sum: money(unit.sum),
            reported: unit.sum.gte(minSum),
          },
        ]
      : [];
  });

  return {
    year,
    minSum,
    maximumDeduction,
    totals: {
      all: money(all),
      reported: money(reportedSum),
      belowMinimum: money(belowSum),
      withoutTaxUnit: money(new Decimal(totals.withoutTaxUnit)),
      difference: money(difference),
    },
    counts: {
      donations: totals.donations,
      reportedUnits: reported.length,
      persons: reported.filter((unit) => checkNorwegianId(unit.ssn).kind === "person").length,
      organizations: reported.filter((unit) => checkNorwegianId(unit.ssn).kind === "organization")
        .length,
      belowMinimumUnits: below.length,
      aboveMaximum: reported.filter((unit) => unit.sum.gt(maximumDeduction)).length,
    },
    withoutTaxUnit: classifyDonorsWithoutTaxUnit(withoutTaxUnit, minSum, notices).map((donor) => ({
      donorId: donor.donorId,
      name: donor.name,
      donationsSum: donor.donationsSum,
      fundraiserSum: donor.fundraiserSum,
      donations: donor.donations,
      taxUnits: donor.taxUnits,
      exclusion: donor.exclusion,
      exclusionLabel: donor.exclusion ? noticeExclusionLabels[donor.exclusion] : null,
      status: donor.status,
      statusBy: donor.statusBy,
      statusAt: donor.statusAt,
    })),
    sentNoLongerWithout: notices.filter(
      (notice) => notice.status === "sent" && !stillWithout.has(notice.donorId),
    ).length,
    duplicates,
    invalidNumbers,
  };
}

export type TaxReportError = {
  kind: "csv" | "invalidNumber" | "giverportal" | "xsd";
  /** Without national IDs */
  message: string;
  donorIds?: number[];
};

export type TaxXmlReportResult =
  | {
      ok: true;
      xml: string;
      /** Units and amount (whole kroner per unit) in the file, and the part from EA Giverportal */
      units: number;
      sum: string;
      giverportalSum: string;
    }
  | { ok: false; errors: TaxReportError[] };

/**
 * Builds the XML for Skatteetaten from our tax units and EA Giverportal's CSV. Problems that would
 * make the report wrong (numbers Skatteetaten rejects, a CSV that doesn't match our data, schema
 * errors) are returned as errors instead of a file. Error messages contain no national IDs.
 */
export async function createXMLReportToTaxAuthorities(
  year: number,
  minSum: number,
  eanUnitsCsv: Buffer,
  contactInformation: ContactInformation,
  fetchXsd: () => Promise<string> = () =>
    fetch(SKATTEETATEN_XSD_URL).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }),
): Promise<TaxXmlReportResult> {
  let eanTaxUnits: EANTaxUnitsRow[];
  try {
    eanTaxUnits = parseEanTaxUnits(eanUnitsCsv);
  } catch (ex) {
    return {
      ok: false,
      errors: [{ kind: "csv", message: maskIdNumbers(`EA Giverportal CSV: ${ex.message}`) }],
    };
  }

  const units = new Map<string, GroupedTaxUnit & { giverportal: Decimal }>();
  for (const unit of groupTaxUnitsBySsn(await DAO.tax.getTaxXMLReportUnits(year))) {
    units.set(unit.ssn === "" ? `unit:${unit.taxUnitIds[0]}` : unit.ssn, {
      ...unit,
      giverportal: new Decimal(0),
    });
  }

  const errors: TaxReportError[] = [];
  for (const row of eanTaxUnits) {
    const ssn = row.ssn.replace(/\s/g, "");
    const label = `EA Giverportal row for “${row.name}”`;
    const problem = describeNorwegianIdProblem(ssn);
    if (problem) {
      errors.push({ kind: "invalidNumber", message: `${label}: ${problem}` });
      continue;
    }
    const existing = units.get(ssn);
    if (row.gieffektivt && !existing) {
      errors.push({
        kind: "giverportal",
        message: `${label} says the unit gave to Gi Effektivt, but no tax unit with that number has donations in ${year}`,
      });
      continue;
    }
    if (!row.gieffektivt && existing) {
      errors.push({
        kind: "giverportal",
        message: `${label} says the unit did not give to Gi Effektivt, but we have donations in ${year} for that number`,
        donorIds: existing.donorIds,
      });
      continue;
    }
    if (existing) {
      existing.sum = existing.sum.add(row.sum);
      existing.giverportal = existing.giverportal.add(row.sum);
    } else {
      units.set(ssn, {
        ssn,
        name: row.name,
        sum: new Decimal(row.sum),
        giverportal: new Decimal(row.sum),
        donorIds: [],
        taxUnitIds: [],
      });
    }
  }

  const reported = [...units.values()].filter((unit) => unit.sum.gte(minSum));
  for (const unit of reported) {
    if (unit.donorIds.length === 0) continue; // EA rows are checked above
    const problem = describeNorwegianIdProblem(unit.ssn);
    if (problem) {
      errors.push({
        kind: "invalidNumber",
        message: `Tax unit ${unit.taxUnitIds.join(", ")}: ${problem}`,
        donorIds: unit.donorIds,
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Whole kroner per unit, so sumBeloep is exactly the sum of the beloep lines
  const giftEntities = reported.map((unit) => ({
    identificationNumber: unit.ssn,
    amount: unit.sum.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    name: unit.name,
  }));
  const xml = writeXMLTaxReport(giftEntities, contactInformation, year);

  let xsd: string;
  try {
    xsd = await fetchXsd();
  } catch (ex) {
    return {
      ok: false,
      errors: [
        {
          kind: "xsd",
          message: `Could not fetch Skatteetaten's schema to check the file (${ex.message}). Try again later.`,
        },
      ],
    };
  }
  const validation = await validateXml(xml, xsd);
  if (!validation.valid) {
    return {
      ok: false,
      errors: validation.errors.map((message) => ({
        kind: "xsd" as const,
        message: `Skatteetaten's schema: ${maskIdNumbers(message)}`,
      })),
    };
  }

  return {
    ok: true,
    xml,
    units: giftEntities.length,
    sum: money(giftEntities.reduce((acc, entity) => acc.add(entity.amount), new Decimal(0))),
    giverportalSum: money(
      reported.reduce((acc, unit) => acc.add(unit.giverportal), new Decimal(0)),
    ),
  };
}

//endregion

/**
 * Minimal XML element tree. Serialized exactly like libxml2 (used by the
 * previous libxmljs implementation): two space indentation, text-only
 * elements on a single line and empty elements self-closed.
 */
class XmlElement {
  private readonly children: XmlElement[] = [];
  private readonly attributes: [string, string][] = [];

  constructor(
    private readonly name: string,
    private readonly text?: string,
  ) {}

  attr(attributes: Record<string, string>): XmlElement {
    this.attributes.push(...Object.entries(attributes));
    return this;
  }

  node(name: string, text?: string): XmlElement {
    const child = new XmlElement(name, text);
    this.children.push(child);
    return child;
  }

  serialize(indent = ""): string {
    const attrs = this.attributes.map(([k, v]) => ` ${k}="${escapeXmlAttribute(v)}"`).join("");
    if (this.children.length > 0) {
      const inner = this.children.map((c) => c.serialize(indent + "  ")).join("");
      return `${indent}<${this.name}${attrs}>\n${inner}${indent}</${this.name}>\n`;
    }
    if (this.text) {
      return `${indent}<${this.name}${attrs}>${escapeXmlText(this.text)}</${this.name}>\n`;
    }
    return `${indent}<${this.name}${attrs}/>\n`;
  }
}

const escapeXmlText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");

const escapeXmlAttribute = (value: string): string =>
  escapeXmlText(value).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");

type GiftEntity = { name: string; identificationNumber: string; amount: number };
type ContactInformation = { name: string; phoneNumber: string; email: string; smsNumber: string };
export const writeXMLTaxReport = (
  giftEntities: GiftEntity[],
  contactInformation: ContactInformation,
  year: number,
): string => {
  const root = new XmlElement("melding").attr({
    xmlns: "urn:ske:fastsetting:innsamling:gavefrivilligorganisasjon:v2",
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xsi:schemaLocation":
      "urn:ske:fastsetting:innsamling:gavefrivilligorganisasjon:v2 gavefrivilligorganisasjon_v2_0.xsd ",
  });

  const leveranse = root.node("leveranse");

  // Add oppgavegiver and other static elements
  const oppgavegiver = leveranse.node("oppgavegiver");
  oppgavegiver.node("organisasjonsnummer", "919809140");
  oppgavegiver.node("organisasjonsnavn", "Effektiv Altruisme Norge");
  const kontaktinformasjon = oppgavegiver.node("kontaktinformasjon");
  kontaktinformasjon.node("navn", contactInformation.name);
  kontaktinformasjon.node("telefonnummer", contactInformation.phoneNumber);
  kontaktinformasjon.node("varselEpostadresse", contactInformation.email);
  kontaktinformasjon.node("varselSmsMobilnummer", contactInformation.smsNumber);

  leveranse.node("inntektsaar", year.toString());
  leveranse.node("oppgavegiversLeveranseReferanse", "skatteraport" + +new Date());
  leveranse.node("leveransetype", "ordinaer");

  giftEntities.forEach((entity) => {
    // Skip entities with invalid SSN lengths
    if (entity.identificationNumber.length !== 11 && entity.identificationNumber.length !== 9) {
      console.warn(
        `Skipping entity ${entity.identificationNumber} because it has an invalid SSN length`,
      );
      return;
    }

    const oppgave = leveranse.node("oppgave");
    const oppgaveeier = oppgave.node("oppgaveeier");
    if (entity.identificationNumber.length === 11) {
      oppgaveeier.node("foedselsnummer", entity.identificationNumber);
    } else if (entity.identificationNumber.length === 9) {
      oppgaveeier.node("organisasjonsnummer", entity.identificationNumber);
    }
    if (entity.name && entity.name.length > 0) {
      oppgaveeier.node("navn", entity.name); // Replace with actual name
    } else {
      oppgaveeier.node("navn", "Ukjent navn");
    }
    oppgave.node("beloep", Math.round(entity.amount).toFixed(0));
  });

  const oppgaveoppsummering = leveranse.node("oppgaveoppsummering");
  oppgaveoppsummering.node("antallOppgaver", giftEntities.length.toString());
  oppgaveoppsummering.node(
    "sumBeloep",
    Math.round(giftEntities.reduce((acc, curr) => acc + curr.amount, 0)).toFixed(0),
  );

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + root.serialize();
};

/**
 * Validates an XML document against an XSD schema with libxml2 compiled to
 * WebAssembly (xmllint-wasm). xmllint runs on an isolated in-memory file
 * system without network access, so no external entities or schemas are loaded.
 */
export const validateXml = async (
  xml: string,
  xsdContent: string,
): Promise<{ valid: boolean; errors: string[] }> => {
  const result = await validateXML({
    xml: { fileName: "taxreport.xml", contents: xml },
    schema: { fileName: "gavefrivilligorganisasjon_v2_0.xsd", contents: xsdContent },
  });
  return {
    valid: result.valid,
    // Strip xmllint's prefix so messages read like the libxmljs validationErrors did
    errors: result.errors.map((e) => e.message.replace(/^Schemas validity error : /, "").trim()),
  };
};
