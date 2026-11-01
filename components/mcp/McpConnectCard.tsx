import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import CopyButton from "./CopyButton";
import { MCP_CLIENTS, MCP_URL, McpClientIcon } from "./McpDocs";

/**
 * The dashboard's "connect an AI assistant" card. It replaces the old API
 * keys card: the server URL to paste, the clients it works with, and a link
 * to the full setup guide at /mcp. Sign-in is OAuth, so there's nothing to
 * create or copy besides the URL.
 */
export default function McpConnectCard() {
  return (
    <Card className="flex flex-col p-4">
      <CardContent className="flex h-full flex-1 flex-col justify-between gap-4 p-0 text-start">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Use GetHired from your AI assistant</h2>
            <div className="flex items-center gap-1.5" aria-label="Works with">
              {MCP_CLIENTS.filter((client) => client.id !== "claude-code").map((client) => (
                <McpClientIcon key={client.id} id={client.id} className="h-4 w-4" />
              ))}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Add this server in Claude, Cursor or VS Code and sign in with your GetHired account.
            No API keys needed.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1 pl-3 pr-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs" title={MCP_URL}>
            {MCP_URL}
          </code>
          <CopyButton value={MCP_URL} label="Copy server URL" />
        </div>

        <Button asChild variant="outline">
          <Link href="/mcp">
            Setup guide
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
