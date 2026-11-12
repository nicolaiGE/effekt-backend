import { describe, it } from "vitest";
import { expect } from "chai";
import { parseAmount, parseEanTaxUnits } from "../custom_modules/parsers/eanTaxUnits";

// Made-up numbers with the right lengths; not real persons
const PERSON = "01010112345";
const ORGANIZATION = "123456789";

describe("EA Giverportal CSV", () => {
  describe("parseAmount", () => {
    it("reads English and Norwegian amounts", () => {
      const cases: [string, number][] = [
        ["1500", 1500],
        ["1500.5", 1500.5],
        ["1500,50", 1500.5],
        ["1,500.50", 1500.5],
        ["1.500,50", 1500.5],
        ["1 500,50", 1500.5],
        ["1 500,50 kr", 1500.5],
        ["12,500", 12500],
        ["1.234.567", 1234567],
        ["kr 250", 250],
      ];
      for (const [text, value] of cases) expect(parseAmount(text), text).to.equal(value);
    });

    it("refuses amounts it would have to guess", () => {
      for (const text of ["", "abc", "1,500,50", "1.500.5", "12,5000", "1,5,0", "15.000.00"])
        expect(parseAmount(text), text).to.equal(null);
    });
  });

  describe("parseEanTaxUnits", () => {
    it("reads Norwegian spreadsheets: semicolons, comma decimals, Norwegian headers and SANN", () => {
      const csv = `Navn;Fnr;Beløp;Gi Effektivt\nAda;${PERSON};12 500,50;SANN\nBedrift AS;${ORGANIZATION};1000;USANN\n`;
      expect(parseEanTaxUnits(Buffer.from(csv))).to.deep.equal([
        { name: "Ada", ssn: PERSON, sum: 12500.5, gieffektivt: true },
        { name: "Bedrift AS", ssn: ORGANIZATION, sum: 1000, gieffektivt: false },
      ]);
    });

    it("reads the headers in any case, with spaces in the number", () => {
      const csv = `NAME,SSN,SUM,GIEFFEKTIVT\nAda,010101 12345,"1,500.50",true\n`;
      expect(parseEanTaxUnits(csv)).to.deep.equal([
        { name: "Ada", ssn: PERSON, sum: 1500.5, gieffektivt: true },
      ]);
    });

    it("names the row, never the number, when a value is wrong", () => {
      const bad = (row: string) => () => parseEanTaxUnits(`name,ssn,sum,gieffektivt\n${row}`);
      expect(bad(`Ada,${PERSON},"1,500,50",TRUE`)).to.throw(/“Ada”: the sum “1,500,50”/);
      expect(bad(`Ada,${PERSON},100,MAYBE`)).to.throw(/“Ada”: gieffektivt must be TRUE or FALSE/);
      expect(bad(`Ada,12345,100,TRUE`)).to.throw(/“Ada”: the number must have 11 digits/);
      try {
        bad(`Ada,${PERSON}9,100,TRUE`)();
      } catch (ex) {
        expect((ex as Error).message).not.to.contain(PERSON);
      }
    });

    it("says which column is missing", () => {
      expect(() => parseEanTaxUnits(`name,fødselsnr,sum\nAda,${PERSON},100`)).to.throw(
        /Missing column ssn, gieffektivt/,
      );
    });

    it("gives no rows for an empty file and skips rows without a number", () => {
      expect(parseEanTaxUnits("name,ssn,sum,gieffektivt\n")).to.deep.equal([]);
      expect(parseEanTaxUnits(`name,ssn,sum,gieffektivt\nAda,,100,TRUE\n,,,\n`)).to.deep.equal([]);
    });
  });
});
