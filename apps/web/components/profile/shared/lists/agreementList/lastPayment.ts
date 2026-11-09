import { dateNumeric } from "../../../../../util/formatting";

/** The fields of a Min Side donation this needs */
type DonationWithKid = { KID: string; timestamp: string };

/**
 * The newest donation timestamp for each KID. An agreement's payments are donations on its KID,
 * so this gives the date of the latest payment per agreement without a new backend field.
 */
export function lastPaymentByKid(donations: readonly DonationWithKid[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const donation of donations) {
    const current = latest.get(donation.KID);
    if (!current || Date.parse(donation.timestamp) > Date.parse(current)) {
      latest.set(donation.KID, donation.timestamp);
    }
  }
  return latest;
}

/**
 * The text of a "last payment" cell. Empty until the donations have loaded, so the column does
 * not claim "none" too early. Without a payment it shows the editor's text from the column.
 */
export function formatLastPayment(
  lastPayment: string | undefined,
  loaded: boolean,
  emptyText: string | undefined,
): string {
  if (!loaded) return "";
  return lastPayment ? dateNumeric(lastPayment) : (emptyText ?? "");
}
