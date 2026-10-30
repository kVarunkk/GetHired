import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { candidateImportPath, jobImportPath } from "@/helpers/candidates/paths";
import ImportMethodTabs from "./ImportMethodTabs";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-0000000000a1";
const links = () => screen.getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")]);
const active = () => screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");

describe("ImportMethodTabs (CPT-018, CP-REQ-021/031)", () => {
  it("links a job's three methods and marks the current route", () => {
    vi.mocked(usePathname).mockReturnValue(jobImportPath(JOB, "spreadsheet"));
    render(<ImportMethodTabs jobId={JOB} />);
    expect(links()).toEqual([
      ["Resumes", jobImportPath(JOB, "resumes")],
      ["Spreadsheet", jobImportPath(JOB, "spreadsheet")],
      ["One person", jobImportPath(JOB, "form")],
    ]);
    expect(active().map((l) => l.textContent)).toEqual(["Spreadsheet"]);
  });

  it("links the Candidates page's two methods", () => {
    vi.mocked(usePathname).mockReturnValue(candidateImportPath("resumes"));
    render(<ImportMethodTabs />);
    expect(links()).toEqual([
      ["Resumes", candidateImportPath("resumes")],
      ["Spreadsheet", candidateImportPath("spreadsheet")],
    ]);
    expect(active().map((l) => l.textContent)).toEqual(["Resumes"]);
  });

  it("renders only the methods it's given", () => {
    vi.mocked(usePathname).mockReturnValue(jobImportPath(JOB, "form"));
    render(<ImportMethodTabs jobId={JOB} methods={["form"]} />);
    expect(links()).toEqual([["One person", jobImportPath(JOB, "form")]]);
  });
});
