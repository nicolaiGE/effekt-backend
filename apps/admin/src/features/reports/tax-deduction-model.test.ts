import { describe, expect, it } from "vitest";
import {
  defaultTaxYear,
  emptyTaxContact,
  taxContactErrors,
  taxXmlForm,
  taxYearOptions,
} from "./tax-deduction-model";

describe("tax deduction report", () => {
  it("defaults to last year and offers the five years before", () => {
    const january = new Date(2027, 0, 12);
    expect(defaultTaxYear(january)).toBe(2026);
    expect(taxYearOptions(january)).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  it("requires every contact detail, with phone numbers of at most 20 characters", () => {
    expect(Object.keys(taxContactErrors(emptyTaxContact)).sort()).toEqual([
      "email",
      "name",
      "phoneNumber",
      "smsNumber",
    ]);
    expect(
      taxContactErrors({
        name: "Test Testesen",
        email: "test@example.org",
        phoneNumber: "+47 999 99 999",
        smsNumber: "+47 999 99 999 / 999 99 999",
      }),
    ).toEqual({ smsNumber: "At most 20 characters" });
  });

  it("sends the file, year, minimum and trimmed contact details as FormData", () => {
    const report = new File(["Name,ssn,Sum,Gieffektivt"], "giverportal.csv", { type: "text/csv" });
    const form = taxXmlForm({
      year: 2026,
      minSum: 500,
      report,
      contact: { name: " Test ", email: "test@example.org", phoneNumber: "1", smsNumber: "2" },
    });
    expect(form.get("report")).toBe(report);
    expect(Object.fromEntries([...form.entries()].filter(([key]) => key !== "report"))).toEqual({
      year: "2026",
      minSum: "500",
      name: "Test",
      email: "test@example.org",
      phoneNumber: "1",
      smsNumber: "2",
    });
  });
});
