// The downloadable template for spreadsheet imports (BI-REQ-010): every
// field's header with one example row. Its headers map themselves
// (map-columns.ts). Client-safe.

import { escapeCsvCell } from "./csv-safety";

const TEMPLATE: [header: string, example: string][] = [
  ["Name", "Asha Rao"],
  ["Email", "asha.rao@example.com"],
  ["Phone", "+91 98450 12345"],
  ["Location", "Bengaluru"],
  ["Current title", "Backend Engineer"],
  ["Current company", "Acme"],
  ["Years of experience", "4.5"],
  ["LinkedIn", "https://www.linkedin.com/in/asharao"],
  ["GitHub", "https://github.com/asharao"],
  ["Portfolio", "https://asharao.dev"],
  ["Skills", "Go, PostgreSQL, Kubernetes"],
  ["Tags", "referral, 2025 drive"],
  ["Notes", "Met at the Go meetup."],
  ["Resume link", "https://example.com/asha-rao.pdf"],
  ["Stage", "Phone screen"],
];

export const TEMPLATE_FILE_NAME = "gethired-candidates-template.csv";

export function templateCsv(): string {
  return [TEMPLATE.map(([h]) => escapeCsvCell(h)), TEMPLATE.map(([, v]) => escapeCsvCell(v))]
    .map((row) => row.join(","))
    .join("\r\n");
}
