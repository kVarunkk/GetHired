import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
vi.mock("@/lib/posthog/client", () => ({ default: { capture: vi.fn() } }));

import posthog from "@/lib/posthog/client";
import { readSourceTag } from "@/helpers/distribution/source-tag";
import JobAlertClickTracker from "./JobAlertClickTracker";

beforeEach(() => vi.clearAllMocks());

describe("JobAlertClickTracker (JAT-045)", () => {
  it("fires once for ref=job_alert, with the alert id", () => {
    query = "ref=job_alert&aid=a1";
    const { rerender } = render(<JobAlertClickTracker page="job" />);
    rerender(<JobAlertClickTracker page="job" />);
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith("job_alert_clicked", { alert_id: "a1", page: "job" });
  });

  it("does nothing without the ref", () => {
    query = "src=jooble&aid=a1";
    render(<JobAlertClickTracker page="jobs" />);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("is not a distribution tag, so source_detail stays unset", () => {
    expect(readSourceTag(new URLSearchParams("ref=job_alert&aid=a1"))).toBeNull();
  });
});
