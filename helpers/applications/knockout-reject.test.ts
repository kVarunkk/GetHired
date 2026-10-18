import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { KNOCKOUT_ACTOR_NAME, rejectForKnockout } from "./knockout-reject";

vi.mock("server-only", () => ({}));

const APP_ID = "e0000000-0000-4000-8000-0000000000aa";
const STAGE_ID = "5a000000-0000-4000-8000-000000000006";
const input = { applicationId: APP_ID, companyId: COMPANY_A.id, candidateUserId: PUBLIC_APPLICANT.id };

let service: SupabaseMock;
const writeOf = (table: string, method: string) =>
  service.callsFor(table).find((c) => c.chain.some((m) => m.method === method))?.chain.find((m) => m.method === method)?.args[0];

beforeEach(() => {
  service = createSupabaseMock();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("rejectForKnockout (AF-REQ-003, CPT-032)", () => {
  it("moves the application to the company's first Rejected stage and logs it without a person", async () => {
    service.queue("pipeline_stages", { data: { id: STAGE_ID, kind: "rejected" }, error: null });
    service.queue("applications", { data: { stage_id: "s-applied", pipeline_stages: { kind: "applied" } }, error: null });
    service.queue("applications", { data: null, error: null });
    service.queue("application_events", { data: null, error: null });

    expect(await rejectForKnockout(service.client, input)).toBe(true);

    const stageQuery = service.callsFor("pipeline_stages")[0].chain;
    expect(stageQuery).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(stageQuery).toContainEqual({ method: "eq", args: ["kind", "rejected"] });
    expect(stageQuery).toContainEqual({ method: "eq", args: ["archived", false] });
    expect(writeOf("applications", "update")).toMatchObject({ stage_id: STAGE_ID });
    expect(writeOf("application_events", "insert")).toMatchObject({
      application_id: APP_ID,
      actor_user_id: null,
      actor_name: KNOCKOUT_ACTOR_NAME,
      type: "stage_changed",
      payload: { from_stage_id: "s-applied", to_stage_id: STAGE_ID, to_kind: "rejected", reason: "knockout" },
    });
  });

  it("does nothing without a Rejected stage", async () => {
    service.queue("pipeline_stages", { data: null, error: null });
    expect(await rejectForKnockout(service.client, input)).toBe(false);
    expect(writeOf("applications", "update")).toBeUndefined();
  });

  it("reports a failed move", async () => {
    service.queue("pipeline_stages", { data: { id: STAGE_ID, kind: "rejected" }, error: null });
    service.queue("applications", { data: null, error: null });
    service.queue("applications", { data: null, error: { message: "denied" } });
    expect(await rejectForKnockout(service.client, input)).toBe(false);
    expect(service.callsFor("application_events")).toHaveLength(0);
  });
});
