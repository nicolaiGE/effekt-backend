/**
 * The donation edit form: draft from the donation, validation, and the donations.update
 * input with only what changed, plus a before → after list for the confirmation.
 */
import {
  draftFromApi,
  draftToApi,
  sameDistribution,
  validateDraft,
  type CauseAreaConfig,
  type DistributionDraft,
} from "@/features/distribution/model";
import { formatDate, formatMoney, formatMoneyInput, formatNumber } from "@/lib/format";
import { compareMoney } from "@/lib/money";
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";
import {
  fromDateTimeInputs,
  moneyInputError,
  moneyToApi,
  parseMoneyInput,
  toDateTimeInputs,
} from "./form";

export type Donation = RouterOutputs["donations"]["get"];
export type DonationUpdate = RouterInputs["donations"]["update"];

export type EditDraft = {
  sum: string;
  transactionCost: string;
  date: string;
  time: string;
  paymentId: string;
  externalRef: string;
  ownerId: string;
  /** The tax unit the donation is reported on, "" = none. Part of the donation's distribution. */
  taxUnitId: string;
  distribution: DistributionDraft;
};

export type EditField = Exclude<keyof EditDraft, "date" | "time"> | "timestamp";

export function editDraftFromDonation(donation: Donation, config: CauseAreaConfig[]): EditDraft {
  const { date, time } = toDateTimeInputs(donation.timestamp);
  return {
    sum: formatMoneyInput(donation.sum),
    transactionCost: formatMoneyInput(donation.transactionCost),
    date,
    time,
    paymentId: String(donation.paymentId),
    externalRef: donation.paymentExternalRef ?? "",
    ownerId: String(donation.metaOwnerId),
    taxUnitId: taxUnitValue(donation.distribution.taxUnitId),
    distribution: draftFromApi(config, donation.distribution),
  };
}

/** The form's value for a distribution's tax unit: "" for none (null, or the database's 0) */
const taxUnitValue = (taxUnitId: number | null | undefined) => (taxUnitId ? String(taxUnitId) : "");

export function validateEdit(draft: EditDraft, original: Donation) {
  const cost = draft.transactionCost.trim() === "" ? null : parseMoneyInput(draft.transactionCost);
  const errors: Partial<Record<EditField, string>> = {
    sum: moneyInputError(draft.sum),
    transactionCost:
      draft.transactionCost.trim() !== "" && cost === null
        ? "Enter the fee as an amount, or leave it empty"
        : draft.transactionCost.trim() === "" && original.transactionCost != null
          ? "The fee can't be removed; enter 0 instead"
          : undefined,
    timestamp: fromDateTimeInputs(draft.date, draft.time) ? undefined : "Enter a valid date",
    externalRef:
      draft.externalRef.trim() === "" && original.paymentExternalRef
        ? "The external reference can't be removed"
        : draft.externalRef.trim().length > 32
          ? "At most 32 characters"
          : undefined,
    distribution: validateDraft(draft.distribution).valid
      ? undefined
      : "The distribution must add up to 100 %",
  };
  for (const key of Object.keys(errors) as EditField[]) if (!errors[key]) delete errors[key];
  return errors;
}

/** The money rule keeps øre, so 50.30 → 50.40 never reads as "50 kr → 50 kr". */
export const formatAmount = (value: string) => formatMoney(value);

export type Change = { label: string; before: string; after: string };

type Lookups = {
  config: CauseAreaConfig[];
  paymentMethodName: (id: number) => string | undefined;
  ownerName: (id: number) => string | undefined;
  /** The donor's tax unit by id, as the form lists it (name and masked number) */
  taxUnitName: (id: number) => string | undefined;
};

/** "Global health 60 %, Animal welfare 40 % (custom)" */
export function describeDistribution(draft: DistributionDraft, config: CauseAreaConfig[]) {
  return draft.causeAreas
    .filter((area) => area.share > 0)
    .map((area) => {
      const name = config.find((c) => c.id === area.id)?.name ?? `Cause area ${area.id}`;
      const share = formatNumber(area.share, { decimals: area.share % 1 ? 2 : 0 });
      return `${name} ${share} %${area.standardSplit ? "" : " (custom)"}`;
    })
    .join(", ");
}

