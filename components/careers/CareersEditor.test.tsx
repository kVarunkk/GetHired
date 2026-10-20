import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import toast from "react-hot-toast";
import { claimCareersSlugAction } from "@/app/actions/careers/claim-careers-slug";
import { saveCareersPageAction } from "@/app/actions/careers/save-careers-page";
import { setCareersPublishedAction } from "@/app/actions/careers/set-careers-published";
import type { CareersPage } from "@/helpers/careers/get-careers-page";
import type { CareersSearchView } from "@/helpers/careers/search-company-jobs";
import CareersEditor from "./CareersEditor";

vi.mock("@/app/actions/careers/claim-careers-slug", () => ({ claimCareersSlugAction: vi.fn() }));
vi.mock("@/app/actions/careers/save-careers-page", () => ({ saveCareersPageAction: vi.fn() }));
vi.mock("@/app/actions/careers/set-careers-published", () => ({ setCareersPublishedAction: vi.fn() }));
vi.mock("@/app/actions/careers/upload-careers-image", () => ({ uploadCareersImageAction: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace: vi.fn() }), usePathname: () => "/company/settings/careers" }));

// Radix's switch measures itself; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const PAGE: CareersPage = {
  id: "c0000000-0000-4000-8000-000000000001",
  slug: "acme",
  published: false,
  name: "Acme",
  tagLine: "We build rockets",
  description: "About Acme.",
  logoUrl: null,
  website: null,
  headquarters: null,
  companySize: null,
  industry: null,
  accentColor: null,
  coverUrl: null,
  sections: [{ id: "5c000000-0000-4000-8000-000000000001", kind: "about", hidden: false }],
  links: {},
};
const JOBS: CareersSearchView = {
  jobs: [],
  total: 0,
  page: 1,
  hasMore: false,
  departments: [],
  options: { locations: [], jobTypes: [], departments: [], workplaces: [] },
};

const open = (canEdit = true) =>
  render(<CareersEditor initial={PAGE} jobs={JOBS} canEdit={canEdit} forbidden="Your role can't edit the careers page." />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveCareersPageAction).mockResolvedValue({ ok: true });
  vi.mocked(setCareersPublishedAction).mockResolvedValue({ ok: true });
  vi.mocked(claimCareersSlugAction).mockResolvedValue({ ok: true, slug: "acme-careers" });
});

describe("CareersEditor (CP-REQ-012, CPT-052)", () => {
  it("saves the branding, sections and links", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Accent colour"), { target: { value: "#0F766E" } });
    fireEvent.click(screen.getByRole("button", { name: "Custom section" }));
    const custom = screen.getByRole("group", { name: "Custom section section" });
    fireEvent.change(within(custom).getByLabelText("Title"), { target: { value: "Our values" } });
    fireEvent.change(within(custom).getByLabelText("Text (markdown)"), { target: { value: "**Ship** it." } });
    fireEvent.change(screen.getByLabelText("LinkedIn"), { target: { value: "https://linkedin.com/company/acme" } });

    fireEvent.click(screen.getByRole("button", { name: "Save careers page" }));

    await waitFor(() => expect(saveCareersPageAction).toHaveBeenCalled());
    const input = vi.mocked(saveCareersPageAction).mock.calls[0][0];
    expect(input).toMatchObject({ accentColor: "#0f766e", coverUrl: null, links: { linkedin: "https://linkedin.com/company/acme" } });
    expect(input.sections.map((s) => s.kind)).toEqual(["about", "custom"]);
    expect(input.sections[1]).toMatchObject({ title: "Our values", body: "**Ship** it." });
    expect(toast.success).toHaveBeenCalledWith("Careers page saved.");
  });

  it("explains an unreadable accent and won't save it (CP-REQ-009)", () => {
    open();
    fireEvent.change(screen.getByLabelText("Accent colour"), { target: { value: "#fde047" } });
    expect(screen.getByText(/too light to read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save careers page" })).toBeDisabled();
  });

  it("changes the address", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "acme-careers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(claimCareersSlugAction).toHaveBeenCalledWith({ slug: "acme-careers" }));
    expect(await screen.findByDisplayValue("acme-careers")).toBeInTheDocument();
  });

  it("shows why an address is invalid", () => {
    open();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "jobs" } });
    expect(screen.getByText("That address is reserved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save address" })).toBeDisabled();
  });

  it("publishes", async () => {
    open();
    expect(screen.getByText("Not published")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Published" }));
    await waitFor(() => expect(setCareersPublishedAction).toHaveBeenCalledWith({ published: true }));
    expect(await screen.findByText("Published", { selector: "div,span" })).toBeInTheDocument();
  });

  it("hides and reorders sections, and previews the draft", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Perks" }));
    const perks = screen.getByRole("group", { name: "Perks section" });
    fireEvent.click(within(perks).getByRole("button", { name: "Add perk" }));
    fireEvent.change(within(perks).getByLabelText("Perk 1 title"), { target: { value: "Remote" } });
    fireEvent.click(within(perks).getByRole("button", { name: "Move up" }));

    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByText("Remote")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "About section" })).getByRole("button", { name: "Hide" }));
    expect(within(preview).queryByText("About Acme.")).not.toBeInTheDocument();
  });

  it("is read-only without careers.edit, with the reason", () => {
    open(false);
    expect(screen.getByText("Your role can't edit the careers page.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save careers page" })).toBeDisabled();
    expect(screen.getByLabelText("Address")).toBeDisabled();
  });
});
