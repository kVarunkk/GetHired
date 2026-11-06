import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { loadApplicationFrame } from "@/helpers/applications/application-page";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import ApplicationResumePage from "./page";

const NOT_FOUND = new Error("NEXT_NOT_FOUND");

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
  unstable_rethrow: (err: unknown) => {
    if (err === NOT_FOUND) throw err;
  },
}));
vi.mock("@/helpers/applications/application-page", () => ({ loadApplicationFrame: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/components/Error", () => ({ default: () => <p>Error</p> }));
vi.mock("@/components/OriginalResumeWrapper", () => ({ default: ({ url }: { url: string }) => <p>PDF at {url}</p> }));
vi.mock("@/components/resume/ApplicationResumeDownload", () => ({ default: () => <button>Download</button> }));

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";

const SNAPSHOT = {
  name: "Backend",
  template: "classic",
  content: {
    version: 2,
    sections: [{ id: "s1", type: "skills", items: [{ id: "i1", bullets: [{ id: "b1", text: "Sent text" }] }] }],
  },
};

let db: SupabaseMock;
const createSignedUrl = vi.fn();
const signFromCompanyBucket = vi.fn();

const visit = async () =>
  render(await ApplicationResumePage({ params: Promise.resolve({ application_id: APPLICATION_ID }) }));

const frame = (person: Record<string, unknown>, application: Record<string, unknown> = {}) =>
  vi.mocked(loadApplicationFrame).mockResolvedValue({ supabase: db.client, person, application } as never);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://files.test/r.pdf" }, error: null });
  signFromCompanyBucket.mockResolvedValue({ data: { signedUrl: "https://files.test/company.pdf" }, error: null });
  Object.assign(db.client, { storage: { from: () => ({ createSignedUrl }) } });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    storage: { from: () => ({ createSignedUrl: signFromCompanyBucket }) },
  } as never);
});

describe("the application's resume page (RE-REQ-062)", () => {
  it("renders what was sent, with its contact details and a download, and signs nothing", async () => {
    frame({ kind: "user", name: "Ada" });
    db.queue("applications", {
      data: {
        resume_snapshot: SNAPSHOT,
        resume_contact_snapshot: { fullName: "Ada Lovelace", links: [] },
        resumes: { resume_path: "u/r.pdf", content: { sections: [] } },
      },
      error: null,
    });

    await visit();

    expect(screen.getByText("Sent text")).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveTextContent("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("shows the file for an older application", async () => {
    frame({ kind: "user", name: "Ada" });
    db.queue("applications", {
      data: { resume_snapshot: null, resumes: { resume_path: "u/r.pdf", content: {} } },
      error: null,
    });

    await visit();

    expect(screen.getByText("PDF at https://files.test/r.pdf")).toBeInTheDocument();
  });

  it("still shows an imported candidate's file", async () => {
    frame({ kind: "candidate", name: "Imported" }, { company_candidates: { resume_path: "c/cv.pdf" } });

    await visit();

    expect(db.callsFor("applications")).toHaveLength(0);
    expect(screen.getByText("PDF at https://files.test/company.pdf")).toBeInTheDocument();
  });

  it("says so when there's no resume", async () => {
    frame({ kind: "user", name: "Ada" });
    db.queue("applications", { data: { resume_snapshot: null, resumes: null }, error: null });

    await visit();

    expect(screen.getByText("No resume with this application.")).toBeInTheDocument();
  });
});
