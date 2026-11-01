import type { Metadata } from "next";
import Link from "next/link";
import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import ClaudeIcon from "@/components/icons/ClaudeIcon";
import PageHeader from "@/components/PageHeader";
import {
  CodeBlock,
  MCP_URL,
  McpClientSetup,
  McpSection as Section,
  McpToolList as ToolList,
} from "@/components/mcp/McpDocs";
import { MCP_TOOLS } from "@/helpers/mcp/tools";
import { APPLICANT_APPROVAL_POLICY } from "@/helpers/agent/approval";
import { RECRUITER_APPROVAL_POLICY } from "@/helpers/agent/roles/recruiter/approval";
import { PERMISSION_CATALOG } from "@/helpers/companies/permissions";
import { RECRUITER_MCP_TOOLS } from "@/helpers/mcp/recruiter-tools";
import { ALL_MCP_TOOLSETS, MCP_TOOLSET_LABELS, mcpToolsetUrl } from "@/helpers/mcp/toolsets";
import {
  MCP_CALLS_PER_MINUTE,
  MCP_CONFIRMATION_TTL_SECONDS,
  MCP_CREDIT_CALLS_PER_HOUR,
  MCP_EMAIL_CALLS_PER_HOUR,
} from "@/helpers/mcp/config";

export const metadata: Metadata = {
  title: "Connect an MCP client",
  description:
    "Use GetHired from Claude, Cursor, VS Code or any other MCP client: search jobs, apply, and manage your resumes, reviews and mock interviews, or run your hiring team's jobs, pipeline and candidates.",
  alternates: { canonical: "/mcp" },
};

export const dynamic = "force-static";

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

const linkClass = "underline underline-offset-4 hover:text-brand";

export default function McpDocsPage() {
  return (
    <>
      <main className="flex w-full min-w-0 flex-col gap-10 sm:gap-14 px-4 pb-10 lg:px-20 xl:px-40 2xl:px-80">
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-1.5">
              <ClaudeIcon className="h-3.5 w-3.5" />
              MCP setup guide
            </span>
          }
          title="Connect an MCP client"
          description="Use GetHired from Claude, Cursor, VS Code or any other client that supports remote MCP servers."
        />

        <p className="-mt-6 text-[15px] sm:-mt-8 leading-7 text-muted-foreground">
          What the server does:{" "}
          <Link href="/mcp-server" className={linkClass}>
            for job seekers
          </Link>{" "}
          and{" "}
          <Link href="/mcp-server/companies" className={linkClass}>
            for hiring teams
          </Link>
          .
        </p>

        <Section title="Server URL">
          <CodeBlock copyLabel="Copy server URL" className="max-w-3xl">
            {MCP_URL}
          </CodeBlock>
          <p className="max-w-3xl text-sm text-muted-foreground">
            There are no API keys. Your client signs you in through GetHired and asks you to approve
            it once. Job seekers and hiring teams use the same URL, and each gets their own tools.
          </p>
        </Section>

        <Section title="Setup">
          <McpClientSetup />
        </Section>

        <Section title="Tools">
          <ToolList tools={MCP_TOOLS} policy={APPLICANT_APPROVAL_POLICY} />
        </Section>

        <Section title="Confirmation">
          <p className="max-w-3xl text-[15px] leading-7">
            Tools marked <span className="font-medium">Asks first</span> apply to a job, start a
            resume review, or change your profile. They never run on the model&apos;s say-so. Your
            client shows you what will happen and asks you to confirm. Clients that can&apos;t show
            a confirmation prompt get a preview instead, and the assistant has to repeat the call
            after you agree. A confirmation is good for one call and expires after{" "}
            {MCP_CONFIRMATION_TTL_SECONDS / 60} minutes.
          </p>
        </Section>

        <Section title="Credits and limits">
          <p className="max-w-3xl text-[15px] leading-7">
            Tools marked <span className="font-medium">Credits</span> spend AI credits from your
            balance, the same as in the app, and only once they run (never on a preview). You can
            make up to {MCP_CALLS_PER_MINUTE} calls a minute and {MCP_CREDIT_CALLS_PER_HOUR}{" "}
            credit-spending calls an hour.{" "}
            <Link href="/dashboard/buy-credits" className={linkClass}>
              Buy credits
            </Link>
            .
          </p>
        </Section>

        <div id="for-hiring-teams" className="scroll-mt-20">
          <Section title="For hiring teams">
            <p className="max-w-3xl text-[15px] leading-7">
              Company accounts connect to the same URL and get the hiring tools: job posts, the
              talent pool, applications, the pipeline, your own candidates, messages, AI screening
              interviews, the team and the careers page. Your role needs the{" "}
              <span className="font-medium">{MCP_USE_LABEL}</span> permission, and each tool follows
              the rest of your role&apos;s permissions, including which jobs you&apos;re assigned to.
              Tools spend your plan&apos;s allowances the same as in the app; there&apos;s no charge
              per call.
            </p>
            <p className="max-w-3xl text-[15px] leading-7">
              Tools marked <span className="font-medium">Emails</span> can email candidates, so they
              always ask first and are limited to {MCP_EMAIL_CALLS_PER_HOUR} calls an hour, on top of
              the limits above.
            </p>
          </Section>
        </div>

        <Section title="Choosing toolsets">
          <p className="max-w-3xl text-[15px] leading-7">
            A hiring team sees up to {RECRUITER_MCP_TOOLS.length} tools. Claude and ChatGPT search
            them as needed, so you can connect them all. For a client without tool search, or with
            a limit on tools, add <code>toolsets</code> to the URL to connect only some of them,
            and <code>readonly=true</code> for a connection that can&apos;t change anything. An
            unknown toolset name is refused, so a typo doesn&apos;t hide tools quietly.
          </p>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {TOOLSET_EXAMPLES.map((example) => (
              <li key={example.url} className="flex min-w-0 flex-col gap-1.5">
                <CodeBlock copyLabel="Copy URL">{example.url}</CodeBlock>
                <span className="text-sm text-muted-foreground">Connects {example.what}.</span>
              </li>
            ))}
          </ul>
          {[...ALL_MCP_TOOLSETS].map((toolset) => (
            <div key={toolset} className="flex min-w-0 flex-col gap-2" data-toolset={toolset}>
              <h3 className="flex flex-wrap items-baseline gap-2 font-medium">
                <code className="font-mono text-sm">{toolset}</code>
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
      <div className="my-12 px-4 sm:my-20 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
