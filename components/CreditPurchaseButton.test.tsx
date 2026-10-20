import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import toast from "react-hot-toast";
import CreditPurchaseButton from "./CreditPurchaseButton";

vi.mock("react-hot-toast", () => ({
  default: { loading: vi.fn(), dismiss: vi.fn(), error: vi.fn() },
}));

const PLAN_ID = "9a000000-0000-4000-8000-000000000001";
const fetchMock = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function buy() {
  render(<CreditPurchaseButton planId={PLAN_ID} creditAmount={50} displayPrice="$ 5" />);
  fireEvent.click(screen.getByRole("button", { name: "Buy for $ 5" }));
}

describe("CreditPurchaseButton", () => {
  it("sends only the plan id and redirects to the checkout", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ checkoutUrl: "https://checkout.dodo.test/1" }), { status: 200 }),
    );

    buy();

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.dodo.test/1"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/dodo/create-checkout-session");
    expect(JSON.parse(init.body)).toEqual({ planId: PLAN_ID });
  });

  it("shows an error toast when the checkout can't be created", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Invalid plan." }), { status: 400 }));

    buy();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Purchase failed: Invalid plan."),
    );
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Buy for $ 5" })).not.toBeDisabled();
  });
});
