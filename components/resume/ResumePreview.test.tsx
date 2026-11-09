import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RESUME_TEMPLATES } from "@/helpers/resume/config";
import { buildResumeDocument, resumeDocumentText } from "@/helpers/resume/render/document";
import type { ResumeContact, ResumeContent } from "@/helpers/resume/resume-schema";
import ResumePreview from "./ResumePreview";

const CONTACT: ResumeContact = {
  fullName: "Ada Lovelace",
  headline: "Engineer",
  email: "ada@example.com",
  phone: "+91 98",
  location: "Pune",
  links: [{ label: "GitHub", url: "https://github.com/ada" }],
};

const CONTENT: ResumeContent = {
  version: 2,
  sections: [
    { id: "s1", type: "summary", items: [{ id: "i0", bullets: [{ id: "b0", text: "Builds billing systems." }] }] },
    {
      id: "s2",
      type: "experience",
      items: [
        {
          id: "i1",
          heading: "Staff Engineer",
          subheading: "Acme",
          location: "Remote",
          startDate: "2022",
          endDate: "Present",
          url: "https://acme.dev",
          bullets: [
            { id: "b1", text: "Built the billing API" },
            { id: "b2", text: "<script>alert(1)</script>" },
          ],
        },
      ],
    },
  ],
};

const documentFor = (template: (typeof RESUME_TEMPLATES)[number] = "classic", content = CONTENT, contact = CONTACT) =>
  buildResumeDocument({ contact, content, template });

describe("ResumePreview", () => {
  it.each(RESUME_TEMPLATES)("shows every field in %s", (template) => {
    const document = documentFor(template);
    const { container } = render(<ResumePreview document={document} />);

    for (const text of resumeDocumentText(document)) {
      expect(container.textContent).toContain(text);
    }
  });

  it("links the email and http(s) links, and opens them safely", () => {
    render(<ResumePreview document={documentFor()} />);

    expect(screen.getByRole("link", { name: "ada@example.com" })).toHaveAttribute("href", "mailto:ada@example.com");
    const link = screen.getByRole("link", { name: "acme.dev" });
    expect(link).toHaveAttribute("href", "https://acme.dev");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("marks only the active bullet", () => {
    render(<ResumePreview document={documentFor()} activeBulletId="b1" />);

    expect(screen.getByText("Built the billing API")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("Builds billing systems.")).not.toHaveAttribute("data-active");
  });

  it("marks a bullet in a summary too", () => {
    render(<ResumePreview document={documentFor()} activeBulletId="b0" />);

    expect(screen.getByText("Builds billing systems.")).toHaveAttribute("data-active", "true");
  });

  it("keeps scripts in text as text", () => {
    const { container } = render(<ResumePreview document={documentFor()} />);

    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("doesn't link what isn't http(s)", () => {
    const contact = { fullName: "A", links: [{ label: "x", url: "javascript:alert(1)" }] };
    render(<ResumePreview document={documentFor("classic", { version: 2, sections: [] }, contact)} />);

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says so when there's nothing to show", () => {
    render(<ResumePreview document={documentFor("classic", { version: 2, sections: [] }, { fullName: "", links: [] })} />);

    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });
});
