import Link from "next/link";
import ClaudeIcon from "@/components/icons/ClaudeIcon";
import { cn } from "@/utils/utils";

/** The dashboards' pointer to connecting an AI assistant over MCP. */
export default function McpConnectLink({ className }: { className?: string }) {
  return (
    <Link
      className={cn("flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground", className)}
      href="/mcp"
    >
      <ClaudeIcon />
      Use GetHired in Claude, Cursor or VS Code
    </Link>
  );
}
