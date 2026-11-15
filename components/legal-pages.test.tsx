import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PrivacyPolicy from "./PrivacyPolicy";
import TermsOfService from "./TermsOfService";
import Footer from "./landing-page/Footer";

// IVT-031 (IV-TASK-LEGAL): Google's OAuth reviewers read these pages.
const LIMITED_USE =
  "GetHired's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.";
const POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";

const normalize = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

describe("Privacy policy: Google Calendar (IVT-031)", () => {
  it("has the Limited Use statement word for word, linking the policy", () => {
    render(<PrivacyPolicy />);
    const section = screen.getByRole("region", { name: "4. Google Calendar" });
    const statement = within(section)
      .getAllByText((_, el) => el?.tagName === "P" && normalize(el.textContent).includes("Limited Use requirements"))
      .at(-1)!;
    expect(normalize(statement.textContent)).toBe(LIMITED_USE);
    expect(within(statement).getByRole("link", { name: "Google API Services User Data Policy" })).toHaveAttribute(
      "href",
      POLICY_URL,
    );
  });

  it("covers what, how, sharing, candidates, storage and retention", () => {
    render(<PrivacyPolicy />);
    const section = screen.getByRole("region", { name: "4. Google Calendar" });
    for (const heading of ["What we access", "How we use it", "Sharing", "Candidates", "Storage", "Retention and deletion"]) {
      expect(within(section).getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(normalize(section.textContent)).toContain("never read the titles");
    expect(normalize(section.textContent)).toContain("use it to train AI models");
    expect(screen.getByText("Last updated: November 14, 2026")).toBeInTheDocument();
  });
});

describe("Terms of service: Google Calendar (IVT-031)", () => {
  it("has the three points and links the privacy policy", () => {
    render(<TermsOfService />);
    const section = screen.getByRole("region", { name: "7. Google Calendar Integration" });
    const text = normalize(section.textContent);
    expect(text).toContain("Connecting a Google Calendar is optional");
    expect(text).toContain("responsible for the interviews they schedule and the attendees they invite");
    expect(text).toContain("Google's own terms apply to Google Calendar and Google Meet");
    expect(within(section).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy-policy");
    expect(screen.getByText("Last updated: November 14, 2026")).toBeInTheDocument();
  });
});

describe("Footer legal links", () => {
  it("still links both pages", () => {
    render(<Footer />);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(
      expect.arrayContaining(["/privacy-policy", "/terms-of-service"]),
    );
  });
});
