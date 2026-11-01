/**
 * The dashboard's MCP card, which replaced the API keys card: the server URL
 * with a copy button and a link to the setup guide, and no mention of keys
 * to create.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MCP_SERVER_URL } from "@/helpers/marketing/content";
import McpConnectCard from "./McpConnectCard";

describe("McpConnectCard", () => {
  it("shows the server URL and links to the setup guide", () => {
    render(<McpConnectCard />);

    expect(screen.getByText(MCP_SERVER_URL)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /setup guide/i })).toHaveAttribute("href", "/mcp");
    expect(screen.queryByText(/view api keys|api keys created/i)).not.toBeInTheDocument();
  });

  it("copies the server URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<McpConnectCard />);

    fireEvent.click(screen.getByRole("button", { name: "Copy server URL" }));

    expect(writeText).toHaveBeenCalledWith(MCP_SERVER_URL);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
  });
});
