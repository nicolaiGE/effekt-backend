import { OkPacket, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { TaxUnit } from "../../schemas/types";
import { DAO } from "../DAO";
import { getTaxUnitsWithDeductions } from "../taxdeductions";
import { Distributions, Tax_unit } from "@prisma/client";
import { RequestLocale } from "../../middleware/locale";
import { type InstantRange, instantRangeClauses, osloYearRange, sqlInstant } from "../osloDays";

//region Get
/**
 * Gets a tax unit by id
 * @param {number} id The id of the tax unit
 * @returns {TaxUnit | null} A tax unit if found
 */
async function getById(id: number): Promise<TaxUnit | null> {
  const [result] = await DAO.execute<RowDataPacket[]>(`SELECT * FROM Tax_unit where ID = ?`, [id]);

  if (result.length > 0)
    return {
      id: result[0].ID,
      donorId: result[0].Donor_ID,
      name: result[0].full_name,
      ssn: result[0].ssn,
      archived: result[0].archived,
    };
  else return null;
}

/**
 * Gets all tax units associated with donor
 * @param {number} donorId The if of the donor
 * @returns {TaxUnit | null} A tax unit if found
 */
async function getByDonorId(donorId: number, locale: RequestLocale): Promise<Array<TaxUnit>> {
  const [taxUnits] = await DAO.query<Tax_unit[]>(
    `SELECT *          
          FROM Tax_unit as T
        
          WHERE T.Donor_ID = ?`,
    [donorId],
  );

  const eligbleCauseAreasByLocale = {
    [RequestLocale.NO]: [1],
    [RequestLocale.SV]: [1],
  };

  // Get all donations for the donor with attached tax unit id
  const [donations] = await DAO.query<{ year: number; sum: string; taxUnitId: number }[]>(
    `SELECT 
      YEAR(Donations.timestamp_confirmed) as year,
      ROUND(COALESCE((SELECT SUM(DA.Percentage_share) as prct FROM Distribution_cause_areas as DA WHERE Distribution_KID = Donations.KID_fordeling AND Cause_area_ID IN (?)),0)/100 * Donations.sum_confirmed) as sum,
      Tax_unit.ID as taxUnitId
        
        FROM Donations
        INNER JOIN Distributions ON Distributions.KID = Donations.KID_fordeling
        INNER JOIN Tax_unit ON Tax_unit.ID = Distributions.Tax_unit_ID
        WHERE Tax_unit.Donor_ID = ?`,
    [eligbleCauseAreasByLocale[locale], donorId],
  );

  const calculatedUnits = getTaxUnitsWithDeductions({
    taxUnits,
    donations: donations.map((d) => ({ ...d, sum: parseFloat(d.sum) })),
    locale,
  });

  return calculatedUnits;
}

/**
 * Gets active tax unit IDs by donor ID
 * @param {number} donorId The if of the donor
 * @returns {{id: number}[]} A tax unit if found
 */
async function getActiveTaxUnitIdsByDonorId(donorId: number): Promise<{ id: number }[]> {
  const [result] = await DAO.execute<{ id: number }[]>(
    `SELECT ID as id FROM Tax_unit WHERE Donor_ID = ? AND archived IS NULL`,
    [donorId],
  );

  return result;
}

/**
 * Gets a tax unit KID
 * @param {number} id The id of the tax unit
 * @returns {TaxUnit | null} A tax unit if found
 */
async function getByKID(KID: string, locale: RequestLocale): Promise<TaxUnit | null> {
  const [idResult] = await DAO.query<Pick<Distributions, "Tax_unit_ID">[]>(
    `SELECT Tax_unit_ID FROM Distributions WHERE KID = ?;`,
    [KID],
  );

  // The KID might not exist, or the KID might not be associated with a tax unit
  if (idResult.length === 0 || !idResult[0].Tax_unit_ID) return null;

  const [taxUnits] = await DAO.query<Tax_unit[]>(`SELECT * FROM Tax_unit where ID = ?`, [
    idResult[0].Tax_unit_ID,
  ]);

  if (taxUnits.length === 0) return null;
  if (taxUnits.length > 1) throw new Error("Multiple tax units with same ID");

  const donor = await DAO.donors.getByKID(KID);

  if (!donor) return null;

  // Get all donations for the donor with attached tax unit id
  const [donations] = await DAO.query<{ year: number; sum: string; taxUnitId: number }[]>(
    `SELECT YEAR(Donations.timestamp_confirmed) as year, Donations.sum_confirmed as sum, Tax_unit.ID as taxUnitId
      FROM Donations
      INNER JOIN Distributions ON Distributions.KID = Donations.KID_fordeling
      INNER JOIN Tax_unit ON Tax_unit.ID = Distributions.Tax_unit_ID
      WHERE Tax_unit.Donor_ID = ?`,
    [donor.id],
  );

  const calculatedUnits = getTaxUnitsWithDeductions({
    taxUnits,
    donations: donations.map((d) => ({ ...d, sum: parseFloat(d.sum) })),
    locale,
  });

  return calculatedUnits[0];
}

/**
 * Gets a tax unit by donor id and ssn
 * @param {number} donorId The id of a donor
 * @param {string} ssn A social security number
 * @returns {TaxUnit | null} A tax unit if found
 */
async function getByDonorIdAndSsn(donorId: number, ssn: string): Promise<TaxUnit | null> {
  const [result] = await DAO.execute<RowDataPacket[]>(
    `SELECT * FROM Tax_unit where Donor_ID = ? AND ssn = ?`,
    [donorId, ssn],
  );

  if (result.length > 0) {
    const mapped: TaxUnit = {
      id: result[0].ID as number,
      donorId: result[0].Donor_ID as number,
      name: result[0].full_name as string,
      ssn: result[0].ssn as string,
      archived: result[0].archived as string,
    };
    return mapped;
  } else return null;
}

export type EmailTaxUnitReport = {
  email: string;
  name: string;
  units: [{ name: string; sum: number }];
};
async function getReportsWithUserOnProfilePage(): Promise<EmailTaxUnitReport[]> {
  const [result] = await DAO.execute<RowDataPacket[]>(`
    SELECT TaxUnitName, \`SUM(sum_confirmed)\` as DonationsSum, DonorUserEmail, DonorUserName FROM v_Tax_deductions
  `);

  const mapped: EmailTaxUnitReport[] = [];
  for (const row of result) {
    const existing = mapped.find((m) => m.email === row.DonorUserEmail);

    if (existing) {
      existing.units.push({ name: row.TaxUnitName, sum: row.DonationsSum });
    } else {
      mapped.push({
        email: row.DonorUserEmail,
        name: row.DonorUserName,
        units: [{ name: row.TaxUnitName, sum: Math.round(row.DonationsSum) }],
      });
    }
  }

  return mapped;
}

/** The last gift year reported with UTC years (`YEAR(timestamp_confirmed)`), before Oslo time */
export const LAST_UTC_TAX_YEAR = 2025;

/**
 * The donations that belong to a gift year in the report to Skatteetaten. Years up to
 * LAST_UTC_TAX_YEAR were reported with UTC years, and those reports are filed: they keep UTC years,
 * so they come out as filed. The year after starts where the last UTC year ended (1 January 00:00
 * UTC), so gifts in the first hour of the year in Oslo, already reported for the year before, are
 * not reported again. From then on the years follow Oslo time.
 */
export function taxYearRange(year: number): Required<InstantRange> {
  const utcYearStart = (y: number) => new Date(Date.UTC(y, 0, 1));
  if (year <= LAST_UTC_TAX_YEAR)
    return { from: utcYearStart(year), before: utcYearStart(year + 1) };
  const oslo = osloYearRange(year);
  return year === LAST_UTC_TAX_YEAR + 1 ? { from: utcYearStart(year), before: oslo.before } : oslo;
}

/** Donations.timestamp_confirmed within the gift year (taxYearRange), as SQL clauses */
const confirmedInTaxYear = (year: number) =>
  instantRangeClauses("D.timestamp_confirmed", taxYearRange(year)).join(" AND ");

export type TaxUnitYearSum = {
  taxUnitId: number;
  donorId: number;
  ssn: string | null;
  name: string;
  /** Decimal string, e.g. "1234.50" */
  donationsSum: string;
};

/**
 * Donations confirmed in the gift year (taxYearRange) summed per tax unit. One row per tax unit: several
 * units can share a national ID (one person registered on several donors), so callers group them
 * by number (groupTaxUnitsBySsn) before reporting.
 */
async function getTaxXMLReportUnits(year: number): Promise<TaxUnitYearSum[]> {
  const [result] = await DAO.query<(TaxUnitYearSum & RowDataPacket)[]>(
    `
    SELECT 
      Tax_unit.ID as taxUnitId,
      Tax_unit.Donor_ID as donorId,
      Tax_unit.ssn,
      Tax_unit.full_name as name,
      SUM(D.sum_confirmed) as donationsSum

      FROM Donations as D

      INNER JOIN Distributions as DI
        ON DI.KID = D.KID_fordeling

      INNER JOIN Tax_unit
        ON Tax_unit.ID = DI.Tax_unit_ID

      WHERE ${confirmedInTaxYear(year)}

      GROUP BY Tax_unit.ID
        
      ORDER BY SUM(D.sum_confirmed) DESC
  `,
  );

  return result.map((row) => ({
    taxUnitId: row.taxUnitId,
    donorId: row.donorId,
    ssn: row.ssn,
    name: row.name,
    donationsSum: String(row.donationsSum),
  }));
}

/**
 * All donations confirmed in the gift year (taxYearRange), and the part on distributions without a tax
 * unit. The rest is exactly what getTaxXMLReportUnits sums, so the two can be checked against
 * each other.
 */
async function getDonationTotalsInYear(
  year: number,
): Promise<{ total: string; withoutTaxUnit: string; donations: number }> {
  const [[row]] = await DAO.query<RowDataPacket[]>(
    `
    SELECT
      COALESCE(SUM(D.sum_confirmed), 0) as total,
      COALESCE(SUM(CASE WHEN TU.ID IS NULL THEN D.sum_confirmed ELSE 0 END), 0) as withoutTaxUnit,
      COUNT(*) as donations

      FROM Donations as D

      LEFT JOIN Distributions as DI
        ON DI.KID = D.KID_fordeling

      LEFT JOIN Tax_unit as TU
        ON TU.ID = DI.Tax_unit_ID

      WHERE ${confirmedInTaxYear(year)}
  `,
  );
  return {
    total: String(row.total),
    withoutTaxUnit: String(row.withoutTaxUnit),
    donations: Number(row.donations),
  };
}

export type DonorWithoutTaxUnitRow = {
  donorId: number;
  email: string | null;
  name: string | null;
  trashed: boolean;
  /** Decimal string: the donor's donations in the year on distributions without a tax unit */
  donationsSum: string;
  /** Decimal string: the part given through fundraisers (innsamlingsaksjoner) */
  fundraiserSum: string;
  donations: number;
  /** Tax units the donor has registered (on other distributions, or added since) */
  taxUnits: number;
};

/**
 * Donors whose donations without a tax unit in the gift year (taxYearRange) add up to at least minSum.
 * Who of them gets the missing tax unit notice is decided by classifyDonorsWithoutTaxUnit.
 */
async function getDonorsWithoutTaxUnitInYear(
  year: number,
  minSum: number,
): Promise<DonorWithoutTaxUnitRow[]> {
  const [result] = await DAO.query<RowDataPacket[]>(
    `
    SELECT
      D.Donor_ID as donorId,
      ANY_VALUE(Donors.email) as email,
      ANY_VALUE(Donors.full_name) as name,
      ANY_VALUE(Donors.trash) as trash,
      SUM(D.sum_confirmed) as donationsSum,
      SUM(CASE WHEN DI.Fundraiser_transaction_ID IS NOT NULL THEN D.sum_confirmed ELSE 0 END)
        as fundraiserSum,
      COUNT(*) as donations,
      (SELECT COUNT(*) FROM Tax_unit WHERE Tax_unit.Donor_ID = D.Donor_ID) as taxUnits

      FROM Donations as D

      INNER JOIN Donors
        ON Donors.ID = D.Donor_ID

      LEFT JOIN Distributions as DI
        ON DI.KID = D.KID_fordeling

      LEFT JOIN Tax_unit as TU
        ON TU.ID = DI.Tax_unit_ID

      WHERE TU.ID IS NULL
        AND ${confirmedInTaxYear(year)}

      GROUP BY D.Donor_ID

      HAVING SUM(D.sum_confirmed) >= ?

      ORDER BY SUM(D.sum_confirmed) DESC
  `,
    [minSum],
  );
  return result.map((row) => ({
    donorId: row.donorId,
    email: row.email ?? null,
    name: row.name ?? null,
    trashed: Number(row.trash) === 1,
    donationsSum: String(row.donationsSum),
    fundraiserSum: String(row.fundraiserSum),
    donations: Number(row.donations),
    taxUnits: Number(row.taxUnits),
  }));
}
//endregion

//region Modify
/**
 * Adds a new tax unit for a donor
 * @param {number} donorId The id of the donor the tax unit is associated with
 * @param {String | null} ssn The social security number for the tax unit. Could be a personal number or an organization number.
 * @param {String} name The name of the tax unit. Could for example be Ola Normann, or Norske Bedrift AS
 * @returns {Number} The ID of the created tax unit
 */
async function addTaxUnit(donorId: number, ssn: string | null, name: string): Promise<number> {
  const [result] = await DAO.execute<ResultSetHeader | OkPacket>(
    `INSERT INTO Tax_unit SET Donor_ID = ?, ssn = ?, full_name = ?`,
    [donorId, ssn, name],
  );

  return result.insertId;
}

/**
 *  Updates a tax unit
 * @param {number} id The id of the tax unit
 * @param {TaxUnit} taxUnit The new tax unit
 * @returns {number} The number of rows affected
 */
async function updateTaxUnit(id: number, taxUnit: TaxUnit): Promise<number> {
  const [result] = await DAO.execute<ResultSetHeader | OkPacket>(
    `UPDATE Tax_unit SET full_name = ?, ssn = ? WHERE ID = ?`,
    [taxUnit.name, taxUnit.ssn, id],
  );

  return result.affectedRows;
}

/**
 * Deletes a tax unit with an optional tax unit id to transfer donations in the current year to
 * @param {number} id The id of the tax unit
 * @param {number} donorId The id of the donor
 * @param {number?} transferId The id of the tax unit to transfer donations to
 * @returns {number} The number of rows affected
 */
async function deleteById(_id: number, _donorId: number, _transferId?: number): Promise<number> {
  // Not implemented: the old implementation queried Combining_table, which was dropped in
  // 20230731130928_multiple_cause_areas.
  throw new Error("Not implemented");
}

//endregion
export type DonorForComparison = {
  id: number;
  name: string | null;
  email: string;
  registered: Date;
  trashed: boolean;
  donations: number;
  /** Decimal string: all the donor's confirmed donations */
  donationsSum: string;
  lastDonation: Date | null;
  /** KIDs (distributions) */
  kids: number;
  /** AvtaleGiro and Vipps agreements, and how many of them are active */
  agreements: number;
  activeAgreements: number;
  taxUnits: { id: number; name: string; ssn: string | null; archived: boolean }[];
};

/**
 * What an admin needs to judge whether donors are one person, and what a merge would move:
 * contact details, donations, KIDs, agreements and tax units per donor
 */
async function getDonorsForComparison(donorIds: number[]): Promise<DonorForComparison[]> {
  if (donorIds.length === 0) return [];
  const [donors] = await DAO.query<RowDataPacket[]>(
    `
    SELECT
      D.ID as id,
      D.full_name as name,
      D.email,
      D.date_registered as registered,
      D.trash,
      (SELECT COUNT(*) FROM Donations WHERE Donations.Donor_ID = D.ID) as donations,
      (SELECT COALESCE(SUM(sum_confirmed), 0) FROM Donations WHERE Donations.Donor_ID = D.ID)
        as donationsSum,
      (SELECT MAX(timestamp_confirmed) FROM Donations WHERE Donations.Donor_ID = D.ID)
        as lastDonation,
      (SELECT COUNT(*) FROM Distributions WHERE Distributions.Donor_ID = D.ID) as kids,
      (SELECT COUNT(*) FROM Avtalegiro_agreements AS AG
        INNER JOIN Distributions AS DI ON DI.KID = AG.KID
        WHERE DI.Donor_ID = D.ID) as avtalegiro,
      (SELECT COUNT(*) FROM Avtalegiro_agreements AS AG
        INNER JOIN Distributions AS DI ON DI.KID = AG.KID
        WHERE DI.Donor_ID = D.ID AND AG.active = 1 AND AG.cancelled IS NULL) as avtalegiroActive,
      (SELECT COUNT(*) FROM Vipps_agreements AS VA WHERE VA.donorID = D.ID) as vipps,
      (SELECT COUNT(*) FROM Vipps_agreements AS VA
        WHERE VA.donorID = D.ID AND UPPER(VA.status) = 'ACTIVE') as vippsActive

      FROM Donors as D
      WHERE D.ID IN (?)
    `,
    [donorIds],
  );
  const [units] = await DAO.query<RowDataPacket[]>(
    `SELECT ID as id, Donor_ID as donorId, full_name as name, ssn, archived
     FROM Tax_unit WHERE Donor_ID IN (?) ORDER BY ID`,
    [donorIds],
  );
  return donorIds.flatMap((donorId) => {
    const row = donors.find((donor) => Number(donor.id) === donorId);
    if (!row) return [];
    return [
      {
        id: donorId,
        name: row.name ?? null,
        email: String(row.email),
        registered: row.registered,
        trashed: Boolean(row.trash),
        donations: Number(row.donations),
        donationsSum: String(row.donationsSum),
        lastDonation: row.lastDonation ?? null,
        kids: Number(row.kids),
        agreements: Number(row.avtalegiro) + Number(row.vipps),
        activeAgreements: Number(row.avtalegiroActive) + Number(row.vippsActive),
        taxUnits: units
          .filter((unit) => Number(unit.donorId) === donorId)
          .map((unit) => ({
            id: Number(unit.id),
            name: String(unit.name ?? ""),
            ssn: unit.ssn ?? null,
            archived: unit.archived !== null && unit.archived !== undefined,
          })),
      },
    ];
  });
}

export type UnconnectedGiftsRow = {
  donorId: number;
  name: string | null;
  email: string | null;
  /** Decimal string: the donor's gifts in the year on their own KIDs without a tax unit */
  donationsSum: string;
  donations: number;
  kids: number;
  /** The donor's active tax units, to connect the gifts to */
  taxUnits: { id: number; name: string; ssn: string | null }[];
};

/**
 * Donors with an active tax unit whose gifts in the gift year (taxYearRange) are on their own
 * KIDs without one, any sum. Those gifts are not reported, though the donor has registered for
 * the deduction. The anonymous donor is left out.
 */
async function getUnconnectedGiftsInYear(year: number): Promise<UnconnectedGiftsRow[]> {
  const [rows] = await DAO.query<RowDataPacket[]>(
    `
    SELECT
      D.Donor_ID as donorId,
      ANY_VALUE(Donors.full_name) as name,
      ANY_VALUE(Donors.email) as email,
      SUM(D.sum_confirmed) as donationsSum,
      COUNT(*) as donations,
      COUNT(DISTINCT D.KID_fordeling) as kids

      FROM Donations as D

      INNER JOIN Donors
        ON Donors.ID = D.Donor_ID

      INNER JOIN Distributions as DI
        ON DI.KID = D.KID_fordeling AND DI.Donor_ID = D.Donor_ID

      LEFT JOIN Tax_unit as TU
        ON TU.ID = DI.Tax_unit_ID

      WHERE ${confirmedInTaxYear(year)}
        AND TU.ID IS NULL
        AND D.Donor_ID <> 1464 -- ANONYMOUS_DONOR_ID
        AND EXISTS (
          SELECT 1 FROM Tax_unit WHERE Tax_unit.Donor_ID = D.Donor_ID AND Tax_unit.archived IS NULL
        )

      GROUP BY D.Donor_ID

      ORDER BY SUM(D.sum_confirmed) DESC
  `,
  );
  if (rows.length === 0) return [];
  const [units] = await DAO.query<RowDataPacket[]>(
    `SELECT ID as id, Donor_ID as donorId, full_name as name, ssn
     FROM Tax_unit WHERE archived IS NULL AND Donor_ID IN (?) ORDER BY ID`,
    [rows.map((row) => row.donorId)],
  );
  return rows.map((row) => ({
    donorId: Number(row.donorId),
    name: row.name ?? null,
    email: row.email ?? null,
    donationsSum: String(row.donationsSum),
    donations: Number(row.donations),
    kids: Number(row.kids),
    taxUnits: units
      .filter((unit) => Number(unit.donorId) === Number(row.donorId))
      .map((unit) => ({
        id: Number(unit.id),
        name: String(unit.name ?? ""),
        ssn: unit.ssn ?? null,
      })),
  }));
}

/**
 * The donor's own KIDs without a tax unit that have gifts in the gift year, and whether each also
 * has gifts from before the year (already reported, or left out, for an earlier year)
 */
async function getKIDsWithoutTaxUnitInYear(
  donorId: number,
  year: number,
): Promise<{ kid: string; fundraiser: boolean; hasEarlier: boolean }[]> {
  const from = taxYearRange(year).from;
  const [rows] = await DAO.query<RowDataPacket[]>(
    `
    SELECT
      DI.KID as kid,
      DI.Fundraiser_transaction_ID as fundraiserTransactionId,
      EXISTS (
        SELECT 1 FROM Donations AS E
        WHERE E.KID_fordeling = DI.KID AND E.timestamp_confirmed < ${sqlInstant(from)}
      ) as hasEarlier

      FROM Distributions as DI

      LEFT JOIN Tax_unit as TU
        ON TU.ID = DI.Tax_unit_ID

      WHERE DI.Donor_ID = ?
        AND TU.ID IS NULL
        AND EXISTS (
          SELECT 1 FROM Donations AS D
          WHERE D.KID_fordeling = DI.KID AND D.Donor_ID = DI.Donor_ID AND ${confirmedInTaxYear(year)}
        )
  `,
    [donorId],
  );
  return rows.map((row) => ({
    kid: String(row.kid),
    fundraiser: row.fundraiserTransactionId !== null && row.fundraiserTransactionId !== undefined,
    hasEarlier: Boolean(Number(row.hasEarlier)),
  }));
}

/** Moves the KID's donations confirmed before the instant to another KID */
async function moveDonationsBefore(kid: string, newKid: string, before: Date): Promise<number> {
  const [result] = await DAO.query<ResultSetHeader>(
    `UPDATE Donations SET KID_fordeling = ?
     WHERE KID_fordeling = ? AND timestamp_confirmed < ${sqlInstant(before)}`,
    [newKid, kid],
  );
  return result.affectedRows;
}

export const tax = {
  getById,
  getByDonorId,
  getByKID,
  getByDonorIdAndSsn,
  getActiveTaxUnitIdsByDonorId,
  getReportsWithUserOnProfilePage,
  getTaxXMLReportUnits,
  getDonationTotalsInYear,
  getDonorsWithoutTaxUnitInYear,
  getDonorsForComparison,
  getUnconnectedGiftsInYear,
  getKIDsWithoutTaxUnitInYear,
  moveDonationsBefore,
  addTaxUnit,
  updateTaxUnit,
  deleteById,
};
