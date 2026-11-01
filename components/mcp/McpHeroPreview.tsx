/**
 * The MCP landing pages' hero preview: a window with the server URL and each
 * client's setup on the left, and a sample Claude chat using GetHired's tools
 * on the right. Static: nothing here calls the server.
 */
import { ArrowUp, Check, KeyRound, ShieldCheck, Wrench } from "lucide-react";
import ClaudeIcon from "@/components/icons/ClaudeIcon";
import { HERO_ARTIFACT_SHADOW } from "@/components/landing-page/HeroBackdrop";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { McpAudience } from "@/helpers/marketing/content";
import { cn } from "@/utils/utils";
import CopyButton from "./CopyButton";
import { CodeBlock, MCP_CLIENTS, MCP_URL, McpClientIcon } from "./McpDocs";

const SHORT_NAMES: Record<(typeof MCP_CLIENTS)[number]["id"], string> = {
  claude: "Claude",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
};

type ToolStep = { name: string; title: string; asked?: boolean };
type ResultRow = { primary: string; secondary: string; tag: string };
type Demo = {
  prompt: string;
  tools: ToolStep[];
  intro: string;
  rows: ResultRow[];
  outro: string;
};

const DEMOS: Record<McpAudience, Demo> = {
  applicant: {
    prompt: "Find remote React roles that match my profile and save the best one.",
    tools: [
      { name: "get_relevant_jobs", title: "Jobs matched to me" },
      { name: "favorite_job", title: "Save or unsave a job" },
    ],
    intro: "Here are your strongest matches from GetHired:",
    rows: [
      { primary: "Senior Frontend Engineer", secondary: "Lumen Labs · Remote", tag: "94% match" },
      { primary: "Frontend Engineer, Payments", secondary: "Northwind Pay · Remote", tag: "91% match" },
      { primary: "React Developer", secondary: "Fieldnote · Remote, Pune", tag: "88% match" },
    ],
    outro: "I saved Senior Frontend Engineer at Lumen Labs. Want me to check your resume against it?",
  },
  company: {
    prompt: "Who are the strongest new applicants for Senior Backend Engineer? Move the top two to Interview.",
    tools: [
      { name: "list_applicants", title: "Applicants" },
      { name: "move_applications", title: "Move applications", asked: true },
    ],
    intro: "Your top applicants this week:",
    rows: [
      { primary: "Aarav M.", secondary: "Backend Engineer · 6 yrs · Go, Postgres", tag: "Interview" },
      { primary: "Sara K.", secondary: "Platform Engineer · 5 yrs · Node, AWS", tag: "Interview" },
      { primary: "Rohan D.", secondary: "Software Engineer · 4 yrs · Java", tag: "Applied" },
    ],
    outro: "Done. You approved the move, and Aarav and Sara are now in Interview.",
  },
};

function ConnectPane({ note }: { note: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-5 border-b p-4 sm:p-6 lg:col-span-2 lg:border-b-0 lg:border-r">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Server URL</span>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 py-1.5 pl-3 pr-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{MCP_URL}</code>
          <CopyButton value={MCP_URL} label="Copy server URL" />
        </div>
      </div>

      <Tabs defaultValue="claude" className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Add it to your client</span>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/60 sm:flex sm:flex-wrap sm:justify-start">
          {MCP_CLIENTS.map((client) => (
            <TabsTrigger key={client.id} value={client.id} className="min-w-0 gap-1.5 px-2.5 text-xs">
              <McpClientIcon id={client.id} className="h-3.5 w-3.5" />
              {SHORT_NAMES[client.id]}
            </TabsTrigger>
          ))}
        </TabsList>
        {MCP_CLIENTS.map((client) => (
          <TabsContent key={client.id} value={client.id} className="mt-1 flex min-w-0 flex-col gap-3">
            <p className="text-sm leading-6 text-muted-foreground">{client.steps}</p>
            {client.id !== "claude" && (
              <CodeBlock copyLabel={`Copy ${client.name} setup`}>{client.code}</CodeBlock>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <p className="mt-auto flex items-start gap-2 text-sm text-muted-foreground">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {note}
      </p>
    </div>
  );
}

function ToolCall({ step }: { step: ToolStep }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
      <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate font-mono text-[12px] font-medium sm:text-[13px]">{step.name}</span>
      <span className="hidden min-w-0 truncate text-muted-foreground md:inline">{step.title}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        {step.asked ? (
          <>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">You approved</span>
            <span className="sm:hidden">Approved</span>
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5" aria-hidden /> Done
          </>
        )}
      </span>
    </div>
  );
}

function ChatPane({ demo }: { demo: Demo }) {
  return (
    <div className="flex min-w-0 flex-col bg-muted/20 lg:col-span-3">
      <div className="flex h-12 items-center justify-between gap-2 border-b px-4 sm:px-5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ClaudeIcon />
          Claude
        </span>
        <span className="flex min-w-0 items-center gap-1.5 truncate rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          GetHired connected
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 text-sm sm:p-6">
        <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md border bg-background px-4 py-2.5 leading-6">
          {demo.prompt}
        </p>

        <div className="flex gap-2 sm:gap-3">
          <span className="mt-0.5 hidden h-7 w-7 shrink-0 sm:flex items-center justify-center rounded-full border bg-background">
            <ClaudeIcon className="h-3.5 w-3.5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              {demo.tools.map((step) => (
                <ToolCall key={step.name} step={step} />
              ))}
            </div>
            <p className="leading-6">{demo.intro}</p>
            <div className="divide-y overflow-hidden rounded-lg border bg-background">
              {demo.rows.map((row, i) => (
                <div key={row.primary} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.primary}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.secondary}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-xs",
                      i === 0 ? "border-foreground/20 font-medium" : "text-muted-foreground",
                    )}
                  >
                    {row.tag}
                  </span>
                </div>
              ))}
            </div>
            <p className="leading-6">{demo.outro}</p>
          </div>
        </div>

        <div className="mt-auto flex items-center gap-2 rounded-xl border bg-background py-2 pl-4 pr-2 text-muted-foreground">
          <span className="flex-1 truncate">Reply to Claude…</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}

export default function McpHeroPreview({ audience, note }: { audience: McpAudience; note: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-background text-left", HERO_ARTIFACT_SHADOW)}>
      <div className="flex h-10 items-center gap-1.5 border-b bg-muted/30 px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" aria-hidden />
        <span className="ml-3 min-w-0 truncate font-mono text-xs text-muted-foreground">gethired · remote MCP server</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5">
        <ConnectPane note={note} />
        <ChatPane demo={DEMOS[audience]} />
      </div>
    </div>
  );
}
