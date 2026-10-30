import type { Metadata } from "next";
import Link from "next/link";
import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { MCP_TOOLS, mcpToolFlags, type McpToolDef } from "@/helpers/mcp/tools";
import { APPLICANT_APPROVAL_POLICY, type ToolApprovalPolicy } from "@/helpers/agent/approval";
import { RECRUITER_APPROVAL_POLICY } from "@/helpers/agent/roles/recruiter/approval";
import { PERMISSION_CATALOG } from "@/helpers/companies/permissions";
import { RECRUITER_MCP_TOOLS } from "@/helpers/mcp/recruiter-tools";
import { ALL_MCP_TOOLSETS, MCP_TOOLSET_LABELS, mcpToolsetUrl } from "@/helpers/mcp/toolsets";
import {
  MCP_CALLS_PER_MINUTE,
  MCP_CONFIRMATION_TTL_SECONDS,
  MCP_CREDIT_CALLS_PER_HOUR,
  MCP_EMAIL_CALLS_PER_HOUR,
  MCP_PATH,
} from "@/helpers/mcp/config";

/** The production URL, whatever environment renders this page. */
const MCP_URL = `https://gethired.devhub.co.in${MCP_PATH}`;

export const metadata: Metadata = {
  title: "Connect an MCP client",
  description:
    "Use GetHired from Claude, Cursor, VS Code or any other MCP client: search jobs, apply, and manage your resumes, reviews and mock interviews, or run your hiring team's jobs, pipeline and candidates.",
  alternates: { canonical: "/mcp" },
};

export const dynamic = "force-static";

const CLIENTS: { name: string; steps: string; code?: string }[] = [
  {
    name: "Claude (web and desktop)",
    steps:
      "Open Settings → Connectors → Add custom connector, paste the URL and choose Connect. Sign in to GetHired and approve the request.",
  },
  {
    name: "Claude Code",
    steps: "Add the server, then run /mcp in Claude Code and choose Authenticate.",
    code: `claude mcp add --transport http gethired ${MCP_URL}`,
  },
  {
    name: "Cursor",
    steps: "Add this to ~/.cursor/mcp.json (or .cursor/mcp.json in a project), then choose Connect next to gethired in Cursor's MCP settings.",
    code: JSON.stringify({ mcpServers: { gethired: { url: MCP_URL } } }, null, 2),
  },
  {
    name: "VS Code",
    steps: "Add this to .vscode/mcp.json (or run MCP: Add Server), then start the server and sign in when VS Code asks.",
    code: JSON.stringify({ servers: { gethired: { type: "http", url: MCP_URL } } }, null, 2),
  },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <code className="select-all">{children}</code>
    </pre>
  );
}

/** Example URLs for hiring teams, narrowed on the URL (RMCP spec §4.5). */
const TOOLSET_EXAMPLES = [
  { url: mcpToolsetUrl(MCP_URL, { toolsets: ["jobs", "applicants"] }), what: "only job posts and applications" },
  { url: mcpToolsetUrl(MCP_URL, { readonly: true }), what: "every tool that only reads" },
  {
    url: mcpToolsetUrl(MCP_URL, { toolsets: ["pipeline", "outreach"], readonly: true }),
    what: "read-only pipeline and messages",
  },
];

const MCP_USE_LABEL = PERMISSION_CATALOG.find((permission) => permission.key === "mcp.use")!.label;

