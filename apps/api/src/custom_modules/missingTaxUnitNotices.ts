import { DAO } from "./DAO";
import { Decimal } from "decimal.js";
import type { DonorWithoutTaxUnitRow } from "./DAO_modules/tax";
import type { TaxUnitNoticeRow } from "./DAO_modules/taxunitnotices";
import * as mail from "./mail";
import type { EligibleDonor } from "./mail";
import {
  type MissingTaxUnitNoticeOptions,
  type NoticeRound,
  noticeOptionsProblem,
} from "./missingTaxUnitNoticeOptions";

export { type MissingTaxUnitNoticeOptions, type NoticeRound, noticeOptionsProblem };

/** The shared donor for gifts without contact details (see also vipps.ts and amf.ts) */
export const ANONYMOUS_DONOR_ID = 1464;

/** Why a donor without tax unit does not get the missing tax unit notice */
export type NoticeExclusion =
  | "trashed"
  | "anonymous"
  | "noEmail"
  | "internalEmail"
  | "hasTaxUnit"
  /** Moved to "Left out" by an admin (Tax_unit_notices) */
  | "leftOut";

export const noticeExclusionLabels: Record<NoticeExclusion, string> = {
  trashed: "Deleted donor",
  anonymous: "Anonymous donor",
  noEmail: "No email address",
  internalEmail: "Internal or placeholder address",
  hasTaxUnit: "Has a tax unit, check the KIDs",
  leftOut: "Left out by hand",
};

/** Where a donor without tax unit stands: gets the next notice, is left out, or has had it */
export type NoticeStatus = "notice" | "excluded" | "sent";

export type ClassifiedDonor = DonorWithoutTaxUnitRow & {
  /** Without fundraiser gifts: what a new tax unit would cover, decimal string */
  noticeSum: string;
  /** Null when the donor gets the notice (or has had it) */
  exclusion: NoticeExclusion | null;
  /**
   * What the rules say now, even for a donor who has had the notice (deleted since, email gone,
   * a tax unit added): a reminder skips them. Never "leftOut".
   */
  ruleExclusion: NoticeExclusion | null;
  status: NoticeStatus;
  /** When the donor was sent the notice or left out by hand, and by whom */
  statusBy: string | null;
  statusAt: Date | null;
  /** Reminders after the notice, and when the last one went */
  reminders: number;
  lastReminded: Date | null;
};

/** Placeholder addresses for donors without email, our own addresses and auction buyers */
const isInternalEmail = (email: string) => {
  const lower = email.toLowerCase();
  return (
    lower.endsWith("gieffektivt.no") || lower.endsWith("gieffektiv.no") || lower.includes("auksjon")
  );
};

/**
 * Decides who of the donors without tax unit gets the notice. The list in the admin panel and the
 * sending use this, so they always agree. Fundraiser gifts count towards minSum like any other:
 * a tax unit the donor registers is put on all their distributions, fundraiser ones included
 * (connectFirstTaxUnit), and connectDonationsForFirstTaxUnit never moves fundraiser donations off
 * them, so last year's fundraiser gifts are reported once the donor has registered.
 */
export function classifyDonorsWithoutTaxUnit(
  rows: DonorWithoutTaxUnitRow[],
  minSum: number,
  /** The year's Tax_unit_notices: donors sent the notice, and donors left out by an admin */
  notices: TaxUnitNoticeRow[] = [],
): ClassifiedDonor[] {
  const noticeByDonor = new Map(notices.map((notice) => [notice.donorId, notice]));
  // The query already has HAVING >= minSum; kept here so the list can't drift from the rule
  return rows
    .filter((row) => new Decimal(row.donationsSum).gte(minSum))
    .map((row) => {
      const noticeSum = new Decimal(row.donationsSum);
      const email = (row.email ?? "").trim();
      const notice = noticeByDonor.get(row.donorId);
      const sent = notice?.status === "sent";
      const ruleExclusion: NoticeExclusion | null = row.trashed
        ? "trashed"
        : row.donorId === ANONYMOUS_DONOR_ID
          ? "anonymous"
          : email === ""
            ? "noEmail"
            : isInternalEmail(email)
              ? "internalEmail"
              : row.taxUnits > 0
                ? "hasTaxUnit"
                : null;
      const exclusion: NoticeExclusion | null = sent
        ? null
        : (ruleExclusion ?? (notice?.status === "excluded" ? "leftOut" : null));
      const status: NoticeStatus = sent ? "sent" : exclusion ? "excluded" : "notice";
      return {
        ...row,
        noticeSum: noticeSum.toFixed(2),
        exclusion,
        ruleExclusion,
        status,
        statusBy: notice && (sent || exclusion === "leftOut") ? notice.updatedBy : null,
        statusAt: notice && (sent || exclusion === "leftOut") ? notice.updated : null,
        reminders: notice?.reminders ?? 0,
        lastReminded: notice?.lastReminded ?? null,
      };
    });
}

