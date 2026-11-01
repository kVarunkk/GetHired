/**
 * The MCP landing pages: /mcp-server for job seekers and /mcp-server/companies
 * for hiring teams. Copy comes from LANDING_PAGES / MCP_CAPABILITIES (shared
 * with the .md versions), the tools from the catalogs, the limits from config.
 */
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CalendarCheck,
  Coins,
  FileText,
  Globe,
  KanbanSquare,
  Link2,
  LogIn,
  type LucideIcon,
  Mail,
  MessageSquareText,
  Search,
  Send,
  ShieldCheck,
  Users,
  UserPlus,
  UsersRound,
} from "lucide-react";
import FootComponent from "@/components/FootComponent";
import ClaudeIcon from "@/components/icons/ClaudeIcon";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero, { HeroEyebrow } from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import { Button } from "@/components/ui/button";
import { APPLICANT_APPROVAL_POLICY } from "@/helpers/agent/approval";
import { RECRUITER_APPROVAL_POLICY } from "@/helpers/agent/roles/recruiter/approval";
import { PERMISSION_CATALOG } from "@/helpers/companies/permissions";
import { MCP_CAPABILITIES, type LandingPageCopy, type McpAudience } from "@/helpers/marketing/content";
import {
  MCP_CALLS_PER_MINUTE,
  MCP_CONFIRMATION_TTL_SECONDS,
  MCP_CREDIT_CALLS_PER_HOUR,
  MCP_EMAIL_CALLS_PER_HOUR,
} from "@/helpers/mcp/config";
import { RECRUITER_MCP_TOOLS } from "@/helpers/mcp/recruiter-tools";
import { MCP_TOOLS } from "@/helpers/mcp/tools";
import { ALL_MCP_TOOLSETS, MCP_TOOLSET_LABELS } from "@/helpers/mcp/toolsets";
import { cn } from "@/utils/utils";
import { CodeBlock, MCP_CLIENTS, MCP_URL, McpClientIcon, McpClientSetup, McpToolList } from "./McpDocs";
import McpHeroPreview from "./McpHeroPreview";

const MCP_USE_LABEL = PERMISSION_CATALOG.find((permission) => permission.key === "mcp.use")!.label;

/** Same side padding as the navbar, so every section lines up with it. */
const GUTTER = "px-4 lg:px-20 xl:px-40 2xl:px-80";

const linkClass = "font-medium text-foreground underline underline-offset-4 hover:text-brand";

/** One icon per capability card, in MCP_CAPABILITIES order. */
const CAPABILITY_ICONS: Record<McpAudience, LucideIcon[]> = {
  applicant: [Search, Send, FileText, CalendarCheck],
  company: [Briefcase, Users, KanbanSquare, Mail, UsersRound, Globe],
};

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-8 flex flex-col items-center gap-4 text-center sm:mb-12">
      {eyebrow && (
        <span className="rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          {eyebrow}
        </span>
      )}
      <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>
      {description && <p className="mx-auto max-w-2xl text-muted-foreground">{description}</p>}
    </div>
  );
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
      <Icon className="h-[18px] w-[18px]" aria-hidden />
    </span>
  );
}

function McpHero({ page, jobCount }: { page: LandingPageCopy & { mcp: McpAudience }; jobCount: number }) {
  const isCompany = page.mcp === "company";
  const [primary, secondary] = page.ctas;

  return (
    <Hero
      eyebrow={
        <HeroEyebrow
          href="/mcp"
          icon={<ClaudeIcon className="h-3.5 w-3.5" />}
          label="Remote MCP server"
          detail="Works with Claude, Cursor and VS Code"
        />
      }
      heading={page.heading}
      subheading={page.subheading(jobCount)}
      ctaText={primary.label}
      ctaLink={primary.href}
      ctaText2={secondary?.label}
      ctaLink2={secondary?.href}
      below={
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground sm:gap-x-6">
          {MCP_CLIENTS.map((client) => (
            <li key={client.id} className="flex items-center gap-2">
              <McpClientIcon id={client.id} />
              {client.name.replace(" (web and desktop)", "")}
            </li>
          ))}
        </ul>
      }
      previewFramed
      preview={
        <McpHeroPreview
          audience={page.mcp}
          note={
            isCompany
              ? "No API keys. Sign in with your GetHired company account and approve the client once."
              : "No API keys. Sign in with your GetHired account and approve the client once."
          }
        />
      }
    />
  );
}