/**
 * What changed, as the donations.update input (only changed fields) and as before → after
 * lines for the confirmation. Assumes the draft is valid.
 */
export function editChanges(
  original: Donation,
  draft: EditDraft,
  { config, paymentMethodName, ownerName, taxUnitName }: Lookups,
): { input: DonationUpdate; changes: Change[] } {
  const input: DonationUpdate = { id: original.id };
  const changes: Change[] = [];

  const sum = parseMoneyInput(draft.sum);
  if (sum !== null && compareMoney(sum, original.sum) !== 0) {
    input.sum = moneyToApi(sum);
    changes.push({ label: "Amount", before: formatAmount(original.sum), after: formatAmount(sum) });
  }

  const cost = draft.transactionCost.trim() === "" ? null : parseMoneyInput(draft.transactionCost);
  if (
    cost !== null &&
    (original.transactionCost == null || compareMoney(cost, original.transactionCost) !== 0)
  ) {
    input.transactionCost = moneyToApi(cost);
    changes.push({
      label: "Fee",
      before: original.transactionCost == null ? "none" : formatMoney(original.transactionCost),
      after: formatMoney(cost),
    });
  }

  // Compare what the form shows (minutes), so unseen seconds don't count as a change.
  const shown = toDateTimeInputs(original.timestamp);
  const timestamp = fromDateTimeInputs(draft.date, draft.time);
  if (timestamp && (shown.date !== draft.date || shown.time !== draft.time)) {
    input.timestamp = timestamp;
    changes.push({
      label: "Date",
      before: formatDate(original.timestamp, "datetime"),
      after: formatDate(timestamp, "datetime"),
    });
  }

  const paymentId = Number(draft.paymentId);
  if (paymentId !== original.paymentId) {
    input.paymentId = paymentId;
    changes.push({
      label: "Payment method",
      before: original.paymentMethod,
      after: paymentMethodName(paymentId) ?? `#${paymentId}`,
    });
  }

  const externalRef = draft.externalRef.trim();
  if (externalRef && externalRef !== (original.paymentExternalRef ?? "")) {
    input.paymentExternalRef = externalRef;
    changes.push({
      label: "External reference",
      before: original.paymentExternalRef ?? "none",
      after: externalRef,
    });
  }

  const ownerId = Number(draft.ownerId);
  if (ownerId !== original.metaOwnerId) {
    input.metaOwnerId = ownerId;
    changes.push({
      label: "Data owner",
      before: ownerName(original.metaOwnerId) ?? `#${original.metaOwnerId}`,
      after: ownerName(ownerId) ?? `#${ownerId}`,
    });
  }

  // The tax unit and the split are both part of the distribution: a change to either sends the
  // whole distribution, and the donation moves to a KID with that donor, tax unit and split
  const before = draftFromApi(config, original.distribution);
  const splitChanged = !sameDistribution(before, draft.distribution);
  const taxUnitBefore = taxUnitValue(original.distribution.taxUnitId);
  const taxUnitChanged = draft.taxUnitId !== taxUnitBefore;
  if (splitChanged || taxUnitChanged) {
    input.distribution = {
      donorId: original.donorId,
      // Unchanged, the stored value goes back as it is (an old KID can hold 0 for none, and the
      // API matches the KID on it)
      taxUnitId: taxUnitChanged
        ? draft.taxUnitId
          ? Number(draft.taxUnitId)
          : null
        : (original.distribution.taxUnitId ?? null),
      causeAreas: draftToApi(draft.distribution),
    };
  }
  if (taxUnitChanged) {
    const name = (value: string) =>
      value ? (taxUnitName(Number(value)) ?? `#${value}`) : "No tax unit";
    changes.push({ label: "Tax unit", before: name(taxUnitBefore), after: name(draft.taxUnitId) });
  }
  if (splitChanged) {
    changes.push({
      label: "Distribution",
      before: describeDistribution(before, config),
      after: describeDistribution(draft.distribution, config),
    });
  }

  return { input, changes };
}
