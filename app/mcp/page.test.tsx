/**
 * RMT-060: /mcp's "For hiring teams" section (RMCP spec §4.10). The toolset
 * lists come from RECRUITER_MCP_TOOLS, and the example URLs parse.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RECRUITER_APPROVAL_POLICY } from "@/helpers/agent/roles/recruiter/approval";
import { MCP_EMAIL_CALLS_PER_HOUR } from "@/helpers/mcp/config";
import { RECRUITER_MCP_TOOLS } from "@/helpers/mcp/recruiter-tools";
import { MCP_TOOLS, mcpToolFlags } from "@/helpers/mcp/tools";
import { ALL_MCP_TOOLSETS, parseToolsetParams } from "@/helpers/mcp/toolsets";
import McpDocsPage from "./page";

vi.mock("@/components/FootComponent", () => ({ default: () => null }));
vi.mock("@/components/landing-page/Footer", () => ({ default: () => null }));

const renderPage = () => render(<McpDocsPage />);
const toolsetBlock = (container: HTMLElement, toolset: string) =>
  container.querySelector<HTMLElement>(`[data-toolset="${toolset}"]`)!;

describe("/mcp for hiring teams", () => {
  it("lists every recruiter tool under its own toolset, and nowhere else", () => {
    const { container } = renderPage();

    for (const toolset of ALL_MCP_TOOLSETS) {
      const listed = within(toolsetBlock(container, toolset))
        .getAllByRole("listitem")
        .map((item) => item.querySelector("code")!.textContent);
      expect(listed, toolset).toEqual(
        RECRUITER_MCP_TOOLS.filter((tool) => tool.toolset === toolset).map((tool) => tool.name),
      );
    }
  });

  it("badges each recruiter tool from its flags", () => {
    const { container } = renderPage();

    for (const tool of RECRUITER_MCP_TOOLS) {
      const item = within(toolsetBlock(container, tool.toolset))
        .getAllByRole("listitem")
        .find((li) => li.querySelector("code")!.textContent === tool.name)!;
      const { confirm, credit } = mcpToolFlags(tool, RECRUITER_APPROVAL_POLICY);
      const badges = within(item).queryAllByText(/^(Read-only|Asks first|Credits|Emails)$/).map((b) => b.textContent);
      expect(badges, tool.name).toEqual(
        [
          tool.annotations.readOnlyHint && "Read-only",
          confirm && "Asks first",
          credit && "Credits",
          tool.email && "Emails",
        ].filter(Boolean),
      );
    }
  });

  it("shows example URLs that the server parses", () => {
    renderPage();

    const examples = screen
      .getAllByText(/^https:\/\/gethired\.devhub\.co\.in\/api\/mcp\?/)
      .map((node) => node.textContent!);
    expect(examples.length).toBeGreaterThanOrEqual(2);
    expect(examples).toContain("https://gethired.devhub.co.in/api/mcp?toolsets=jobs,applicants");
    expect(examples).toContain("https://gethired.devhub.co.in/api/mcp?readonly=true");
    for (const url of examples) expect(parseToolsetParams(new URL(url)), url).toMatchObject({ ok: true });
  });

  it("names the permission and the email limit, and still lists the applicant tools", () => {
    renderPage();

    expect(screen.getByText("Use GetHired from AI clients")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`limited to ${MCP_EMAIL_CALLS_PER_HOUR} calls an hour`))).toBeInTheDocument();
    for (const tool of MCP_TOOLS) expect(screen.getAllByText(tool.name).length).toBeGreaterThan(0);
  });
});
