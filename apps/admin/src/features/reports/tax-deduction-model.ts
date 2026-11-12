/**
 * The tax deduction report to Skatteetaten (Reports › Tax deduction): defaults and the request
 * the XML download sends.
 */

/** Gifts below this per tax unit and year give no deduction and are not reported */
export const TAX_MIN_SUM = 500;

/**
 * The page opens on the running year, to follow its figures and lists while gifts come in. The
 * report in January is for the year before: pick it in the year selector.
 */
export function defaultTaxYear(today = new Date()): number {
  return today.getFullYear();
}

/**
 * The gift years to choose from, newest first: this year (to follow the figures while it runs)
 * and the five before it
 */
export function taxYearOptions(today = new Date()): number[] {
  const latest = today.getFullYear();
  return Array.from({ length: 6 }, (_, i) => latest - i);
}

export type TaxContact = { name: string; email: string; phoneNumber: string; smsNumber: string };

export const emptyTaxContact: TaxContact = { name: "", email: "", phoneNumber: "", smsNumber: "" };

/** Field errors for the contact details the XML file carries (Skatteetaten allows 20 characters for numbers) */
export function taxContactErrors(contact: TaxContact): Partial<Record<keyof TaxContact, string>> {
  const errors: Partial<Record<keyof TaxContact, string>> = {};
  if (!contact.name.trim()) errors.name = "Enter the contact person's name";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()))
    errors.email = "Enter a valid email address";
  for (const key of ["phoneNumber", "smsNumber"] as const) {
    const value = contact[key].trim();
    if (!value) errors[key] = "Enter a phone number";
    else if (value.length > 20) errors[key] = "At most 20 characters";
  }
  return errors;
}

/** FormData for reports.tax.skatteetaten */
export function taxXmlForm(input: {
  year: number;
  minSum: number;
  report: File;
  contact: TaxContact;
}): FormData {
  const form = new FormData();
  form.append("report", input.report);
  form.append("year", String(input.year));
  form.append("minSum", String(input.minSum));
  for (const [key, value] of Object.entries(input.contact)) form.append(key, value.trim());
  return form;
}
