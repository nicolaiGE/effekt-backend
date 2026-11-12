import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { DAO } from "../DAO";
import { dbClockColumn } from "../osloDays";

/**
 * Tax_reports: the XML files made for Skatteetaten, with their totals and which was sent; and
 * Tax_report_units: per tax unit of ours, the amount in the file. Tax units by ID, no numbers.
 */

export type TaxReportRow = {
  id: number;
  year: number;
  units: number;
  /** Decimal strings */
  sum: string;
  giverportalSum: string;
  leftOut: number;
  createdBy: string;
  created: Date;
  submitted: Date | null;
  submittedBy: string | null;
};

const columns = `ID AS id, Year AS year, Units AS units, Sum AS sum,
  Giverportal_sum AS giverportalSum, Left_out AS leftOut, Created_by AS createdBy,
  ${dbClockColumn("Created", "created")}, ${dbClockColumn("Submitted", "submitted")},
  Submitted_by AS submittedBy`;

const toRow = (row: RowDataPacket): TaxReportRow => ({
  id: Number(row.id),
  year: Number(row.year),
  units: Number(row.units),
  sum: String(row.sum),
  giverportalSum: String(row.giverportalSum),
  leftOut: Number(row.leftOut),
  createdBy: String(row.createdBy),
  created: row.created,
  submitted: row.submitted ?? null,
  submittedBy: row.submittedBy ?? null,
});

/** The year's files, newest first */
async function getForYear(year: number): Promise<TaxReportRow[]> {
  const [rows] = await DAO.query<RowDataPacket[]>(
    `SELECT ${columns} FROM Tax_reports WHERE Year = ? ORDER BY ID DESC`,
    [year],
  );
  return rows.map(toRow);
}

/** Every year with a file marked as sent, and when the last one was sent */
async function getSubmittedYears(): Promise<{ year: number; submitted: Date }[]> {
  const [rows] = await DAO.query<RowDataPacket[]>(
    `SELECT Year AS year, ${dbClockColumn("MAX(Submitted)", "submitted")}
     FROM Tax_reports WHERE Submitted IS NOT NULL GROUP BY Year ORDER BY Year`,
  );
  return rows.map((row) => ({ year: Number(row.year), submitted: row.submitted }));
}

/** Tax unit ID to amount in the file */
async function getUnitAmounts(reportId: number): Promise<Map<number, string>> {
  const [rows] = await DAO.query<RowDataPacket[]>(
    `SELECT Tax_unit_ID AS taxUnitId, Amount AS amount FROM Tax_report_units WHERE Tax_report_ID = ?`,
    [reportId],
  );
  return new Map(rows.map((row) => [Number(row.taxUnitId), String(row.amount)]));
}

/** Records a file made: its totals and the amount per tax unit of ours in it */
async function record(
  report: {
    year: number;
    units: number;
    sum: string;
    giverportalSum: string;
    leftOut: number;
    createdBy: string;
  },
  unitAmounts: { taxUnitId: number; amount: string }[],
): Promise<number> {
  const transaction = await DAO.startTransaction();
  try {
    const [result] = await transaction.query<ResultSetHeader>(
      `INSERT INTO Tax_reports (Year, Units, Sum, Giverportal_sum, Left_out, Created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        report.year,
        report.units,
        report.sum,
        report.giverportalSum,
        report.leftOut,
        report.createdBy,
      ],
    );
    if (unitAmounts.length > 0)
      await transaction.query(
        `INSERT INTO Tax_report_units (Tax_report_ID, Tax_unit_ID, Amount) VALUES ?`,
        [unitAmounts.map((unit) => [result.insertId, unit.taxUnitId, unit.amount])],
      );
    await DAO.commitTransaction(transaction);
    return result.insertId;
  } catch (ex) {
    await DAO.rollbackTransaction(transaction);
    throw ex;
  }
}

/** Marks the file as the one sent to Skatteetaten (again: the latest mark wins) */
async function markSubmitted(reportId: number, actor: string): Promise<boolean> {
  const [result] = await DAO.query<ResultSetHeader>(
    `UPDATE Tax_reports SET Submitted = NOW(), Submitted_by = ? WHERE ID = ?`,
    [actor, reportId],
  );
  return result.affectedRows > 0;
}

export const taxreports = { getForYear, getSubmittedYears, getUnitAmounts, record, markSubmitted };
