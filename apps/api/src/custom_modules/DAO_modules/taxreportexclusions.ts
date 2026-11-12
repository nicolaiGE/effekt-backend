import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { DAO } from "../DAO";
import { dbClockColumn } from "../osloDays";

/**
 * Tax_report_exclusions: tax units an admin has left out of the year's report to Skatteetaten,
 * with the reason (for example a number Altinn rejected for a donor we can't reach). A unit left
 * out takes every tax unit with the same number with it, as they are one unit in the report.
 */

export type TaxReportExclusionRow = {
  taxUnitId: number;
  reason: string;
  /** Admin (JWT email or sub) who left the unit out */
  createdBy: string;
  created: Date;
};

async function getForYear(year: number): Promise<TaxReportExclusionRow[]> {
  const [rows] = await DAO.query<RowDataPacket[]>(
    `SELECT Tax_unit_ID AS taxUnitId, Reason AS reason, Created_by AS createdBy,
       ${dbClockColumn("Created", "created")}
     FROM Tax_report_exclusions
     WHERE Year = ?`,
    [year],
  );
  return rows.map((row) => ({
    taxUnitId: Number(row.taxUnitId),
    reason: String(row.reason),
    createdBy: String(row.createdBy),
    created: row.created,
  }));
}

/** Leaves the tax unit out of the year's report; a unit already left out keeps its reason */
async function exclude(
  year: number,
  taxUnitId: number,
  reason: string,
  actor: string,
): Promise<boolean> {
  const [result] = await DAO.query<ResultSetHeader>(
    `INSERT IGNORE INTO Tax_report_exclusions (Tax_unit_ID, Year, Reason, Created_by)
     VALUES (?, ?, ?, ?)`,
    [taxUnitId, year, reason, actor],
  );
  return result.affectedRows > 0;
}

/** Puts the tax units back in the year's report */
async function include(year: number, taxUnitIds: number[]): Promise<number> {
  if (taxUnitIds.length === 0) return 0;
  const [result] = await DAO.query<ResultSetHeader>(
    `DELETE FROM Tax_report_exclusions WHERE Year = ? AND Tax_unit_ID IN (?)`,
    [year, taxUnitIds],
  );
  return result.affectedRows;
}

export const taxreportexclusions = { getForYear, exclude, include };
