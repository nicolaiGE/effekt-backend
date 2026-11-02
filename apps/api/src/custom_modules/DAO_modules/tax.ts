import { OkPacket, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { TaxUnit } from "../../schemas/types";
import { DAO } from "../DAO";
import { getTaxUnitsWithDeductions } from "../taxdeductions";
import { Distributions, Tax_unit } from "@prisma/client";
import { RequestLocale } from "../../middleware/locale";

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

async function getDonorsEligableForDeductionInYear(
  year: number,
  minSum: number,
  excludedEmails: string[],
) {
  const [result] = await DAO.query<
    {
      donationsSum: number;
      email: string;
      full_name: string;
      unitCount: number;
    }[]
  >(
    `
    SELECT 
      SUM(sum_confirmed) as donationsSum,
      Donors.email,
      Donors.full_name,
      (SELECT COUNT(*) FROM Tax_unit WHERE Donor_ID = Donors.ID) as unitCount
    
  
    FROM Donations as D
      
    INNER JOIN Distributions as DI
      ON DI.KID = D.KID_fordeling
    INNER JOIN Donors
      ON Donors.ID = D.Donor_ID
      
    WHERE 
      DI.Tax_unit_ID IS NULL
      AND YEAR (D.timestamp_confirmed) = ?
      AND (Donors.trash = 0 OR Donors.trash IS NULL)
      AND (Donors.email NOT LIKE '%auksjon%')
      AND (Donors.email NOT LIKE '%gieffektivt.no')
      AND (Donors.email NOT LIKE '%gieffektiv.no')
      AND (Donors.email NOT IN (?))
      AND (SELECT COUNT(*) FROM Tax_unit WHERE Donor_ID = Donors.ID) = 0
      
    GROUP BY
      Donors.email,
      Donors.full_name
      
      HAVING SUM(sum_confirmed) >= ?
      
      ORDER BY SUM(sum_confirmed) DESC
  `,
    [year, excludedEmails, minSum],
  );

  return result;
}

async function getTaxXMLReportUnits(year: number) {
  const [result] = await DAO.query<
    {
      donationsSum: string;
      ssn: string;
      full_name: string;
      donorId: number;
    }[]
  >(
    `
    SELECT 
      SUM(sum_confirmed) as donationsSum,
      Tax_unit.ssn,
      Tax_unit.full_name,
      Tax_unit.Donor_ID as donorId

      FROM Donations as D

      INNER JOIN Distributions as DI
        ON DI.KID = D.KID_fordeling

      INNER JOIN Tax_unit
        ON Tax_unit.ID = DI.Tax_unit_ID

      WHERE 
        DI.Tax_unit_ID IS NOT NULL
        AND YEAR (D.timestamp_confirmed) = ?

      GROUP BY
        Tax_unit.ssn,
        Tax_unit.full_name,
        Tax_unit.Donor_ID
        
      ORDER BY SUM(sum_confirmed) DESC
  `,
    [year],
  );

  return result;
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
export const tax = {
  getById,
  getByDonorId,
  getByKID,
  getByDonorIdAndSsn,
  getActiveTaxUnitIdsByDonorId,
  getReportsWithUserOnProfilePage,
  getTaxXMLReportUnits,
  getDonorsEligableForDeductionInYear,
  addTaxUnit,
  updateTaxUnit,
  deleteById,
};
