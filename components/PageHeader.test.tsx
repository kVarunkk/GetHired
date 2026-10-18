import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PageHeader, { BackLink } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the title, description, eyebrow and actions", () => {
    render(
      <PageHeader
        title="Outreach"
        description="Messages to candidates."
        eyebrow="To Ada"
        actions={<button type="button">Find candidates</button>}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Outreach" })).toBeInTheDocument();
    expect(screen.getByText("Messages to candidates.")).toBeInTheDocument();
    expect(screen.getByText("To Ada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find candidates" })).toBeInTheDocument();
  });

  it("has no back link without backHref", () => {
    render(<PageHeader title="Job posts" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders an icon-only back link with an aria-label", () => {
    render(<PageHeader title="Frontend role" backHref="/company/outreach" backLabel="Back to outreach" />);

    const link = screen.getByRole("link", { name: "Back to outreach" });
    expect(link).toHaveAttribute("href", "/company/outreach");
    expect(link).toHaveTextContent("");
  });

  it("labels the back link 'Back' by default", () => {
    render(<PageHeader title="Role" backHref="/company/settings/roles" />);

    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/company/settings/roles");
  });

  it("exports the same back link for views with their own header", () => {
    render(<BackLink href="/interview" label="Back to interviews" />);

    const link = screen.getByRole("link", { name: "Back to interviews" });
    expect(link).toHaveAttribute("href", "/interview");
    expect(link).toHaveTextContent("");
  });
});
