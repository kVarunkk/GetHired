import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";
import { MAX_SHEET_ROWS, parseSheet, SheetError } from "./parse-sheet";

const fixture = (name: string) =>
  new File([readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)))], name);

async function workbook(sheets: Record<string, unknown[][]>, name = "people.xlsx") {
  const book = new Workbook();
  for (const [sheet, rows] of Object.entries(sheets)) book.addWorksheet(sheet).addRows(rows);
  return new File([await book.xlsx.writeBuffer()], name);
}

const refused = async (file: File) => {
  const error = await parseSheet(file).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SheetError);
  return (error as Error).message;
};

describe("parseSheet: CSV (BI-REQ-010)", () => {
  it("reads a comma-separated UTF-8 file", async () => {
    expect(await parseSheet(fixture("comma.csv"))).toEqual({
      headers: ["Name", "Email", "Phone"],
      rows: [
        ["Asha Rao", "asha@mail.test", "+91 98450 00000"],
        ["Ravi Kumar", "ravi@mail.test", ""],
      ],
    });
  });

  it("drops a UTF-8 byte order mark", async () => {
    const { headers } = await parseSheet(fixture("bom.csv"));
    expect(headers).toEqual(["Name", "Email"]);
  });

  it("detects semicolons and tabs", async () => {
    expect(await parseSheet(fixture("semicolon.csv"))).toMatchObject({
      headers: ["Name", "Email", "Skills"],
      rows: [["Asha Rao", "asha@mail.test", "Go, Rust"]],
    });
    expect(await parseSheet(fixture("tab.csv"))).toMatchObject({
      headers: ["Name", "Email", "Skills"],
      rows: [["Asha Rao", "asha@mail.test", "Go; Rust"]],
    });
  });

  it("keeps commas and newlines inside quotes", async () => {
    const { rows } = await parseSheet(fixture("quoted.csv"));
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Rao, Asha");
    expect(rows[0][1]).toMatch(/^Met at the meetup,\r?\nreferred by Ravi$/);
    expect(rows[0][2]).toBe("asha@mail.test");
  });

  it("drops blank trailing rows", async () => {
    expect((await parseSheet(fixture("trailing-blank.csv"))).rows).toEqual([["Asha Rao", "asha@mail.test"]]);
  });

  it("names an empty header cell Column N", async () => {
    expect((await parseSheet(fixture("blank-header.csv"))).headers).toEqual(["Name", "Column 2", "Email"]);
  });

  it(`refuses more than ${MAX_SHEET_ROWS} rows and more than 10 MB`, async () => {
    const lines = ["Name,Email", ...Array.from({ length: MAX_SHEET_ROWS + 1 }, (_, i) => `P${i},p${i}@mail.test`)];
    expect(await refused(new File([lines.join("\n")], "big.csv"))).toBe(
      "This file has 5,001 rows. Import at most 5,000 at a time.",
    );
    const atLimit = new File([lines.slice(0, -1).join("\n")], "ok.csv");
    expect((await parseSheet(atLimit)).rows).toHaveLength(MAX_SHEET_ROWS);

    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61)], "huge.csv");
    expect(await refused(huge)).toMatch(/over 10 MB/);
  });

  it("refuses a file that isn't a spreadsheet", async () => {
    expect(await refused(fixture("not-a-sheet.csv"))).toBe("Upload a .csv or .xlsx file.");
    expect(await refused(new File(["Name\nAsha"], "people.txt"))).toBe("Upload a .csv or .xlsx file.");
    expect(await refused(new File(["Name,Email\nAsha,a@b.co"], "renamed.xlsx"))).toBe("Upload a .csv or .xlsx file.");
    expect(await refused(new File(["Name,Email\n"], "empty.csv"))).toMatch(/no one in it/);
  });
});

describe("parseSheet: XLSX", () => {
  it("reads the first sheet, with numbers and dates as text", async () => {
    const file = await workbook({
      People: [
        ["Name", "Experience", "Applied", "Email"],
        ["Asha Rao", 4.5, new Date(Date.UTC(2026, 2, 14)), { text: "asha@mail.test", hyperlink: "mailto:asha@mail.test" }],
        [],
        ["Ravi Kumar", 0, null, "ravi@mail.test"],
      ],
    });
    expect(await parseSheet(file)).toEqual({
      sheet: "People",
      headers: ["Name", "Experience", "Applied", "Email"],
      rows: [
        ["Asha Rao", "4.5", "2026-03-14", "asha@mail.test"],
        ["Ravi Kumar", "0", "", "ravi@mail.test"],
      ],
    });
  });

  it("lists the sheets when there are several, and reads the one picked", async () => {
    const file = await workbook({
      Notes: [["Exported"], ["by our old ATS"]],
      Candidates: [["Name", "Email"], ["Asha Rao", "asha@mail.test"]],
    });
    expect(await parseSheet(file)).toMatchObject({ sheets: ["Notes", "Candidates"], sheet: "Notes" });
    expect(await parseSheet(file, { sheet: "Candidates" })).toEqual({
      sheets: ["Notes", "Candidates"],
      sheet: "Candidates",
      headers: ["Name", "Email"],
      rows: [["Asha Rao", "asha@mail.test"]],
    });
  });

  it("refuses a workbook it can't read", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    expect(await refused(new File([zip], "broken.xlsx"))).toMatch(/Couldn't read this workbook/);
  });
});
