import { DAO } from "../DAO";
import paymentMethods from "../../enums/paymentMethods";

/** Milestone for the "through time" total, shown on the analysis overview */
const THROUGH_TIME_MILESTONE = 200_000_000;

export type AnalysisOverview = {
  thisYear: {
    year: number;
    sum: number;
  };
  throughTime: {
    /** Measured only. Pledges are never mixed into this number */
    measured: number;
    donations: number;
    from: string | null;
  };
  pledges: {
    open: number;
    count: number;
  };
  withPledges: {
    sum: number;
    milestone: number;
    remaining: number;
    passed: boolean;
  };
};

/**
 * Raw sums from the database, before they are combined into the overview.
 */
export type AnalysisOverviewTotals = {
  year: number;
  thisYearSum: number;
  throughTimeMeasured: number;
  throughTimeDonations: number;
  throughTimeFrom: Date | null;
  openPledgesSum: number;
  openPledgesCount: number;
};

/**
 * Combines the raw sums into the overview. Kept separate from the queries so the
 * rules can be tested without a database.
 */
export function buildOverview(
  totals: AnalysisOverviewTotals,
  milestone = THROUGH_TIME_MILESTONE,
): AnalysisOverview {
  const measured = Math.round(totals.throughTimeMeasured);
  const open = Math.round(totals.openPledgesSum);
  const withPledges = measured + open;

  return {
    thisYear: {
      year: totals.year,
      sum: Math.round(totals.thisYearSum),
    },
    throughTime: {
      measured,
      donations: totals.throughTimeDonations,
      from: totals.throughTimeFrom ? totals.throughTimeFrom.toISOString().slice(0, 10) : null,
    },
    pledges: {
      open,
      count: totals.openPledgesCount,
    },
    withPledges: {
      sum: withPledges,
      milestone,
      remaining: Math.max(milestone - withPledges, 0),
      passed: withPledges >= milestone,
    },
  };
}

/**
 * Sums for the analysis overview. Same definitions as the analysis pipeline
 * (Data-Analysis-1), so the numbers can be compared one to one:
 *
 * - This year: every confirmed donation this calendar year up to now, including
 *   support for our own operations and Influenced donations.
 * - Through time: what has gone on to the recipients since the start. The share of
 *   each donation that went to operations (organization "Drift") is held outside,
 *   as on the counter on the website. Influenced donations are included.
 * - Open pledges: decided but not received gifts, kept as a separate layer.
 */
async function getOverviewTotals(now: Date = new Date()): Promise<AnalysisOverviewTotals> {
  const year = now.getFullYear();

  const [[thisYear]] = await DAO.query<{ sum: string | null }[]>(
    `
    SELECT SUM(sum_confirmed) AS sum
    FROM Donations
    WHERE YEAR(timestamp_confirmed) = ? AND timestamp_confirmed <= ?
    `,
    // YEAR() on the stored value, as the pipeline does. A JS date for 1 January would be
    // sent as UTC and pull in the last hour of New Year's Eve.
    [year, now],
  );

  const [[throughTime]] = await DAO.query<
    { measured: string | null; donations: number; first: Date | null }[]
  >(
    `
    SELECT
      SUM(t.to_recipients) AS measured,
      COUNT(*) AS donations,
      MIN(t.timestamp_confirmed) AS first
    FROM (
      SELECT
        d.timestamp_confirmed,
        d.sum_confirmed * (1 - COALESCE(operations.share, 0)) AS to_recipients
      FROM Donations d
      LEFT JOIN (
        SELECT dca.Distribution_KID AS KID,
          SUM(dca.Percentage_share / 100 * dcao.Percentage_share / 100) AS share
        FROM Distribution_cause_areas dca
        JOIN Distribution_cause_area_organizations dcao
          ON dcao.Distribution_cause_area_ID = dca.ID
        JOIN Organizations o ON o.ID = dcao.Organization_ID
        WHERE o.abbriv = 'Drift' AND dcao.Percentage_share > 0
        GROUP BY dca.Distribution_KID
      ) operations ON operations.KID = d.KID_fordeling
      WHERE d.timestamp_confirmed IS NOT NULL
    ) t
    WHERE t.to_recipients > 0
    `,
  );

  const [[pledges]] = await DAO.query<{ sum: string | null; count: number }[]>(
    `
    SELECT SUM(Sum) AS sum, COUNT(*) AS count
    FROM Pledges
    WHERE Received_date IS NULL
    `,
  );

  return {
    year,
    thisYearSum: parseFloat(thisYear.sum ?? "0"),
    throughTimeMeasured: parseFloat(throughTime.measured ?? "0"),
    throughTimeDonations: Number(throughTime.donations),
    throughTimeFrom: throughTime.first ? new Date(throughTime.first) : null,
    openPledgesSum: parseFloat(pledges.sum ?? "0"),
    openPledgesCount: Number(pledges.count),
  };
}

