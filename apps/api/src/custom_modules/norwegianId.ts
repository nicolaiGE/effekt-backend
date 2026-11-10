/**
 * Checks Norwegian identification numbers as Skatteetaten expects them in the tax deduction report:
 * fødselsnummer and D-nummer (11 digits, two mod 11 check digits) and organisasjonsnummer
 * (9 digits, one mod 11 check digit). Synthetic test numbers (Tenor, month + 80) pass, since only
 * the check digits are checked, not the date.
 */

export type NorwegianIdKind = "person" | "organization";

export type NorwegianIdProblem =
  /** Empty */
  | "missing"
  /** Something other than digits */
  | "notDigits"
  /** Neither 11 (person) nor 9 (organization) digits */
  | "length"
  /** The length is right, the mod 11 check digit(s) are not */
  | "checkDigit";

export type NorwegianIdCheck = {
  /** From the length, null when it is neither 9 nor 11 digits */
  kind: NorwegianIdKind | null;
  /** Null when the number is valid */
  problem: NorwegianIdProblem | null;
};

const PERSON_WEIGHTS_1 = [3, 7, 6, 1, 8, 9, 4, 5, 2];
const PERSON_WEIGHTS_2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
const ORGANIZATION_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];

/** The mod 11 check digit for the digits, or null when none exists (remainder gives 10) */
export function mod11CheckDigit(digits: number[], weights: number[]): number | null {
  const sum = digits.reduce((acc, digit, i) => acc + digit * weights[i], 0);
  const check = 11 - (sum % 11);
  if (check === 11) return 0;
  if (check === 10) return null;
  return check;
}

export function checkNorwegianId(value: string | null | undefined): NorwegianIdCheck {
  const id = (value ?? "").trim();
  if (id === "") return { kind: null, problem: "missing" };
  const kind = id.length === 11 ? "person" : id.length === 9 ? "organization" : null;
  if (!/^\d+$/.test(id)) return { kind, problem: "notDigits" };
  if (!kind) return { kind, problem: "length" };

  const digits = id.split("").map(Number);
  if (kind === "organization") {
    const check = mod11CheckDigit(digits.slice(0, 8), ORGANIZATION_WEIGHTS);
    return { kind, problem: check === digits[8] ? null : "checkDigit" };
  }
  const k1 = mod11CheckDigit(digits.slice(0, 9), PERSON_WEIGHTS_1);
  const k2 = mod11CheckDigit(digits.slice(0, 10), PERSON_WEIGHTS_2);
  const valid = k1 !== null && k2 !== null && k1 === digits[9] && k2 === digits[10];
  return { kind, problem: valid ? null : "checkDigit" };
}

/** Plain-English description of a problem, for the admin panel */
export function describeNorwegianIdProblem(id: string | null | undefined): string | null {
  const { problem } = checkNorwegianId(id);
  const length = (id ?? "").trim().length;
  switch (problem) {
    case null:
      return null;
    case "missing":
      return "No national ID or organization number";
    case "notDigits":
      return "Contains characters other than digits";
    case "length":
      return `Wrong length (${length} characters, expected 11 or 9)`;
    case "checkDigit":
      return length === 11
        ? "Invalid check digit (national ID)"
        : "Invalid check digit (organization number)";
  }
}

/**
 * Hides digit runs that could be a national ID or organization number (6 digits or more), so
 * error messages from parsers and the XSD validator can be shown without them.
 */
export const maskIdNumbers = (message: string): string => message.replace(/\d{6,}/g, "•••");