function HowItWorks({ isCompany }: { isCompany: boolean }) {
  const steps: { icon: LucideIcon; title: string; body: React.ReactNode }[] = [
    {
      icon: Link2,
      title: "Add the server",
      body: (
        <>
          <p>Paste the URL into your client&apos;s connectors, or run one command in Claude Code.</p>
          <CodeBlock copyLabel="Copy server URL" className="mt-1">
            {MCP_URL}
          </CodeBlock>
        </>
      ),
    },
    {
      icon: LogIn,
      title: "Sign in once",
      body: (
        <p>
          Your client opens GetHired. Sign in with your {isCompany ? "company " : ""}account and approve it.
          There are no API keys to copy or rotate.
        </p>
      ),
    },
    {
      icon: MessageSquareText,
      title: "Ask in plain English",
      body: (
        <p>
          {isCompany
            ? "“Show me this week's applicants for the backend role.” Your assistant uses GetHired's tools and asks before it changes anything."
            : "“Find remote React jobs that match my resume.” Your assistant uses GetHired's tools and asks before it applies anywhere."}
        </p>
      ),
    },
  ];

  return (
    <section className={GUTTER}>
      <SectionHeading
        eyebrow="Set up in a minute"
        title="How it works"
        description="Three steps, then GetHired is one more thing your assistant can do."
      />
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className="relative flex min-w-0 flex-col gap-4 rounded-xl border bg-background p-5 sm:p-6 md:last:col-span-2 lg:last:col-span-1"
          >
            <div className="flex items-center justify-between">
              <IconTile icon={step.icon} />
              <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
            </div>
            <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
            <div className="flex min-w-0 flex-col gap-2 text-sm leading-6 text-muted-foreground">{step.body}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Capabilities({ audience }: { audience: McpAudience }) {
  const copy = MCP_CAPABILITIES[audience];
  const icons = CAPABILITY_ICONS[audience];
  return (
    <section className={GUTTER}>
      <SectionHeading eyebrow="Tools, not tabs" title={copy.heading} description={copy.subheading} />
      <ul className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", audience === "company" ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
        {copy.items.map((item, i) => (
          <li
            key={item.name}
            className="flex flex-col gap-3 rounded-xl border bg-background p-5 transition-colors hover:bg-muted/30 sm:p-6"
          >
            <IconTile icon={icons[i] ?? Search} />
            <h3 className="text-lg font-semibold tracking-tight">{item.name}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConnectSection({ isCompany }: { isCompany: boolean }) {
  return (
    <section id="connect" className={cn("scroll-mt-20", GUTTER)}>
      <SectionHeading
        eyebrow="Connect"
        title="Connect your client"
        description="Works with any client that supports remote MCP servers. Here's how to add it to the common ones."
      />
      <McpClientSetup />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        More detail, limits and{isCompany ? " toolsets" : " confirmations"} are in the{" "}
        <Link href={isCompany ? "/mcp#for-hiring-teams" : "/mcp"} className={linkClass}>
          setup guide
        </Link>
        .
      </p>
    </section>
  );
}

function ControlCard({ icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-5 sm:p-6">
      <IconTile icon={icon} />
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-[15px] leading-7 text-muted-foreground">{children}</p>
    </div>
  );
}

function ApplicantControl() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ControlCard icon={ShieldCheck} title="You stay in control">
        Tools marked <span className="font-medium text-foreground">Asks first</span> apply to a job, start a
        resume review or change your profile. They never run on the model&apos;s say-so: your client shows you
        what will happen and waits for you to confirm. A confirmation is good for one call and expires after{" "}
        {MCP_CONFIRMATION_TTL_SECONDS / 60} minutes.
      </ControlCard>
      <ControlCard icon={Coins} title="Credits, only when used">
        Tools marked <span className="font-medium text-foreground">Credits</span> spend AI credits from your
        balance, the same as in the app, and only once they run. You can make up to {MCP_CALLS_PER_MINUTE}{" "}
        calls a minute and {MCP_CREDIT_CALLS_PER_HOUR} credit-spending calls an hour.
      </ControlCard>
    </div>
  );
}

function CompanyControl() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ControlCard icon={UserPlus} title="Your roles still apply">
        A teammate can connect once their role has the{" "}
        <span className="font-medium text-foreground">{MCP_USE_LABEL}</span> permission. Each tool follows the
        rest of their role, including which jobs they&apos;re assigned to, so a connection can&apos;t do more
        than that person can in the app.
      </ControlCard>
      <ControlCard icon={ShieldCheck} title="Nothing changes without a yes">
        Every tool that changes something asks first: your client shows what will happen and waits for you to
        confirm. Tools marked <span className="font-medium text-foreground">Emails</span> can email candidates
        and are limited to {MCP_EMAIL_CALLS_PER_HOUR} calls an hour. Tools use your plan&apos;s allowances, the
        same as in the app; there&apos;s no charge per call.
      </ControlCard>
    </div>
  );
}

function ToolsSection({ isCompany }: { isCompany: boolean }) {
  const count = isCompany ? RECRUITER_MCP_TOOLS.length : MCP_TOOLS.length;
  return (
    <section id="tools" className={cn("flex scroll-mt-20 flex-col gap-16", GUTTER)}>
      <div>
        <SectionHeading
          eyebrow="Safety"
          title={isCompany ? "Your rules, in every client" : "Your account, your call"}
        />
        {isCompany ? <CompanyControl /> : <ApplicantControl />}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight">{`All ${count} tools`}</h2>
          {isCompany && (
            <p className="text-muted-foreground">
              Grouped by toolset. Connect them all, or only some by adding toolsets to the URL.
            </p>
          )}
        </div>
        {isCompany ? (
          [...ALL_MCP_TOOLSETS].map((toolset) => (
            <div key={toolset} className="flex min-w-0 flex-col gap-3" data-toolset={toolset}>
              <h3 className="flex flex-wrap items-baseline gap-2 font-medium">
                <code className="font-mono text-sm">{toolset}</code>
                <span className="text-sm font-normal text-muted-foreground">{MCP_TOOLSET_LABELS[toolset]}</span>
              </h3>
              <McpToolList
                tools={RECRUITER_MCP_TOOLS.filter((tool) => tool.toolset === toolset)}
                policy={RECRUITER_APPROVAL_POLICY}
              />
            </div>
          ))
        ) : (
          <McpToolList tools={MCP_TOOLS} policy={APPLICANT_APPROVAL_POLICY} />
        )}
      </div>
    </section>
  );
}

function CrossLink({ isCompany }: { isCompany: boolean }) {
  return (
    <section className={GUTTER}>
      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border bg-muted/30 p-6 sm:flex-row sm:items-center sm:p-8">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {isCompany ? "Looking for a job instead?" : "Hiring?"}
          </h2>
          <p className="text-muted-foreground">
            {isCompany
              ? "Job seekers connect to the same URL and get tools for their own search."
              : "Hiring teams connect to the same URL and get the recruiter's tools."}
          </p>
        </div>
        <Button asChild variant="outline" className="h-auto w-full whitespace-normal bg-background py-2 sm:w-auto sm:shrink-0">
          <Link href={isCompany ? "/mcp-server" : "/mcp-server/companies"}>
            {isCompany ? "The MCP server for job seekers" : "The MCP server for hiring teams"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

export default function McpLandingPage({
  page,
  jobCount,
}: {
  page: LandingPageCopy & { mcp: McpAudience };
  jobCount: number;
}) {
  const isCompany = page.mcp === "company";

  return (
    <main className="flex min-h-screen w-full flex-1 flex-col gap-24 sm:gap-32">
      <McpHero page={page} jobCount={jobCount} />
      <HowItWorks isCompany={isCompany} />
      <Capabilities audience={page.mcp} />
      <HowWeHelp jobCount={jobCount} audience={isCompany ? "hire" : "applicant"} />
      <ConnectSection isCompany={isCompany} />
      <ToolsSection isCompany={isCompany} />
      <CrossLink isCompany={isCompany} />
      <FAQSection topic={page.faq} />
      <div className={GUTTER}>
        <FootComponent />
      </div>
      <Footer />
    </main>
  );
}