/** How many days of agreement donations the ticker's estimated flow averages over */
export const AGREEMENT_FLOW_DAYS = 90;

/**
 * The fixed agreements' flow, for the ticker's estimate: what AvtaleGiro and Vipps agreements
 * passed on to the recipients over the last AGREEMENT_FLOW_DAYS days (the Drift share held
 * outside, as in the through-time total), and the newest agreement donation's time. Money that
 * came in after that time is in the agreements' accounts but not registered yet.
 */
async function getAgreementFlow(
  now: Date = new Date(),
): Promise<{ sum: number; latest: Date | null }> {
  const [[row]] = await DAO.query<{ sum: string | null; latest: Date | null }[]>(
    `
    SELECT
      SUM(d.sum_confirmed * (1 - COALESCE(operations.share, 0))) AS sum,
      MAX(d.timestamp_confirmed) AS latest
    FROM Donations d
    LEFT JOIN (
      SELECT dca.Distribution_KID AS KID,
        SUM(dca.Percentage_share / 100 * dcao.Percentage_share / 100) AS share
      FROM Distribution_cause_areas dca
      JOIN Distribution_cause_area_organizations dcao
        ON dcao.Distribution_cause_area_ID = dca.ID
      JOIN Organizations o ON o.ID = dcao.Organization_ID
      WHERE o.abbriv = 'Drift' AND dcao.Percentage_share > 0
      GROUP BY dca.Distribution_KID
    ) operations ON operations.KID = d.KID_fordeling
    WHERE d.Payment_ID IN (?, ?)
      AND d.timestamp_confirmed > DATE_SUB(?, INTERVAL ? DAY)
      AND d.timestamp_confirmed <= ?
    `,
    [paymentMethods.avtalegiro, paymentMethods.vipps_recurring, now, AGREEMENT_FLOW_DAYS, now],
  );
  return {
    sum: parseFloat(row.sum ?? "0"),
    latest: row.latest ? new Date(row.latest) : null,
  };
}

/** A single gift of this much or more counts as a large gift, as in the analysis pipeline */
export const LARGE_GIFT = 100_000;

/**
 * The fundraising goals per year, split like the analysis pipeline's goals (MAAL_SATT in
 * Data-Analysis-1's definisjoner.py): gifts under LARGE_GIFT and gifts of LARGE_GIFT or more.
 * 2026 and 2029 are decided; 2027 and 2028 are the straight line between them, as the pipeline
 * draws them. Kept here until the goals get a place in the admin.
 */
export const YEAR_GOALS: Record<number, { small: number; large: number }> = {
  2026: { small: 28_000_000, large: 50_000_000 },
  2027: { small: 52_000_000, large: 116_700_000 },
  2028: { small: 76_000_000, large: 183_300_000 },
  2029: { small: 100_000_000, large: 250_000_000 },
};

/**
 * This calendar year's money to the recipients, split by the size of each gift: under
 * LARGE_GIFT and LARGE_GIFT or more. The split goes by the single gift, not by what the donor
 * gives through the year, and the Drift share is held outside, as in the analysis pipeline's
 * "Innsamlet i gaver under / på 100 000". Influenced donations are included. The year is taken
 * from the stored value, as in getOverviewTotals.
 */
async function getYearBySize(
  now: Date = new Date(),
): Promise<{ year: number; small: number; large: number }> {
  const year = now.getFullYear();
  const [[row]] = await DAO.query<{ small: string | null; large: string | null }[]>(
    `
    SELECT
      SUM(CASE WHEN d.sum_confirmed < ? THEN to_recipients END) AS small,
      SUM(CASE WHEN d.sum_confirmed >= ? THEN to_recipients END) AS large
    FROM (
      SELECT d.sum_confirmed, d.sum_confirmed * (1 - COALESCE(operations.share, 0)) AS to_recipients
      FROM Donations d
      LEFT JOIN (
        SELECT dca.Distribution_KID AS KID,
          SUM(dca.Percentage_share / 100 * dcao.Percentage_share / 100) AS share
        FROM Distribution_cause_areas dca
        JOIN Distribution_cause_area_organizations dcao
          ON dcao.Distribution_cause_area_ID = dca.ID
        JOIN Organizations o ON o.ID = dcao.Organization_ID
        WHERE o.abbriv = 'Drift' AND dcao.Percentage_share > 0
        GROUP BY dca.Distribution_KID
      ) operations ON operations.KID = d.KID_fordeling
      WHERE YEAR(d.timestamp_confirmed) = ? AND d.timestamp_confirmed <= ?
    ) d
    `,
    [LARGE_GIFT, LARGE_GIFT, year, now],
  );
  return {
    year,
    small: parseFloat(row.small ?? "0"),
    large: parseFloat(row.large ?? "0"),
  };
}

export const analysis = {
  getOverviewTotals,
  getAgreementFlow,
  getYearBySize,
};
