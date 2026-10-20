import {
  Award,
  FileSearch,
  Gauge,
  ListChecks,
  PenLine,
  Search,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { AGENT_DAILY_MESSAGE_CAP } from "@/helpers/agent/config";
import { AGENT_PATH, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { RA_DAILY_MESSAGE_CAP } from "@/helpers/agent/roles/recruiter/config";
import type { AgentRoleId } from "@/helpers/agent/roles/types";

export type { AgentRoleId };

type RoleUi = {
  /** The page the role's agent lives on. */
  basePath: string;
  heading: string;
  intro: string;
  /** Starter prompts on an empty chat, each with an icon (same order). */
  starters: string[];
  icons: LucideIcon[];
  /** The message box's placeholder. */
  placeholder: string;
  dailyCap: number;
  memoriesTitle: string;
  memoriesDescription: string;
};

export const APPLICANT_STARTERS = [
  "Find remote frontend jobs posted this week",
  "Show jobs that match my profile",
  "Review my resume against a job I like",
  "What's the status of my applications?",
];

/** What the chat says and offers for each role (RA-REQ-001, RA spec §4.7). */
export const AGENT_ROLE_UI: Record<AgentRoleId, RoleUi> = {
  applicant: {
    basePath: AGENT_PATH,
    heading: "What do you need help with?",
    intro:
      "I can find jobs that fit your profile, review your resume against a role, and keep your applications up to date.",
    starters: APPLICANT_STARTERS,
    // Search, match, review, track.
    icons: [Search, Target, FileSearch, ListChecks],
    placeholder: "Ask about jobs, your resume or applications…",
    dailyCap: AGENT_DAILY_MESSAGE_CAP,
    memoriesTitle: "What the assistant remembers",
    memoriesDescription:
      "Facts the assistant saved about you across chats. Your job preferences live on your profile.",
  },
  company: {
    basePath: COMPANY_AGENT_PATH,
    heading: "Who are you hiring?",
    intro:
      "I can write job posts, find and compare candidates in the GetHired talent pool, and help you review your applicants.",
    starters: [
      "Find candidates for my latest job",
      "Who are the strongest applicants this week?",
      "Write a job post for a founding engineer",
      "Where is each role stuck?",
    ],
    // Find, rank, write, funnel.
    icons: [Users, Award, PenLine, Gauge],
    placeholder: "Ask about candidates, applicants or your job posts…",
    dailyCap: RA_DAILY_MESSAGE_CAP,
    memoriesTitle: "What the assistant remembers about your hiring",
    memoriesDescription:
      "Hiring context the assistant saved across chats: your bar, process, bands and decisions.",
  },
};
