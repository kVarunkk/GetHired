import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "react-email";
import { sendEmail } from "@/utils/email";
import { sendApplicationStatusEmail } from "./send-application-status-email";

vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("react-email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-email")>()),
  render: vi.fn(),
}));

const INPUT = {
  toEmail: "ada@example.com",
  jobTitle: "Frontend Engineer",
  companyName: "Acme",
  status: "reviewed",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(render).mockImplementation(async (_el, options) =>
    options?.plainText ? "plain text" : "<p>html</p>",
  );
  vi.mocked(sendEmail).mockResolvedValue(undefined as never);
});

describe("sendApplicationStatusEmail", () => {
  it("sends the HTML and plain-text versions with the status subject", async () => {
    expect(await sendApplicationStatusEmail(INPUT)).toEqual({ ok: true });

    expect(render).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledWith({
      toEmail: "ada@example.com",
      subject: "Update: Your Application Status for Frontend Engineer at Acme",
      htmlContent: "<p>html</p>",
      textContent: "plain text",
    });
  });

  it("returns { ok: false } instead of throwing when sending fails", async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error("resend down"));

    expect(await sendApplicationStatusEmail(INPUT)).toEqual({ ok: false, error: expect.any(String) });
  });
});