/** A recipient of the notice, with the donors (one email address can have several) it covers */
export type NoticeRecipient = EligibleDonor & { donorIds: number[] };

/**
 * The round's recipients, one per email address, largest first: the donors in "Gets the notice"
 * for the notice, the donors in "Sent" (still without tax unit) for a reminder. With donorIds,
 * only those of them.
 */
export function noticeRecipients(
  donors: ClassifiedDonor[],
  excludedEmails: string[] = [],
  { round = "notice", donorIds }: { round?: NoticeRound; donorIds?: number[] } = {},
): NoticeRecipient[] {
  const excluded = new Set(excludedEmails.map((email) => email.trim().toLowerCase()));
  const only = donorIds ? new Set(donorIds) : null;
  const status = round === "reminder" ? "sent" : "notice";
  const byEmail = new Map<string, NoticeRecipient>();
  for (const donor of donors) {
    if (donor.status !== status) continue;
    if (round === "reminder" && donor.ruleExclusion) continue;
    if (only && !only.has(donor.donorId)) continue;
    const email = donor.email!.trim();
    const key = email.toLowerCase();
    if (excluded.has(key)) continue;
    const existing = byEmail.get(key);
    const sum = Number(donor.noticeSum);
    if (existing) {
      existing.donationsSum += sum;
      existing.donorIds.push(donor.donorId);
    } else
      byEmail.set(key, {
        email,
        full_name: donor.name ?? "",
        donationsSum: sum,
        unitCount: 0,
        donorIds: [donor.donorId],
      });
  }
  return [...byEmail.values()].sort((a, b) => b.donationsSum - a.donationsSum);
}

export type MissingTaxUnitNoticeResult = {
  round: NoticeRound;
  /** Emails to send (one per address) */
  total: number;
  success: number;
  failed: number;
  testMode: boolean;
  /** Donors recorded as sent, or as reminded (real sendings only); a test records nothing */
  donorsMarkedSent: number;
};

/**
 * Sends the "you have no tax unit" notice to the donors classifyDonorsWithoutTaxUnit puts in
 * "Gets the notice" (at least minSum in the year without tax unit, fundraiser gifts included, not
 * left out and not sent before). In batches of 10, a second apart. A real sending records each
 * donor it reached in Tax_unit_notices, so the next round skips them; a test records nothing.
 * @param actor Who sends, for Tax_unit_notices.Updated_by
 */
