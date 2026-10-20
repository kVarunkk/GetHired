import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { notFound, permanentRedirect } from "next/navigation";
import { getCareersJobs, getCareersPage, type CareersPage } from "@/helpers/careers/get-careers-page";
import type { CareersJob } from "@/helpers/careers/search-company-jobs";
import CareersPageRoute, { generateMetadata } from "./page";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/careers/get-careers-page", () => ({ getCareersPage: vi.fn(), getCareersJobs: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_")) throw err;
  },
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/careers/acme",
}));

const PAGE: CareersPage = {
  id: "c0000000-0000-4000-8000-000000000001",
  slug: "acme",
  published: true,
  name: "Acme",
  tagLine: "We build rockets",
  description: "We make <b>rockets</b> and **engines**.",
  logoUrl: null,
  website: "https://acme.dev",
  headquarters: "Bengaluru",
  companySize: "11-50",
  industry: "Aerospace",
  accentColor: "#0f766e",
  coverUrl: null,
  sections: [
    { id: "5c000000-0000-4000-8000-000000000001", kind: "about", hidden: false },
    { id: "5c000000-0000-4000-8000-000000000002", kind: "perks", title: "Why join us", hidden: false, items: [{ title: "Remote", text: "Anywhere." }] },
    { id: "5c000000-0000-4000-8000-000000000003", kind: "custom", title: "Secret plans", body: "Hidden.", hidden: true },
  ],
  links: { linkedin: "https://linkedin.com/company/acme" },
};

const job = (n: number, overrides: Partial<CareersJob> = {}): CareersJob => ({
  id: `b0000000-0000-4000-8000-00000000000${n}`,
  allJobsId: `d0000000-0000-4000-8000-00000000000${n}`,
  title: `Role ${n}`,
  description: "",
  locations: ["bengaluru"],
  jobType: "Fulltime",
  department: "Engineering",
  workplaceType: "remote",
  salaryCurrency: null,
  salaryRange: null,
  minSalary: null,
  maxSalary: null,
  minExperience: null,
  maxExperience: null,
  experience: null,
  createdAt: `2026-10-0${n}T00:00:00Z`,
  ...overrides,
});

const show = async (slug = "acme", searchParams: Record<string, string> = {}) =>
  render(await CareersPageRoute({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(searchParams) }));

beforeEach(() => {
  vi.mocked(getCareersPage).mockResolvedValue({ page: PAGE });
  vi.mocked(getCareersJobs).mockResolvedValue([job(1, { title: "Backend Engineer" }), job(2, { title: "Designer", department: "Design" })]);
});

describe("/careers/[slug] (CPT-045)", () => {
  it("shows the header, the visible sections and the jobs, in the company's accent", async () => {
    const { container } = await show();

    expect(screen.getByRole("heading", { level: 1, name: "Careers at Acme" })).toBeInTheDocument();
    expect(screen.getByText("We build rockets")).toBeInTheDocument();
    expect(screen.getByText("Aerospace")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /LinkedIn/ })).toHaveAttribute("rel", "nofollow noopener noreferrer");
    expect(screen.getByRole("heading", { name: "Why join us" })).toBeInTheDocument();
    expect(screen.queryByText("Secret plans")).not.toBeInTheDocument();
    expect((container.querySelector("[data-careers-page]") as HTMLElement).style.getPropertyValue("--careers-accent")).toBe("#0f766e");
    expect(screen.getByText("Powered by")).toBeInTheDocument();
  });

  it("renders markdown without raw HTML (CP-SEC-002)", async () => {
    const { container } = await show();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("engines");
  });

  it("groups jobs by department and links them inside the careers page, keeping ?ref", async () => {
    await show("acme", { ref: "LinkedIn" });

    const engineering = screen.getByRole("list", { name: "Engineering" });
    const link = within(engineering).getByRole("link", { name: /Backend Engineer/ });
    expect(link).toHaveAttribute("href", "/careers/acme/jobs/d0000000-0000-4000-8000-000000000001?ref=linkedin");
    expect(screen.getByRole("list", { name: "Design" })).toBeInTheDocument();
  });

  it("applies the URL's filters on the server", async () => {
    await show("acme", { department: "Design" });
    expect(screen.queryByRole("link", { name: /Backend Engineer/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 role")).toBeInTheDocument();
  });

  it("is a 404 for unpublished or unknown pages", async () => {
    vi.mocked(getCareersPage).mockResolvedValue(null);
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("redirects a retired slug, keeping the query (CP-REQ-002)", async () => {
    vi.mocked(getCareersPage).mockResolvedValue({ redirect: "acme-careers" });
    await expect(show("acme", { ref: "x" })).rejects.toThrow("NEXT_REDIRECT /careers/acme-careers?ref=x");
    expect(permanentRedirect).toHaveBeenCalled();
  });

  it("has the Organization JSON-LD and the page metadata (CP-REQ-011)", async () => {
    const { container } = await show();
    const ld = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(ld).toMatchObject({ "@type": "Organization", name: "Acme" });

    const meta = await generateMetadata({ params: Promise.resolve({ slug: "acme" }) });
    expect(meta.title).toBe("Careers at Acme");
    expect(meta.alternates?.canonical).toBe("https://gethired.devhub.co.in/careers/acme");
  });
});
