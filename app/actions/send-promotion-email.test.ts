import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { sendPromotionEmails } from "./send-promotion-email";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("react-email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-email")>()),
  render: vi.fn().mockResolvedValue("<p>promo</p>"),
}));

const PROMO = {
  title: "New feature",
  content: "It is great.",
  ctaLink: "https://gethired.devhub.co.in/jobs",
  ctaLabel: "See it",
};

const ADMIN_ID = "ad000000-0000-4000-8000-000000000001";

let service: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  service.queue("user_info", {
    data: [{ user_id: "u1", email: "ada@example.com", full_name: "Ada" }],
    error: null,
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendPromotionEmails", () => {
  it.each<[string, User | null]>([
    ["no user", null],
    ["an applicant", mockUser({ type: "applicant" })],
    ["a company user", COMPANY_A.user],
  ])("refuses %s and sends nothing", async (_, user) => {
    await setRequestUser(user);

    expect(await sendPromotionEmails(PROMO)).toMatchObject({ success: false, count: 0 });
    expect(service.calls).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("allows a user whose app_metadata role is admin", async () => {
    const admin = mockUser({ id: ADMIN_ID });
    admin.app_metadata.role = "admin";
    await setRequestUser(admin);

    expect(await sendPromotionEmails(PROMO)).toEqual({ success: true, count: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("allows a user listed in ADMIN_USER_IDS", async () => {
    vi.stubEnv("ADMIN_USER_IDS", `someone-else, ${ADMIN_ID}`);
    await setRequestUser(mockUser({ id: ADMIN_ID }));

    expect(await sendPromotionEmails(PROMO)).toEqual({ success: true, count: 1 });
  });
});
