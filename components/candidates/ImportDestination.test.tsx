import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ImportDestination, {
  destinationReady,
  destinationValue,
  initialDestination,
  type Destination,
  type DestinationPage,
} from "./ImportDestination";

vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
// Radix's switch measures itself; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const JOB = "b0000000-0000-4000-8000-0000000000a1";
const JOB_2 = "b0000000-0000-4000-8000-0000000000a2";
const STAGE = "50000000-0000-4000-8000-000000000002";
const LIST = "71000000-0000-4000-8000-000000000001";
const INTERVIEW = { fitThreshold: 70, durationMinutes: 15 };

const PAGE: DestinationPage = {
  jobs: [
    { id: JOB, title: "Backend Engineer", interview: INTERVIEW },
    { id: JOB_2, title: "Designer", interview: null },
  ],
  stages: [
    { id: "50000000-0000-4000-8000-000000000001", name: "Applied" },
    { id: STAGE, name: "Onsite" },
  ],
  lists: [{ id: LIST, name: "Old ATS", slug: "old-ats" }],
  allowNoJob: true,
  screeningsRemaining: null,
  fixedJob: null,
};

let latest: Destination;
function Harness({ page = PAGE }: { page?: DestinationPage }) {
  const [value, setValue] = useState(() => initialDestination(page));
  latest = value;
  return <ImportDestination page={page} value={value} onChange={setValue} />;
}

const choose = (label: string, option: string) =>
  fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value: option } });
const options = (label: string) =>
  Array.from(screen.getByRole("combobox", { name: label }).querySelectorAll("option"))
    .map((o) => o.textContent)
    .filter(Boolean);

describe("ImportDestination (CPT-013, CP-REQ-001/003/010)", () => {
  it("offers your candidates, a list or a job, starting with your candidates", () => {
    render(<Harness />);
    expect(options("Add them to")).toEqual(["Your candidates only", "A talent list", "A job"]);
    expect(screen.queryByRole("combobox", { name: "Job" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Stage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Talent list" })).not.toBeInTheDocument();
    expect(destinationValue(PAGE, latest)).toEqual({ jobPostId: null, stageId: null, autoInvite: false });
  });

  it("needs a list for the list destination, and offers a new one", () => {
    render(<Harness />);
    choose("Add them to", "list");
    expect(destinationReady(latest)).toBe(false);
    expect(options("Talent list")).toEqual(["New list…", "Old ATS"]);
    expect(screen.queryByRole("combobox", { name: "Stage" })).not.toBeInTheDocument();

    choose("Talent list", LIST);
    expect(destinationValue(PAGE, latest)).toEqual({
      jobPostId: null,
      talentListId: LIST,
      stageId: null,
      autoInvite: false,
    });

    choose("Talent list", "new");
    expect(destinationReady(latest)).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "New list name" }), { target: { value: " Referrals " } });
    expect(destinationReady(latest)).toBe(true);
    expect(destinationValue(PAGE, latest)).toMatchObject({ newListName: "Referrals" });
  });

  it("shows the stage, an optional list and the auto-invite switch for a job that invites by score", () => {
    render(<Harness />);
    choose("Add them to", "job");
    expect(screen.getByRole("combobox", { name: "Job" })).toHaveValue(JOB);
    expect(options("Talent list")).toEqual(["No list", "New list…", "Old ATS"]);
    choose("Stage", STAGE);
    fireEvent.click(screen.getByRole("switch", { name: "Auto-invite to AI interview" }));
    choose("Talent list", LIST);
    expect(destinationValue(PAGE, latest)).toEqual({
      jobPostId: JOB,
      talentListId: LIST,
      stageId: STAGE,
      autoInvite: true,
    });

    choose("Job", JOB_2);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(destinationValue(PAGE, latest).autoInvite).toBe(false);
  });

  it("clears the stage, list and auto-invite when switching from a job to your candidates", () => {
    render(<Harness />);
    choose("Add them to", "job");
    choose("Stage", STAGE);
    fireEvent.click(screen.getByRole("switch", { name: "Auto-invite to AI interview" }));
    choose("Add them to", "pool");
    expect(latest).toMatchObject({ kind: "pool", jobId: null, stageId: null, autoInvite: false, list: null });
  });

  it("offers neither your candidates nor a list to a member scoped to some jobs", () => {
    render(<Harness page={{ ...PAGE, allowNoJob: false }} />);
    // One destination left: no choice to make.
    expect(screen.queryByRole("combobox", { name: "Add them to" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Job" })).toHaveValue(JOB);
    expect(latest.kind).toBe("job");
  });

  it("leaves the list out without talent_lists.manage", () => {
    render(<Harness page={{ ...PAGE, lists: null }} />);
    expect(options("Add them to")).toEqual(["Your candidates only", "A job"]);
    choose("Add them to", "job");
    expect(screen.queryByRole("combobox", { name: "Talent list" })).not.toBeInTheDocument();
  });

  it("shows a job page's job as text, with its stage and list", () => {
    render(<Harness page={{ ...PAGE, fixedJob: { id: JOB_2, title: "Designer", interview: INTERVIEW } }} />);
    expect(screen.getByText("Importing into")).toHaveTextContent("Importing into Designer");
    expect(screen.queryByRole("combobox", { name: "Add them to" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Job" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Talent list" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Auto-invite to AI interview" })).toBeInTheDocument();
    expect(destinationValue({ ...PAGE, fixedJob: { id: JOB_2, title: "Designer", interview: INTERVIEW } }, latest)).toEqual({
      jobPostId: JOB_2,
      stageId: null,
      autoInvite: false,
    });
  });
});
