import { parse } from "csv-parse/sync";

export type EANTaxUnitsRow = {
  name: string;
  ssn: string;
  sum: number;
  gieffektivt: boolean;
};

/**
 * Header names we accept for each column, written as normalizeHeader gives them (lowercase, only
 * a-z and 0-9). Norwegian spreadsheets often say Navn, Fnr or Beløp, and "Gi Effektivt" with a
 * space is the same column as "Gieffektivt".
 */
const headerAliases: Record<keyof EANTaxUnitsRow, string[]> = {
  name: ["name", "navn", "fulltnavn", "fullname"],
  ssn: ["ssn", "fnr", "fodselsnummer", "fdselsnummer", "orgnr", "taxid"],
  sum: ["sum", "belop", "belp", "amount", "total", "totalt"],
  gieffektivt: ["gieffektivt"],
};

const normalizeHeader = (column: string) => column.toLowerCase().replace(/[^a-z0-9]/g, "");

const toField = (column: string): string => {
  const normalized = normalizeHeader(column);
  for (const [field, aliases] of Object.entries(headerAliases))
    if (aliases.includes(normalized)) return field;
  return normalized;
};

/** TRUE/FALSE as English and Norwegian spreadsheets write them */
const booleans: Record<string, boolean> = {
  true: true,
  sann: true,
  ja: true,
  yes: true,
  false: false,
  usann: false,
  nei: false,
  no: false,
};

/**
 * An amount in kroner as English or Norwegian spreadsheets write it: 1500, 1500.5, 1,500.50,
 * 1 500,50, 1.500,50 or 1500,50, with or without "kr". The decimal sign is a comma or full stop
 * followed by one or two digits at the end (kroner have at most two decimals); other commas,
 * full stops or spaces group thousands and must be three digits apart. Anything else is refused
 * rather than guessed: null when it isn't an amount.
 */
export function parseAmount(raw: string): number | null {
  const text = raw.replace(/kr\.?|nok/gi, "").replace(/[\s  ']/g, "");
  const match = /^(-?)(\d[\d.,]*?)(?:([.,])(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const [, minus, integer, decimalSign, decimals] = match;
  if (/[.,]/.test(integer)) {
    const grouping = /^\d{1,3}(([.,])\d{3})(\2\d{3})*$/.exec(integer);
    if (!grouping || grouping[2] === decimalSign) return null;
  }
  return Number(`${minus}${integer.replace(/[.,]/g, "")}.${decimals ?? "0"}`);
}

const parseWith = (text: string, delimiter: string): Record<string, string>[] =>
  parse(text, {
    delimiter,
    bom: true,
    skip_empty_lines: true,
    columns: (header: string[]) => header.map(toField),
    relax_column_count: true,
    trim: true,
  });

/**
 * EA Giverportal's units for the tax report: one row per donor (tax unit) with name, national ID
 * or organization number, the year's sum and whether the donor also gave to Gi Effektivt. Comma
 * or semicolon separated. Errors name the row by name, never by number.
 */
export const parseEanTaxUnits = (report: Buffer | string): EANTaxUnitsRow[] => {
  const text = report.toString();
  const firstLine = text.split(/\r?\n/, 1)[0];
  // The separator the header row uses; Norwegian Excel writes semicolons
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  let data: Record<string, string>[];
  try {
    data = parseWith(text, delimiter);
  } catch (ex) {
    throw new Error(`The file could not be read as CSV (${(ex as Error).message})`);
  }

  const rows = data.filter((row) => Object.values(row).some((value) => value !== ""));
  if (rows.length === 0) return [];
  const missing = (Object.keys(headerAliases) as (keyof EANTaxUnitsRow)[]).filter(
    (field) => !(field in rows[0]),
  );
  if (missing.length > 0)
    throw new Error(
      `Missing column ${missing.join(", ")}. The first row must name the columns name, ssn, sum and gieffektivt`,
    );

  return rows
    .filter((row) => row.ssn !== "")
    .map((row, index) => {
      const label = row.name ? `“${row.name}”` : `row ${index + 2}`;
      const ssn = row.ssn.replace(/[\s.-]/g, "");
      if (!/^(\d{9}|\d{11})$/.test(ssn))
        throw new Error(`${label}: the number must have 11 digits (person) or 9 (organization)`);
      const sum = parseAmount(row.sum ?? "");
      if (sum === null)
        throw new Error(
          `${label}: the sum “${row.sum}” is not an amount. Write it like 12500, 12500.50 or 12 500,50`,
        );
      const gieffektivt = booleans[(row.gieffektivt ?? "").toLowerCase()];
      if (gieffektivt === undefined)
        throw new Error(`${label}: gieffektivt must be TRUE or FALSE, not “${row.gieffektivt}”`);
      if (!row.name) throw new Error(`${label}: the name is missing`);
      return { name: row.name, ssn, sum, gieffektivt };
    });
};
