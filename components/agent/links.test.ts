import { describe, expect, it } from "vitest";
import { repairJobLinks } from "./links";

const ID = "5585ee61-7a8f-4e02-939a-ac1153a3ba00";

describe("repairJobLinks", () => {
  it.each([
    [`EE /jobs/${ID}`],
    [`//jobs/${ID}`],
    [`invocation:default_api:getJobDetails{jobId:${ID}}`],
    [`invocation:default_api:getJobDetails{jobId: ${ID}}`],
    [`مرحبا /jobs/${ID}`],
    [`/jobs/${ID} "Apply here"`],
    [`Mo: ${ID}`],
    [ID],
    [`id: ${ID.toUpperCase()}`],
  ])("repairs %s", (target) => {
    expect(repairJobLinks(`- [Frontend Engineer](${target}) at Acme`)).toBe(
      `- [Frontend Engineer](/jobs/${ID}) at Acme`,
    );
  });

  it("repairs every link in a reply", () => {
    const other = "e018b75b-606c-45d4-967f-70d2cb94607f";
    expect(repairJobLinks(`[A](EE /jobs/${ID}) and [B](//jobs/${other})`)).toBe(
      `[A](/jobs/${ID}) and [B](/jobs/${other})`,
    );
  });

  it.each([
    [`[Job](/jobs/${ID})`],
    [`[Job](https://gethired.devhub.co.in/jobs/${ID})`],
    ["[Resume](/resume/abc)"],
    ["[Evil](https://evil.example/steal)"],
    ["[Broken](EE /dashboard)"],
    [`[Resume](Mo: /resume/${ID})`],
    [`[Two](${ID} ${ID.replace("5585", "6585")})`],
    [`[Partial](x${ID})`],
    ["no links here"],
  ])("leaves %s alone", (text) => {
    expect(repairJobLinks(text)).toBe(text);
  });

  it("points an outside link that names a job at the in-app job page", () => {
    expect(repairJobLinks(`[Job](https://evil.example/jobs/${ID})`)).toBe(`[Job](/jobs/${ID})`);
  });
});
