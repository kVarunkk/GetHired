import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { eventOf, stageOf } from "@/test/utils/pipeline";
import ActivityTimeline from "./ActivityTimeline";

const STAGES = [stageOf("screening"), stageOf("interview")].map(({ id, name }) => ({ id, name }));
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

describe("ActivityTimeline (PLT-054)", () => {
  it("renders a line per event type, newest first, with a relative time", () => {
    render(
      <ActivityTimeline
        stages={STAGES}
        events={[
          eventOf("applied", { created_at: minutesAgo(500), actor_name: null, actor_user_id: null }),
          eventOf("stage_changed", {
            created_at: minutesAgo(5),
            actor_name: "Asha",
            payload: {
              from_stage_id: stageOf("screening").id,
              to_stage_id: stageOf("interview").id,
              from_kind: "screening",
              to_kind: "interview",
            },
          }),
          eventOf("email_sent", {
            created_at: minutesAgo(4),
            actor_name: "Asha",
            payload: { subject: "Interview for Backend Engineer" },
          }),
          eventOf("note_added", { created_at: minutesAgo(3), actor_name: "Ravi", payload: { rated: true } }),
          eventOf("screened", {
            created_at: minutesAgo(60),
            actor_name: null,
            actor_user_id: null,
            payload: { fit_score: 82 },
          }),
        ]}
      />,
    );

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toHaveLength(5);
    expect(items[0]).toContain("Note added by Ravi, with a rating");
    expect(items[1]).toContain('Emailed "Interview for Backend Engineer" by Asha');
    expect(items[2]).toContain("Moved from Screening to Interview by Asha");
    expect(items[3]).toContain("Screened: fit score 82");
    expect(items[4]).toContain("Applied");
    expect(items[0]).toMatch(/ago/);
  });

  it("names an archived or unknown stage generically", () => {
    render(
      <ActivityTimeline
        stages={STAGES}
        events={[
          eventOf("stage_changed", {
            actor_name: null,
            payload: { from_stage_id: "gone", to_stage_id: stageOf("interview").id },
          }),
        ]}
      />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent("Moved from a removed stage to Interview");
  });

  it("skips an unknown type instead of crashing", () => {
    render(
      <ActivityTimeline
        stages={STAGES}
        events={[
          eventOf("applied"),
          { ...eventOf("applied"), id: "ffffffff-0000-4000-8000-000000000001", type: "something_new" as never },
        ]}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("says when there's no activity", () => {
    render(<ActivityTimeline stages={STAGES} events={[]} />);

    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  it("shows initials for events with a person, and none for system events (TMT-062)", () => {
    render(
      <ActivityTimeline
        stages={STAGES}
        events={[
          eventOf("note_added", { created_at: minutesAgo(3), actor_name: "Ravi Kumar", payload: {} }),
          eventOf("applied", { created_at: minutesAgo(500), actor_name: null, actor_user_id: null }),
        ]}
      />,
    );

    const [note, applied] = screen.getAllByRole("listitem");
    expect(note).toHaveTextContent("RK");
    expect(applied.textContent).toBe(applied.querySelector("p")!.textContent + applied.querySelector("time")!.textContent);
  });
});