export async function sendMissingTaxUnitNotices(
  {
    year,
    minSum,
    excludedEmails = [],
    testEmail,
    testLimit,
    confirmYear,
    round = "notice",
    donorIds,
  }: MissingTaxUnitNoticeOptions,
  actor = "REST /mail/notice/missingtaxunit",
): Promise<MissingTaxUnitNoticeResult> {
  const problem = noticeOptionsProblem({ year, minSum, testEmail, testLimit, confirmYear });
  if (problem) throw new Error(problem);
  const reminder = round === "reminder";
  const [rows, notices] = await Promise.all([
    DAO.tax.getDonorsWithoutTaxUnitInYear(year, minSum),
    DAO.taxunitnotices.getForYear(year),
  ]);
  let donorsWithDonationsMissingTaxUnit = noticeRecipients(
    classifyDonorsWithoutTaxUnit(rows, minSum, notices),
    excludedEmails,
    { round, donorIds },
  );
  const testMode = !!testEmail;
  let donorsMarkedSent = 0;

  // Apply test limit if specified
  if (testLimit && typeof testLimit === "number" && testLimit > 0) {
    donorsWithDonationsMissingTaxUnit = donorsWithDonationsMissingTaxUnit.slice(0, testLimit);
    console.log(`TEST MODE: Limited to first ${testLimit} donors`);
  }

  // Log test email override if specified
  if (testEmail) {
    console.log(`TEST MODE: All emails will be sent to ${testEmail}`);
  }

  let successfullySent = 0;
  let failedToSend = 0;
  const totalEmails = donorsWithDonationsMissingTaxUnit.length;

  console.log(
    `Starting to send missing tax unit notices to ${totalEmails} donors for year ${year}`,
  );

  // Batch send to all donors, maximum 10 at a time
  const MAX_CONCURRENT = 10;
  const donorsQueue = [...donorsWithDonationsMissingTaxUnit];

  while (donorsQueue.length > 0) {
    // Wait 1 second between batches
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const batch = donorsQueue.splice(0, MAX_CONCURRENT);

    console.log(
      `Batch sending ${batch.length} notices (progress: ${
        successfullySent + failedToSend
      }/${totalEmails}) (success: ${successfullySent}) (failed: ${failedToSend})...`,
    );

    const batchResults = await Promise.allSettled(
      // If testEmail is provided, override the donor's email for testing
      batch.map((donor) =>
        mail.sendMissingTaxUnitNotice(donor, year, testEmail || donor.email, { reminder }),
      ),
    );

    const reached: number[] = [];
    batchResults.forEach((result, i) => {
      if (result.status === "fulfilled" && result.value === true) {
        successfullySent++;
        reached.push(...batch[i].donorIds);
      } else {
        failedToSend++;
        if (result.status === "rejected") {
          console.error("Failed to send", result.reason);
        } else {
          console.error("Failed to send, returned:", result.value);
        }
      }
    });
    // Recorded per batch, so a sending that stops halfway still knows who got it
    if (!testMode && reached.length > 0) {
      if (reminder) await DAO.taxunitnotices.markReminded(year, reached, actor);
      else await DAO.taxunitnotices.markSent(year, reached, actor);
      donorsMarkedSent += reached.length;
    }
  }

  console.log(
    `Finished sending missing tax unit notices. Success: ${successfullySent}, Failed: ${failedToSend}`,
  );

  return {
    round,
    total: totalEmails,
    success: successfullySent,
    failed: failedToSend,
    testMode,
    donorsMarkedSent,
  };
}

export type MissingTaxUnitNoticePreview = {
  round: NoticeRound;
  /** Emails the round would send (one per address), and the donors they cover */
  emails: number;
  donors: number;
  /** The first (largest) recipient, whose email is shown */
  example: { donorIds: number[]; name: string; email: string; donationsSum: number } | null;
  /** MailerSend template and the values filled into it for the example; null when none */
  mail: mail.MissingTaxUnitNoticeMail | null;
  /** Why the email could not be made for the example, e.g. no limits for the year */
  problem: string | null;
};

/**
 * What the round would send: how many, and the email for its first recipient (the template and
 * the values filled in). Sends nothing and records nothing.
 */
export async function previewMissingTaxUnitNotice({
  year,
  minSum,
  round = "notice",
  donorIds,
}: Pick<
  MissingTaxUnitNoticeOptions,
  "year" | "minSum" | "round" | "donorIds"
>): Promise<MissingTaxUnitNoticePreview> {
  const [rows, notices] = await Promise.all([
    DAO.tax.getDonorsWithoutTaxUnitInYear(year, minSum),
    DAO.taxunitnotices.getForYear(year),
  ]);
  const recipients = noticeRecipients(classifyDonorsWithoutTaxUnit(rows, minSum, notices), [], {
    round,
    donorIds,
  });
  const first = recipients[0];
  const base = {
    round,
    emails: recipients.length,
    donors: recipients.reduce((acc, recipient) => acc + recipient.donorIds.length, 0),
  };
  if (!first) return { ...base, example: null, mail: null, problem: null };
  const example = {
    donorIds: first.donorIds,
    name: first.full_name,
    email: first.email,
    donationsSum: first.donationsSum,
  };
  try {
    const built = await mail.buildMissingTaxUnitNotice(first, year, {
      reminder: round === "reminder",
    });
    return {
      ...base,
      example,
      mail: built,
      problem: built
        ? null
        : `The email can't be made for ${year}: are the year's limits in the code?`,
    };
  } catch (ex) {
    return {
      ...base,
      example,
      mail: null,
      problem: `The email can't be made: ${(ex as Error).message}`,
    };
  }
}
