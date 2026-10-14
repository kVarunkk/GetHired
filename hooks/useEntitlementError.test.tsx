import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { useEntitlementError } from "./useEntitlementError";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

const PAYLOAD = {
  key: "active_job_posts",
  kind: "limit",
  qty: 1,
  used: 2,
  amount: 2,
  overageCredits: null,
  creditBalance: 0,
  creditsNeeded: 0,
  reason: "limit_reached",
  suggestedTier: { slug: "startup", name: "Startup" },
};

function Harness({ result }: { result: unknown }) {
  const { handle, dialog } = useEntitlementError();
  return (
    <>
      <button onClick={() => void handle(result)}>go</button>
      {dialog}
    </>
  );
}

describe("useEntitlementError", () => {
  it("handles a server action entitlement error and opens the dialog", async () => {
    const { result } = renderHook(() => useEntitlementError());
    let handled = false;
    await act(async () => {
      handled = await result.current.handle({ success: false, error: { code: "entitlement", message: "x", ...PAYLOAD } });
    });
    expect(handled).toBe(true);

    render(<Harness result={{ error: { code: "entitlement", message: "x", ...PAYLOAD } }} />);
    await act(async () => screen.getByRole("button", { name: "go" }).click());
    expect(await screen.findByText(/reached your plan's limit/)).toBeInTheDocument();
  });

  it("handles a 402 response", async () => {
    const { result } = renderHook(() => useEntitlementError());
    const res = new Response(JSON.stringify({ code: "entitlement", error: "x", ...PAYLOAD }), { status: 402 });
    let handled = false;
    await act(async () => {
      handled = await result.current.handle(res);
    });
    expect(handled).toBe(true);
  });

  it("returns false for anything else", async () => {
    const { result } = renderHook(() => useEntitlementError());
    expect(await result.current.handle({ success: false, error: "Job posting not found." })).toBe(false);
    expect(await result.current.handle(new Response("{}", { status: 500 }))).toBe(false);
    expect(await result.current.handle(new Response(JSON.stringify({ error: "x" }), { status: 402 }))).toBe(false);
    expect(await result.current.handle(null)).toBe(false);
  });
});
