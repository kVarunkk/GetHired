import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ENTITLEMENT_KEYS, type EntitlementKey, type EntitlementState } from "@/helpers/billing/keys";
import type { CompanyEntitlements } from "@/helpers/billing/entitlements";
import { PUBLIC_TIERS, TIER_FREE, TIER_GROWTH, TIER_STARTUP, entitlementsOf, type TierFixture } from "@/test/utils/billing";
import type { Plan } from "@/helpers/billing/plans";
import { resumeCompanyPlanAction } from "@/app/actions/resume-company-plan";
import { changeCompanyPlanAction } from "@/app/actions/change-company-plan";
import { cancelCompanyPlanAction } from "@/app/actions/cancel-company-plan";
import BillingOverview from "./BillingOverview";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/actions/change-company-plan", () => ({ changeCompanyPlanAction: vi.fn() }));
vi.mock("@/app/actions/cancel-company-plan", () => ({ cancelCompanyPlanAction: vi.fn() }));
vi.mock("@/app/actions/resume-company-plan", () => ({ resumeCompanyPlanAction: vi.fn() }));
vi.mock("@/app/actions/open-billing-portal", () => ({ openBillingPortalAction: vi.fn() }));

function billingOf(
  tier = TIER_FREE,
  used: Partial<Record<EntitlementKey, number>> = {},
  overrides: Partial<CompanyEntitlements> = {},
): CompanyEntitlements {
  const raw = entitlementsOf(tier, used, { creditBalance: 120 });
  return {
    tier: { id: tier.id, slug: tier.slug, name: tier.name },
    subscribedTierSlug: tier.slug,
    status: "active",
    billingInterval: null,
    currency: null,
    period: { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" },
    renewsAt: "2026-11-14T00:00:00Z",
    cancelAtPeriodEnd: false,
    scheduledTierSlug: null,
    graceUntil: null,
    manualUntil: null,
    hasPaidSubscription: false,
    hasBillingPortal: false,
    entitlements: Object.fromEntries(
      ENTITLEMENT_KEYS.map((k) => {
        const e = raw.entitlements[k];
        return [k, { ...e, overageCredits: e.overage_credits } as EntitlementState];
      }),
    ) as CompanyEntitlements["entitlements"],
    creditBalance: 120,
    creditLots: [{ id: "l1", remaining: 120, expiresAt: "2027-10-01T00:00:00Z", reason: "purchase", createdAt: "2026-10-01" }],
    ...overrides,
  };
}

const show = (billing: CompanyEntitlements) =>
  render(<BillingOverview billing={billing} plans={[]} packs={[]} history={[]} />);

beforeEach(() => vi.clearAllMocks());

describe("BillingOverview (BL-REQ-010, BL-TEST-005)", () => {
  it("shows the plan, status and when usage resets", () => {
    show(billingOf());
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/Usage resets on November 1, 2026/)).toBeInTheDocument();
  });

  it("shows a usage line per key, with ∞ for unlimited", () => {
    show(billingOf(TIER_STARTUP, { screenings: 12 }));
    expect(screen.getByTestId("usage-screenings")).toHaveTextContent("12 of 500");
    expect(screen.getByTestId("usage-profiles_per_search")).toHaveTextContent("∞");
    for (const key of ENTITLEMENT_KEYS) expect(screen.getByTestId(`usage-${key}`)).toBeInTheDocument();
  });

  it("shows a frozen over-limit state after a downgrade (BL-REQ-014)", () => {
    show(billingOf(TIER_FREE, { active_job_posts: 3 }));
    expect(screen.getByText(/3 of 2 active job posts: close one to publish more/)).toBeInTheDocument();
  });

  it("lists credit lots with their expiry", () => {
    show(billingOf());
    const lots = screen.getByRole("list", { name: "Credit lots" });
    expect(within(lots).getByText("120 credits")).toBeInTheDocument();
    expect(within(lots).getByText("Expires October 1, 2027")).toBeInTheDocument();
  });

  it("shows 'Cancels on' with a Resume button", async () => {
    vi.mocked(resumeCompanyPlanAction).mockResolvedValue({ ok: true });
    show(billingOf(TIER_STARTUP, {}, { hasPaidSubscription: true, cancelAtPeriodEnd: true }));

    expect(screen.getByText(/Cancels on November 14, 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(resumeCompanyPlanAction).toHaveBeenCalled();
  });

  it("shows the past-due banner during grace", () => {
    show(billingOf(TIER_STARTUP, {}, { status: "past_due", graceUntil: "2026-10-21T00:00:00Z" }));
    expect(screen.getByRole("alert")).toHaveTextContent("until October 21, 2026");
  });

  it("shows a manual plan's end date", () => {
    show(billingOf(TIER_STARTUP, {}, { manualUntil: "2027-01-14T00:00:00Z" }));
    expect(screen.getByText(/Until January 14, 2027/)).toBeInTheDocument();
  });
});

const PRICES: Record<string, Plan["prices"]> = {
  startup: [{ interval: "month", currency: "USD", amount_minor: 4900, dodo_product_id: "pdt_s" }],
  growth: [{ interval: "month", currency: "USD", amount_minor: 14900, dodo_product_id: "pdt_g" }],
};
const asPlan = (t: TierFixture): Plan => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  description: null,
  features: [],
  sort: t.sort,
  prices: PRICES[t.slug] ?? [],
  entitlements: Object.fromEntries(
    t.entitlements.map((e) => [e.key, { kind: e.kind, amount: e.amount, overageCredits: e.overage_credits }]),
  ),
});
const PLANS = PUBLIC_TIERS.map(asPlan);

