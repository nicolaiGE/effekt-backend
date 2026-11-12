import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { DAO } from "../DAO";
import { dbClockColumn } from "../osloDays";

/**
 * Tax_unit_notices: the missing tax unit notice per donor and gift year. An admin can leave a
 * donor out of it ("excluded"), and a real sending records who got it ("sent"), so the notice can
 * go out in several rounds without anyone getting it twice. One row per donor and year; "sent"
 * wins over "excluded".
 */

export const taxUnitNoticeStatuses = ["excluded", "sent"] as const;
export type TaxUnitNoticeStatus = (typeof taxUnitNoticeStatuses)[number];

export type TaxUnitNoticeRow = {
  donorId: number;
  status: TaxUnitNoticeStatus;
  /** Admin (JWT email or sub) who left the donor out or sent it */
  updatedBy: string;
  updated: Date;
  /** Reminders sent after the notice, and the last one */
  reminders: number;
  lastReminded: Date | null;
  lastRemindedBy: string | null;
};

async function getForYear(year: number): Promise<TaxUnitNoticeRow[]> {
  const [rows] = await DAO.query<RowDataPacket[]>(
    `SELECT Donor_ID AS donorId, Status AS status, Updated_by AS updatedBy,
       ${dbClockColumn("Updated", "updated")}, Reminders AS reminders,
       ${dbClockColumn("Last_reminded", "lastReminded")}, Last_reminded_by AS lastRemindedBy
     FROM Tax_unit_notices
     WHERE Year = ?`,
    [year],
  );
  return rows.map((row) => ({
    donorId: Number(row.donorId),
    status: row.status as TaxUnitNoticeStatus,
    updatedBy: String(row.updatedBy),
    updated: row.updated,
    reminders: Number(row.reminders ?? 0),
    lastReminded: row.lastReminded ?? null,
    lastRemindedBy: row.lastRemindedBy ?? null,
  }));
}

/**
 * Leaves the donors out of the year's notice. Donors already left out or sent are left as they
 * are (INSERT IGNORE on Donor_ID + Year). Returns how many were changed.
 */
async function exclude(year: number, donorIds: number[], actor: string): Promise<number> {
  if (donorIds.length === 0) return 0;
  const [result] = await DAO.query<ResultSetHeader>(
    `INSERT IGNORE INTO Tax_unit_notices (Donor_ID, Year, Status, Updated_by) VALUES ?`,
    [donorIds.map((donorId) => [donorId, year, "excluded", actor])],
  );
  return result.affectedRows;
}

/** Puts donors left out by an admin back in the notice. Sent donors stay sent. */
async function include(year: number, donorIds: number[]): Promise<number> {
  if (donorIds.length === 0) return 0;
  const [result] = await DAO.query<ResultSetHeader>(
    `DELETE FROM Tax_unit_notices WHERE Year = ? AND Status = 'excluded' AND Donor_ID IN (?)`,
    [year, donorIds],
  );
  return result.affectedRows;
}

/** Records that the donors were sent the year's notice (also those left out before) */
async function markSent(year: number, donorIds: number[], actor: string): Promise<void> {
  if (donorIds.length === 0) return;
  await DAO.query(
    `INSERT INTO Tax_unit_notices (Donor_ID, Year, Status, Updated_by) VALUES ?
     ON DUPLICATE KEY UPDATE Status = 'sent', Updated_by = VALUES(Updated_by), Updated = NOW()`,
    [donorIds.map((donorId) => [donorId, year, "sent", actor])],
  );
}

/** Records a reminder to donors who were sent the year's notice */
async function markReminded(year: number, donorIds: number[], actor: string): Promise<void> {
  if (donorIds.length === 0) return;
  await DAO.query(
    `UPDATE Tax_unit_notices
     SET Reminders = Reminders + 1, Last_reminded = NOW(), Last_reminded_by = ?
     WHERE Year = ? AND Status = 'sent' AND Donor_ID IN (?)`,
    [actor, year, donorIds],
  );
}

export const taxunitnotices = { getForYear, exclude, include, markSent, markReminded };
