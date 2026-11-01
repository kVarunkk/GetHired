/**
 * The two MCP landing pages: each shows the server URL, its own audience's
 * capabilities and every tool in that audience's catalog, and links across.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LANDING_PAGES, MCP_CAPABILITIES, MCP_SERVER_URL } from "@/helpers/marketing/content";
import { RECRUITER_MCP_TOOLS } from "@/helpers/mcp/recruiter-tools";
import { MCP_TOOLS } from "@/helpers/mcp/tools";
import McpLandingPage from "./McpLandingPage";

vi.mock("@/components/FootComponent", () => ({ default: () => null }));
vi.mock("@/components/landing-page/Footer", () => ({ default: () => null }));
vi.mock("@/components/landing-page/FAQSection", () => ({ default: () => null }));
vi.mock("@/components/landing-page/HowWeHelp", () => ({
  HowWeHelp: ({ audience }: { audience: string }) => <div data-testid="how-we-help" data-audience={audience} />,
}));

const applicantPage = { ...LANDING_PAGES["mcp-server"], mcp: "applicant" as const };
const companyPage = { ...LANDING_PAGES["mcp-server-companies"], mcp: "company" as const };

const toolNames = () => [...document.querySelectorAll("li > code")].map((code) => code.textContent);

describe("MCP landing pages", () => {
  it("shows job seekers the server URL, their capabilities and every applicant tool", () => {
    render(<McpLandingPage page={applicantPage} jobCount={1234} />);

    expect(screen.getAllByText(MCP_SERVER_URL).length).toBeGreaterThan(0);
    for (const item of MCP_CAPABILITIES.applicant.items) expect(screen.getByRole("heading", { name: item.name })).toBeInTheDocument();
    expect(toolNames()).toEqual(MCP_TOOLS.map((tool) => tool.name));
    expect(screen.getByRole("link", { name: "The MCP server for hiring teams" })).toHaveAttribute(
      "href",
      "/mcp-server/companies",
    );
    expect(screen.getByTestId("how-we-help")).toHaveAttribute("data-audience", "applicant");
  });

  it("shows hiring teams their capabilities, the permission and every recruiter tool", () => {
    render(<McpLandingPage page={companyPage} jobCount={0} />);

    expect(screen.getAllByText(MCP_SERVER_URL).length).toBeGreaterThan(0);
    for (const item of MCP_CAPABILITIES.company.items) expect(screen.getByRole("heading", { name: item.name })).toBeInTheDocument();
    expect(screen.getByText("Use GetHired from AI clients")).toBeInTheDocument();
    expect([...toolNames()].sort()).toEqual(RECRUITER_MCP_TOOLS.map((tool) => tool.name).sort());
    expect(screen.queryByText("search_jobs")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The MCP server for job seekers" })).toHaveAttribute("href", "/mcp-server");
    expect(screen.getByTestId("how-we-help")).toHaveAttribute("data-audience", "hire");
  });

  it("never links to the retired GitHub server", () => {
    const { container } = render(<McpLandingPage page={applicantPage} jobCount={1} />);
    expect(container.innerHTML).not.toMatch(/github\.com|onrender\.com/);
  });
});
