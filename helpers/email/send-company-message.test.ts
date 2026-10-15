import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "react-email";
import { sendEmail } from "@/utils/email";
import { sendCompanyMessage } from "./send-company-message";

vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("react-email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-email")>()),
  render: vi.fn(),
}));

const INPUT = {
  toEmail: "priya@example.com",
  subject: "Interview for Backend Engineer",
  bodyMd: "Hi Priya",
  companyName: "Acme",
  companyEmail: "hr@acme.dev",
  logoUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(render).mockImplementation(async (_el, options) =>
    options?.plainText ? "plain text" : "<p>html</p>",
  );
  vi.mocked(sendEmail).mockResolvedValue(undefined as never);
});

describe("sendCompanyMessage (PLT-062)", () => {
  it("sends both versions as the company via GetHired, replying to the company", async () => {
    expect(await sendCompanyMessage(INPUT)).toEqual({ ok: true });

    expect(sendEmail).toHaveBeenCalledWith({
      toEmail: "priya@example.com",
      subject: "Interview for Backend Engineer",
      htmlContent: "<p>html</p>",
      textContent: "plain text",
      senderName: "Acme via GetHired",
      replyTo: "hr@acme.dev",
    });
  });

  it("sends without reply-to when the company has no email", async () => {
    await sendCompanyMessage({ ...INPUT, companyEmail: null });

    expect(vi.mocked(sendEmail).mock.calls[0][0]).not.toHaveProperty("replyTo");
  });

  it("returns { ok: false } instead of throwing when sending fails", async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendCompanyMessage(INPUT)).toEqual({ ok: false, error: "Failed to send email" });
  });
});
