// The missing tax unit notice's options and the rule for sending them. No imports, so the tRPC
// schemas (shared with the clients) can use the rule without the mail and database modules.

export type MissingTaxUnitNoticeOptions = {
  year: number;
  minSum: number;
  excludedEmails?: string[];
  /** Test mode: send every notice to this address instead of the donor's */
  testEmail?: string;
  /** Test mode: only the first (largest) donors. Only together with testEmail */
  testLimit?: number;
  /** A real send (no testEmail) must repeat the year here, so it can't happen by accident */
  confirmYear?: number;
};

/**
 * Why the options may not be sent, or null. Without testEmail the notices go to the donors
 * themselves, which needs the year repeated in confirmYear; testLimit alone would email real
 * donors while looking like a test, so it needs testEmail.
 */
export function noticeOptionsProblem(options: MissingTaxUnitNoticeOptions): string | null {
  if (options.testEmail) return null;
  if (options.testLimit) return "testLimit only works together with testEmail";
  // Number(): the REST route passes the JSON body on as it came
  if (Number(options.confirmYear) !== Number(options.year))
    return "Sending to donors needs confirmYear equal to year";
  return null;
}