describe("BillingOverview: confirming plan changes", () => {
  const paid = (tier: TierFixture) =>
    billingOf(tier, {}, { hasPaidSubscription: true, billingInterval: "month", currency: "USD" });
  const showWithPlans = (billing: CompanyEntitlements) =>
    render(<BillingOverview billing={billing} plans={PLANS} packs={[]} history={[]} />);
  const choose = (name: string) =>
    fireEvent.click(within(screen.getByRole("listitem", { name })).getByRole("button", { name: `Choose ${name}` }));

  it("asks before an upgrade and changes nothing until confirmed", async () => {
    vi.mocked(changeCompanyPlanAction).mockResolvedValue({ ok: true, scheduled: false });
    showWithPlans(paid(TIER_STARTUP));

    choose("Growth");

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Switch to Growth now?")).toBeInTheDocument();
    expect(within(dialog).getByText(/prorated difference.*then \$149 \/ month from November 14, 2026/)).toBeInTheDocument();
    expect(changeCompanyPlanAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Switch to Growth" }));
    expect(changeCompanyPlanAction).toHaveBeenCalledWith({ tierSlug: "growth" });
  });

  it("stays open while the change runs, then closes", async () => {
    let finish!: (v: { ok: true; scheduled: boolean }) => void;
    vi.mocked(changeCompanyPlanAction).mockReturnValue(new Promise((r) => (finish = r)));
    showWithPlans(paid(TIER_STARTUP));

    choose("Growth");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch to Growth" }));

    const working = await within(dialog).findByRole("button", { name: "Working…" });
    expect(working).toBeDisabled();
    expect(within(dialog).getByText("Switch to Growth now?")).toBeInTheDocument();

    finish({ ok: true, scheduled: false });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("explains a downgrade happens at renewal", async () => {
    showWithPlans(paid(TIER_GROWTH));

    choose("Startup");

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Switch to Startup on November 14, 2026?")).toBeInTheDocument();
    expect(within(dialog).getByText(/You keep Growth until November 14, 2026/)).toBeInTheDocument();
  });

  it("does nothing when the user keeps their plan", async () => {
    showWithPlans(paid(TIER_STARTUP));

    choose("Growth");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Keep my plan" }));

    expect(changeCompanyPlanAction).not.toHaveBeenCalled();
  });

  it("asks before cancelling", async () => {
    vi.mocked(cancelCompanyPlanAction).mockResolvedValue({ ok: true, endsAt: "2026-11-14T00:00:00Z" });
    showWithPlans(paid(TIER_STARTUP));

    fireEvent.click(screen.getByRole("button", { name: "Cancel plan" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/stays active until November 14, 2026/)).toBeInTheDocument();
    expect(cancelCompanyPlanAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    expect(cancelCompanyPlanAction).toHaveBeenCalled();
  });

  it("sends a company without a subscription straight to checkout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "x" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    showWithPlans(billingOf(TIER_FREE));

    choose("Startup");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ kind: "subscription", tierSlug: "startup" });
    vi.unstubAllGlobals();
  });

  describe("read-only for billing.view (RP-DEC-003) and member usage (RP-REQ-044)", () => {
    const paid = () => billingOf(TIER_STARTUP, {}, { hasPaidSubscription: true, hasBillingPortal: true });
    const PACK = { id: "p1", name: "Pack", description: null, credit_amount: 500, amount: 20, currency: "USD", product_id: "prod" };

    it("hides every billing action from a non-owner and says who can manage it", () => {
      render(
        <BillingOverview billing={paid()} plans={PLANS} packs={[PACK]} history={[]} canManage={false} />,
      );

      expect(screen.getByText("Only the company's owners can manage billing.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Payment method/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel plan" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Plans" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Usage this month" })).toBeInTheDocument();
    });

    it("shows owners the actions", () => {
      render(<BillingOverview billing={paid()} plans={[]} packs={[PACK]} history={[]} />);
      expect(screen.getByRole("button", { name: "Cancel plan" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
    });

    it("shows usage by member when there is some", () => {
      const rows = [{ userId: "u2", name: "Rita", isOwner: false, roleName: "Recruiter", usage: { outreach: 4 }, limits: { outreach: 50 } }];
      render(<BillingOverview billing={billingOf()} plans={[]} packs={[]} history={[]} memberUsage={rows} />);
      expect(screen.getByRole("heading", { name: "Usage by member" })).toBeInTheDocument();
      expect(screen.getByTestId("member-usage-u2-outreach")).toHaveTextContent("4 of 50");
    });

    it("leaves the member table out when it couldn't be read", () => {
      show(billingOf());
      expect(screen.queryByRole("heading", { name: "Usage by member" })).not.toBeInTheDocument();
    });
  });
});