function ToolList({
  tools,
  policy,
}: {
  // Either catalog's rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: readonly McpToolDef<any, any, any>[];
  policy: ToolApprovalPolicy;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {tools.map((tool) => {
        const { credit, confirm } = mcpToolFlags(tool, policy);
        return (
          <li key={tool.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <code className="text-sm font-medium">{tool.name}</code>
            <span className="text-sm text-muted-foreground">{tool.title}</span>
            <span className="ml-auto flex gap-1.5">
              {tool.annotations.readOnlyHint && <Badge variant="outline">Read-only</Badge>}
              {confirm && <Badge variant="outline">Asks first</Badge>}
              {credit && <Badge variant="outline">Credits</Badge>}
              {tool.email && <Badge variant="outline">Emails</Badge>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default function McpDocsPage() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
        <PageHeader
          title="Connect an MCP client"
          description="Use GetHired from Claude, Cursor, VS Code or any other client that supports remote MCP servers."
        />

        <Section title="Server URL">
          <CodeBlock>{MCP_URL}</CodeBlock>
          <p className="text-sm text-muted-foreground">
            There are no API keys. Your client signs you in through GetHired and asks you to approve
            it once. Job seekers and hiring teams use the same URL, and each gets their own tools.
          </p>
        </Section>

        <Section title="Setup">
          <ul className="divide-y rounded-lg border">
            {CLIENTS.map((client) => (
              <li key={client.name} className="flex flex-col gap-2 px-4 py-3">
                <h3 className="font-medium">{client.name}</h3>
                <p className="text-sm text-muted-foreground">{client.steps}</p>
                {client.code && <CodeBlock>{client.code}</CodeBlock>}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Tools">
          <ToolList tools={MCP_TOOLS} policy={APPLICANT_APPROVAL_POLICY} />
        </Section>

        <Section title="Confirmation">
          <p className="text-[15px] leading-7">
            Tools marked <span className="font-medium">Asks first</span> apply to a job, start a
            resume review, or change your profile. They never run on the model&apos;s say-so. Your
            client shows you what will happen and asks you to confirm. Clients that can&apos;t show
            a confirmation prompt get a preview instead, and the assistant has to repeat the call
            after you agree. A confirmation is good for one call and expires after{" "}
            {MCP_CONFIRMATION_TTL_SECONDS / 60} minutes.
          </p>
        </Section>

        <Section title="Credits and limits">
          <p className="text-[15px] leading-7">
            Tools marked <span className="font-medium">Credits</span> spend AI credits from your
            balance, the same as in the app, and only once they run (never on a preview). You can
            make up to {MCP_CALLS_PER_MINUTE} calls a minute and {MCP_CREDIT_CALLS_PER_HOUR}{" "}
            credit-spending calls an hour.{" "}
            <Link href="/dashboard/buy-credits" className="underline underline-offset-4 hover:text-brand">
              Buy credits
            </Link>
            .
          </p>
        </Section>

        <Section title="For hiring teams">
          <p className="text-[15px] leading-7">
            Company accounts connect to the same URL and get the hiring tools: job posts, the
            talent pool, applications, the pipeline, your own candidates, messages, AI screening
            interviews, the team and the careers page. Your role needs the{" "}
            <span className="font-medium">{MCP_USE_LABEL}</span> permission, and each tool follows
            the rest of your role&apos;s permissions, including which jobs you&apos;re assigned to.
            Tools spend your plan&apos;s allowances the same as in the app; there&apos;s no charge
            per call.
          </p>
          <p className="text-[15px] leading-7">
            Tools marked <span className="font-medium">Emails</span> can email candidates, so they
            always ask first and are limited to {MCP_EMAIL_CALLS_PER_HOUR} calls an hour, on top of
            the limits above.
          </p>
        </Section>

        <Section title="Choosing toolsets">
          <p className="text-[15px] leading-7">
            A hiring team sees up to {RECRUITER_MCP_TOOLS.length} tools. Claude and ChatGPT search
            them as needed, so you can connect them all. For a client without tool search, or with
            a limit on tools, add <code>toolsets</code> to the URL to connect only some of them,
            and <code>readonly=true</code> for a connection that can&apos;t change anything. An
            unknown toolset name is refused, so a typo doesn&apos;t hide tools quietly.
          </p>
          <ul className="flex flex-col gap-2">
            {TOOLSET_EXAMPLES.map((example) => (
              <li key={example.url} className="flex flex-col gap-1">
                <CodeBlock>{example.url}</CodeBlock>
                <span className="text-sm text-muted-foreground">Connects {example.what}.</span>
              </li>
            ))}
          </ul>
          {[...ALL_MCP_TOOLSETS].map((toolset) => (
            <div key={toolset} className="flex flex-col gap-2" data-toolset={toolset}>
              <h3 className="font-medium">
                <code>{toolset}</code>{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {MCP_TOOLSET_LABELS[toolset]}
                </span>
              </h3>
              <ToolList
                tools={RECRUITER_MCP_TOOLS.filter((tool) => tool.toolset === toolset)}
                policy={RECRUITER_APPROVAL_POLICY}
              />
            </div>
          ))}
        </Section>
      </main>
      <div className="my-20 px-4 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
