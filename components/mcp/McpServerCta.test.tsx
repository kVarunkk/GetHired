import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import McpServerCta, { mcpAudienceFor } from "./McpServerCta";

const link = () => screen.getByRole("link", { name: /connect your assistant/i });

describe("McpServerCta", () => {
  beforeEach(() => {
    pathname.current = "/";
  });

  it("links job seekers to /mcp-server", () => {
    pathname.current = "/jobs";
    render(<McpServerCta />);
    expect(link()).toHaveAttribute("href", "/mcp-server");
  });

  it("links company pages to /mcp-server/companies", () => {
    for (const path of ["/hire", "/pricing/companies", "/company/job-posts"]) {
      expect(mcpAudienceFor(path)).toBe("company");
    }
    pathname.current = "/hire";
    render(<McpServerCta />);
    expect(link()).toHaveAttribute("href", "/mcp-server/companies");
  });

  it("does not treat look-alike paths as company pages", () => {
    expect(mcpAudienceFor("/companies/acme")).toBe("applicant");
    expect(mcpAudienceFor("/hired")).toBe("applicant");
  });

  it("lets the audience prop override the path", () => {
    pathname.current = "/";
    render(<McpServerCta audience="company" />);
    expect(link()).toHaveAttribute("href", "/mcp-server/companies");
  });

  it("renders nothing on the MCP pages", () => {
    for (const path of ["/mcp", "/mcp-server", "/mcp-server/companies"]) {
      pathname.current = path;
      const { container, unmount } = render(<McpServerCta />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
