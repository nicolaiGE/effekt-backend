import { DAO } from "./DAO";
import { Decimal } from "decimal.js";
import type { DonorWithoutTaxUnitRow } from "./DAO_modules/tax";
import * as mail from "./mail";
import type { EligibleDonor } from "./mail";
import {
  type MissingTaxUnitNoticeOptions,
  noticeOptionsProblem,
} from "./missingTaxUnitNoticeOptions";

export { type MissingTaxUnitNoticeOptions, noticeOptionsProblem };

/** The shared donor for gifts without contact details (see also vipps.ts and amf.ts) */
export const ANONYMOUS_DONOR_ID = 1464;

/** Why a donor without tax unit does not get the missing tax unit notice */
export type NoticeExclusion = "trashed" | "anonymous" | "noEmail" | "internalEmail" | "hasTaxUnit";

export const noticeExclusionLabels: Record<NoticeExclusion, string> = {
  trashed: "Deleted donor",
  anonymous: "Anonymous donor",
  noEmail: "No email address",
  internalEmail: "Internal or placeholder address",
  hasTaxUnit: "Has a tax unit, check the KIDs",
};

export type ClassifiedDonor = DonorWithoutTaxUnitRow & {
  /** Without fundraiser gifts: what a new tax unit would cover, decimal string */
  noticeSum: string;
  /** Null when the donor gets the notice */
  exclusion: NoticeExclusion | null;
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
): ClassifiedDonor[] {
  // The query already has HAVING >= minSum; kept here so the list can't drift from the rule
  return rows
    .filter((row) => new Decimal(row.donationsSum).gte(minSum))
    .map((row) => {
      const noticeSum = new Decimal(row.donationsSum);
      const email = (row.email ?? "").trim();
      const exclusion: NoticeExclusion | null = row.trashed
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
      return { ...row, noticeSum: noticeSum.toFixed(2), exclusion };
    });
}

/** The notice's recipients: one per email address, largest first */
export function noticeRecipients(
  donors: ClassifiedDonor[],
  excludedEmails: string[] = [],
): EligibleDonor[] {
  const excluded = new Set(excludedEmails.map((email) => email.trim().toLowerCase()));
  const byEmail = new Map<string, EligibleDonor>();
  for (const donor of donors) {
    if (donor.exclusion) continue;
    const email = donor.email!.trim();
    const key = email.toLowerCase();
    if (excluded.has(key)) continue;
    const existing = byEmail.get(key);
    const sum = Number(donor.noticeSum);
    if (existing) existing.donationsSum += sum;
    else byEmail.set(key, { email, full_name: donor.name ?? "", donationsSum: sum, unitCount: 0 });
  }
  return [...byEmail.values()].sort((a, b) => b.donationsSum - a.donationsSum);
}

export type MissingTaxUnitNoticeResult = {
  total: number;
  success: number;
  failed: number;
  testMode: boolean;
};

/**
 * Sends the "you have no tax unit" notice to the donors classifyDonorsWithoutTaxUnit lets through
 * (at least minSum in the year without tax unit, fundraiser gifts included). In batches of 10,
 * a second apart.
 */
export async function sendMissingTaxUnitNotices({
  year,
  minSum,
  excludedEmails = [],
  testEmail,
  testLimit,
  confirmYear,
}: MissingTaxUnitNoticeOptions): Promise<MissingTaxUnitNoticeResult> {
  const problem = noticeOptionsProblem({ year, minSum, testEmail, testLimit, confirmYear });
  if (problem) throw new Error(problem);
  let donorsWithDonationsMissingTaxUnit = noticeRecipients(
    classifyDonorsWithoutTaxUnit(await DAO.tax.getDonorsWithoutTaxUnitInYear(year, minSum), minSum),
    excludedEmails,
  );

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
      batch.map((donor) => mail.sendMissingTaxUnitNotice(donor, year, testEmail || donor.email)),
    );

    batchResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value === true) {
        successfullySent++;
      } else {
        failedToSend++;
        if (result.status === "rejected") {
          console.error("Failed to send", result.reason);
        } else {
          console.error("Failed to send, returned:", result.value);
        }
      }
    });
  }

  console.log(
    `Finished sending missing tax unit notices. Success: ${successfullySent}, Failed: ${failedToSend}`,
  );

  return {
    total: totalEmails,
    success: successfullySent,
    failed: failedToSend,
    testMode: !!testEmail,
  };
}
