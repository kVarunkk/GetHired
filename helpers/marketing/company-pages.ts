// Copy for the company-side feature pages (/hire/<feature>): one page per
// thing a hiring team can do on GetHired. Same shape as the applicant feature
// pages in content.ts, which merges these into FAQS and LANDING_PAGES, so the
// HTML page and its markdown version say the same. Client-safe.
//
// Every claim here is backed by the product or by a blog post under
// app/content/posts (linked from `related`); keep it that way. No outcomes are
// promised: AI scores and summaries help a person decide, they don't decide.

import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import type { LandingPageCopy, MarketingLink } from "./content";

const SIGNUP = "/auth/sign-up?company=true";
const START_FREE: MarketingLink = { label: "Start hiring free", href: SIGNUP };
const PRICING: MarketingLink = { label: "See plans and pricing", href: "/pricing/companies" };
const askAgent = (prompt: string) => agentPromptHref(prompt, COMPANY_AGENT_PATH);

export const COMPANY_FAQS = {
  "ai-recruiter-agent": [
    {
      question: "What is an AI recruiter agent?",
      answer:
        "A chat assistant that does recruiting work for you. The GetHired recruiter agent drafts job posts, finds and ranks matched candidates with reasons, reviews applicants, moves people through your pipeline, writes outreach and invites applicants to AI screening interviews.",
    },
    {
      question: "Can the recruiter agent email candidates or publish jobs on its own?",
      answer:
        "No. Anything that publishes, emails, moves an application or invites someone shows an approval card with the exact content first, and nothing happens until you approve it.",
    },
    {
      question: "Does the agent follow my team's permissions?",
      answer:
        "Yes. It acts as the person using it. If your role can't send outreach, neither can your agent, and it tells you which permission is missing. If you only have access to two jobs, it only sees those two jobs.",
    },
    {
      question: "Does the agent use my company's data only?",
      answer:
        "Yes. It works inside your company account and can't be pointed at another company's jobs or applicants. Resumes and applicant answers are treated as data, not instructions.",
    },
    {
      question: "What does the recruiter agent cost?",
      answer:
        "Agent messages come from your plan's monthly allowance. Current allowances are on gethired.devhub.co.in/pricing/companies.",
    },
  ],
  "ai-job-description-generator": [
    {
      question: "Can AI write a job description for me?",
      answer:
        "Yes. Tell the GetHired recruiter agent the role, location and must-have skills, and it drafts the full job post: summary, responsibilities, requirements and application questions. You edit it in the chat or by hand before it goes live.",
    },
    {
      question: "Will the AI publish the job post without asking?",
      answer:
        "No. The draft appears in an approval card and nothing is published until you approve it.",
    },
    {
      question: "Does it work for roles outside tech?",
      answer:
        "Yes. Describe any role in plain English. The agent asks for what it needs, such as location, salary range and must-haves, and drafts from your answers.",
    },
    {
      question: "Where does the job post appear once it's published?",
      answer:
        "On your GetHired careers page and in GetHired's job search, and it is submitted to Google and Bing for indexing. You can also switch on job board feeds.",
    },
    {
      question: "Can the job post carry its own application questions?",
      answer:
        "Yes. Each post can have a custom application form with typed questions, required or optional fields, help text and private knockout rules. Questions about protected characteristics are refused when you save them.",
    },
  ],
  "ai-candidate-matching": [
    {
      question: "How does GetHired match candidates to a job?",
      answer:
        "When a job goes live, GetHired matches it against candidates who made their profiles public. It uses semantic search rather than keyword counting, then an AI re-ranking step, so a candidate who built event pipelines on Kafka can match a job asking for distributed systems experience.",
    },
    {
      question: "What does the match score mean?",
      answer:
        "Each matched candidate gets a score from 0 to 100 and a short explanation: strengths, gaps and conflicts such as \"wants remote; this job is onsite\". It helps you decide who to look at first. It is not a hiring decision.",
    },
    {
      question: "Does matching use names, photos or age?",
      answer:
        "No. The models never see names, photos, age, gender or other protected characteristics when they score a candidate, and the agent refuses to filter or rank by them.",
    },
    {
      question: "Can I see a candidate's contact details?",
      answer:
        "Not at first. Contact details and the resume file are shared with you only after the candidate applies or replies Interested to your outreach.",
    },
    {
      question: "Does it also match my own imported candidates?",
      answer:
        "Yes. Each job shows a \"From your candidates\" list ranked by similarity, built from the resumes and spreadsheets you've imported.",
    },
  ],
  "talent-pool": [
    {
      question: "What is a talent pool?",
      answer:
        "A searchable database of people you might hire: past applicants, finalists you passed on, referrals and contacts from events. On GetHired you can import them and match them to every new job.",
    },
    {
      question: "How do I add candidates I already have?",
      answer:
        "Import a batch of resumes or a spreadsheet, or add one candidate by hand. Imported people are company-private: only your team sees them.",
    },
    {
      question: "How is searching a talent pool here different from a keyword search?",
      answer:
        "GetHired searches by meaning, not exact keywords, so a resume that says \"led a team of five\" can match a job that asks for management experience.",
    },
    {
      question: "Can I group candidates into shortlists?",
      answer:
        "Yes. Save candidates into named talent lists such as \"Backend shortlist\", and leave notes and ratings on any talent pool candidate for your team.",
    },
    {
      question: "Do imports have limits?",
      answer:
        "Resume imports use a monthly allowance on your plan. The allowances for each plan are on gethired.devhub.co.in/pricing/companies.",
    },
  ],
  "candidate-outreach": [
    {
      question: "How does candidate outreach work on GetHired?",
      answer:
        "From a candidate's profile, send an invite to apply or a short note asking if they're open to a chat. The candidate answers Interested or Not interested in their GetHired dashboard.",
    },
    {
      question: "Why is it different from cold email?",
      answer:
        "Every candidate you reach chose to be found by making their profile public, and their contact details are shared with you only after they say yes or apply.",
    },
    {
      question: "Can the agent write outreach for me?",
      answer:
        "Yes. It drafts a short message grounded in why each person matched. Each outreach goes to one candidate and needs your approval before it is sent.",
    },
    {
      question: "Is outreach limited?",
      answer:
        "Outreach uses your plan's monthly allowance, and an owner can set a monthly cap per role so one person doesn't use the whole company's allowance.",
    },
  ],
  "ai-applicant-screening": [
    {
      question: "What is AI applicant screening?",
      answer:
        "Every application to your job is screened in the background. Each applicant gets a fit score from 0 to 100, a recommendation, a short summary, a check of each must-have requirement with evidence from their resume, and feedback on their screening answers.",
    },
    {
      question: "Does the AI reject applicants?",
      answer:
        "No. The AI never rejects anyone on its own. You sort and filter by fit, then decide. The only automatic rejections are knockout rules you write yourself.",
    },
    {
      question: "Can I screen applicants out with required questions?",
      answer:
        "Yes. Add a knockout rule to a yes/no or choice question for a true requirement, such as the right to work in a country. Applicants never see the rules, and use them sparingly.",
    },
    {
      question: "Is AI screening fair?",
      answer:
        "The models only judge job-related evidence and never see names, photos, age, gender, religion, caste, nationality or other protected characteristics. Question text that asks about them is refused when you save it.",
    },
    {
      question: "Can I filter applicants by their answers?",
      answer:
        "Yes. Because application answers are typed, you can filter, for example, to people who answered Yes to relocation or have a notice period under 30 days.",
    },
  ],
  "ai-screening-interviews": [
    {
      question: "What is an AI screening interview?",
      answer:
        "A short, structured voice interview that you add to a job. Applicants above your bar are invited after they apply, take it in their browser, and you get a one-page report scored against the competencies you chose.",
    },
    {
      question: "What do I get after the interview?",
      answer:
        "A score for each competency, short quotes from what the candidate said as evidence, concerns worth probing and follow-up questions for your own interview. Quotes that don't appear word for word in the transcript are removed.",
    },
    {
      question: "Does it recommend who to hire?",
      answer:
        "No. There is deliberately no hire or reject recommendation. A person on your team makes every decision.",
    },
    {
      question: "How do I choose who gets invited?",
      answer:
        "Set a fit score threshold and applicants at or above it are invited automatically, or invite people by hand, up to 50 at a time from the applicants list.",
    },
    {
      question: "What does an AI interview cost?",
      answer:
        "Interviews use interview minutes from your plan. Minutes are reserved when you invite someone and charged only when the candidate completes the interview.",
    },
  ],
  "applicant-tracking-system": [
    {
      question: "Does GetHired include an applicant tracking system?",
      answer:
        "Yes. Each job has a pipeline with stages you can customise, a list and a drag-and-drop board, bulk moves, notes and ratings, an activity timeline, email templates and a hiring funnel. It is free to start and needs no setup beyond posting a job.",
    },
    {
      question: "Is GetHired an ATS for startups and small businesses?",
      answer:
        "It's built for teams that don't have a recruiter yet: the parts of an ATS a small team actually uses, without weeks of setup.",
    },
    {
      question: "Can I customise the hiring stages?",
      answer:
        "Yes. Rename, reorder and archive stages and add your own, up to 12. The defaults are Applied, Screening, Interview, Offer and Hired, plus Rejected and On hold.",
    },
    {
      question: "Can I email candidates from the pipeline?",
      answer:
        "Yes, from editable templates for rejection, moving forward, interview invites, offers and custom messages. Moves can offer an email with a preview first, and sending is always optional.",
    },
    {
      question: "What does the hiring funnel show?",
      answer:
        "How many candidates reached each stage, conversion between stages, median days in each stage, where candidates came from and time to hire.",
    },
  ],
  "interview-scheduling": [
    {
      question: "Can GetHired schedule interviews?",
      answer:
        "Yes. Plan the interviews for a job, schedule them with a panel from your team, or send the candidate a self-scheduling link to pick a time. Scheduled interviews can sync with a connected Google Calendar.",
    },
    {
      question: "What is an interview plan?",
      answer:
        "The rounds a job goes through. Each interview has a name, a length from 15 to 240 minutes, the competencies it covers, questions and default interviewers. A job's plan can have up to 20 interviews.",
    },
    {
      question: "Can interviewers submit scorecards?",
      answer:
        "Yes. Each interviewer on the panel gets an interview kit and writes a scorecard against the competencies. Scorecards are kept blind for a window after the interview so one person's ratings don't sway another's, and you can remind interviewers who haven't submitted.",
    },
    {
      question: "How many interviewers can be on a panel?",
      answer: "One to six people from your team.",
    },
  ],
  "careers-page-builder": [
    {
      question: "Can I build a careers page with GetHired?",
      answer:
        "Yes. Every company can publish a branded careers page at its own address, such as gethired.devhub.co.in/careers/your-company, with your logo, cover image, About section, perks and custom sections.",
    },
    {
      question: "Do I need a developer to make it?",
      answer:
        "No. You pick an address, fill in the sections and preview the page before you publish it. You can unpublish it at any time.",
    },
    {
      question: "Can candidates search my open roles?",
      answer:
        "Yes. The jobs list has keyword search and filters for location, job type, workplace type, experience and minimum salary, and the filters live in the address so you can link straight to a filtered list.",
    },
    {
      question: "What can a custom application form ask?",
      answer:
        "Short and long text, single and multiple choice, yes/no, number, date and URL questions, each required or optional with help text. Save groups of questions as question sets and reuse them across jobs.",
    },
    {
      question: "Is the careers page free?",
      answer:
        "Posting jobs is free to start, and your careers page shows the jobs you publish. Plan limits are on gethired.devhub.co.in/pricing/companies.",
    },
  ],
  "job-multiposting": [
    {
      question: "Can I post a job to multiple job boards at once?",
      answer:
        "Publish once on GetHired and the job goes to the places you switch on: it is submitted to Google and Bing for indexing, and you can turn on job board feeds for all your jobs.",
    },
    {
      question: "Which job boards does GetHired support?",
      answer:
        "Google for Jobs and Bing are on for every published job. Feed channels include Jooble, Adzuna, Talent.com and ZipRecruiter, and Naukri connects through your own account. A board shows jobs once it has approved GetHired, and each job's page shows its status for every board.",
    },
    {
      question: "Can I keep one job off a job board?",
      answer:
        "Yes. Switch boards on or off for the whole company, and each job can still leave itself out of an active board.",
    },
    {
      question: "How do I see where a job is live?",
      answer:
        "Each job's Distribution page lists every channel and whether the job is live, queued, waiting for the board, off, opted out or has an error, with the reason.",
    },
  ],
  "hiring-team-collaboration": [
    {
      question: "Can my whole team use GetHired?",
      answer:
        "Yes. Invite cofounders, hiring managers and interviewers by email. Owners have full access and everyone else gets a role built from permissions. Your plan includes a number of team seats.",
    },
    {
      question: "Can I limit someone to the jobs they work on?",
      answer:
        "Yes. Most permissions can be granted for all jobs or only the jobs a person is assigned to through a job's hiring team.",
    },
    {
      question: "What roles are available?",
      answer:
        "Start from templates such as Admin, Member and Hiring manager and adjust them, or build custom roles from a list of permissions covering jobs, applications, candidates, outreach, interviews, the careers page and the agent.",
    },
    {
      question: "Is there an audit log?",
      answer:
        "Yes. It records who changed a role, invited or removed a member, changed permissions or edited important settings. You can also set a monthly usage cap per role.",
    },
    {
      question: "Does the recruiter agent respect roles?",
      answer:
        "Yes. The agent acts as the person using it, so it can only do what their role allows on the jobs they can see.",
    },
  ],
} as const;

export type CompanyPageKey = keyof typeof COMPANY_FAQS;

/** The hub every company page sits under. */
export const HIRE_PATH = "/hire";

type CompanyFeatures = NonNullable<LandingPageCopy["features"]>;

const feature = (
  agentPrompt: string,
  heading: string,
  subheading: string,
  items: CompanyFeatures["items"],
): CompanyFeatures => ({ heading, subheading, items, agentPrompt, audience: "company" });

/**
 * Cross-links shown on the page and in its markdown. Every company page links
 * to a few siblings and back to the hub, so crawlers and readers can move
 * between them.
 */
const links = (...items: [path: string, label: string][]): MarketingLink[] => [
  ...items.map(([path, label]) => ({ label, href: path })),
  { label: "GetHired for hiring teams", href: HIRE_PATH },
  PRICING,
];

export const COMPANY_LANDING_PAGES: Record<CompanyPageKey, LandingPageCopy> = {
  "ai-recruiter-agent": {
    path: "/hire/ai-recruiter-agent",
    description:
      "An AI recruiter you chat with. It drafts job posts, ranks matched candidates, reviews applicants, moves your pipeline and sends outreach, and asks before anything goes out.",
    heading: "An AI Recruiter Agent That Works From One Chat",
    subheading: () =>
      "Tell it who you need. It writes the job post, finds and ranks candidates, reviews applicants and keeps your pipeline moving. You approve everything that reaches a candidate.",
    ctas: [START_FREE, { label: "Chat with the agent", href: COMPANY_AGENT_PATH }],
    faq: "ai-recruiter-agent",
    features: feature(
      "Help me post a new job. Ask me about the role first.",
      "What the recruiter agent does",
      "The work of a recruiter, as a conversation instead of a set of screens.",
      [
        {
          name: "Drafts job posts",
          description:
            "Describe the role and it drafts the summary, responsibilities, requirements and application questions. Edit in the chat, then approve to publish.",
        },
        {
          name: "Finds and ranks candidates",
          description:
            "Ask for the best candidates for a role and it returns a ranked list with a match score and a reason for each. Narrow it in plain language, such as \"only people open to Bengaluru or remote\".",
        },
        {
          name: "Reviews your applicants",
          description:
            "It reads the AI screening results and summarises who applied this week, who is strongest and who needs a second look.",
        },
        {
          name: "Moves your pipeline",
          description:
            "\"Move the top four to Interview and send our invite.\" It prepares the moves and the emails from your templates and shows you before anything is sent.",
        },
        {
          name: "Writes outreach and invites interviews",
          description:
            "It drafts a short message for each matched candidate and can invite applicants above your fit threshold to an AI screening interview.",
        },
        {
          name: "Remembers how you hire",
          description:
            "Tell it your hiring bar, process and compensation bands once and it keeps them as memories you can see, edit and delete. It won't save anything about a candidate's protected characteristics.",
        },
        {
          name: "Asks before it acts",
          description:
            "Publishing, emailing, moving applications, invites and team changes show an approval card with the exact content first. It follows each person's role and works only with your company's data.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-job-description-generator", "AI job description generator"],
      ["/hire/ai-candidate-matching", "AI candidate matching"],
      ["/hire/ai-applicant-screening", "AI applicant screening"],
      ["/mcp-server/companies", "Use the agent from Claude or Cursor"],
      ["/blog/meet-the-gethired-recruiter-agent-hire-tech-talent-from-one-chat", "Meet the recruiter agent"],
    ),
  },
  "ai-job-description-generator": {
    path: "/hire/ai-job-description-generator",
    description:
      "Generate a job description with AI. Describe the role in plain English and GetHired drafts the full job post and application questions for you to edit and approve.",
    heading: "An AI Job Description Generator for Any Role",
    subheading: () =>
      "Describe the role and the agent drafts the whole job post: summary, responsibilities, requirements and application questions. Edit it, approve it and it's live.",
    ctas: [
      START_FREE,
      {
        label: "Draft a job post",
        href: askAgent("Create a job post for the role I'm hiring for. Ask me about the role first."),
      },
    ],
    faq: "ai-job-description-generator",
    features: feature(
      "Create a job post for the role I'm hiring for. Ask me about the role first.",
      "From a sentence to a job post",
      "Write it once in plain English. Fine-tune it with a few messages.",
      [
        {
          name: "Drafts the whole post",
          description:
            "Summary, responsibilities, requirements and the application questions, from a short description of the role.",
        },
        {
          name: "Asks for what it's missing",
          description:
            "Location, salary range and must-have skills, so the post isn't generic and applicants know what to expect.",
        },
        {
          name: "Edit by chatting",
          description:
            "\"Make it remote-first and drop the Kubernetes requirement.\" Change the draft with a message, or edit the post by hand.",
        },
        {
          name: "Application form built in",
          description:
            "Each post can carry a custom form with typed questions, required or optional fields and private knockout rules. Reuse a group of questions across jobs as a question set.",
        },
        {
          name: "Fair by default",
          description:
            "Question text is checked when you save it, and questions about protected characteristics such as age or religion are refused.",
        },
        {
          name: "You approve before it's live",
          description:
            "The draft shows in an approval card. Nothing is published until you say so, and every published job gets a page on your careers page and in GetHired's job search.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-recruiter-agent", "AI recruiter agent"],
      ["/hire/careers-page-builder", "Careers page and application form builder"],
      ["/hire/job-multiposting", "Job multiposting"],
      ["/blog/how-to-write-a-software-engineer-job-description-that-attracts-the-right-applicants-template", "Job description template"],
    ),
  },
  "ai-candidate-matching": {
    path: "/hire/ai-candidate-matching",
    description:
      "Find the right candidates for each job. GetHired matches your job to public candidate profiles, scores each from 0 to 100 and explains strengths, gaps and conflicts.",
    heading: "AI Candidate Matching That Explains Every Match",
    subheading: () =>
      "Post a job and GetHired matches it against candidates who want to be found. Each one gets a score and a plain-language reason, so you know why someone is on the list.",
    ctas: [START_FREE, PRICING],
    faq: "ai-candidate-matching",
    features: feature(
      "Find the best candidates for my open job and tell me why each one fits.",
      "How matching works",
      "Meaning over keywords, with the reasoning visible.",
      [
        {
          name: "Matches by meaning, not keywords",
          description:
            "Semantic search finds people whose work fits the role even when the words differ, then an AI re-ranking step orders them.",
        },
        {
          name: "A 0 to 100 score with a reason",
          description:
            "Open a candidate to see strengths, gaps and conflicts, such as \"wants remote; this job is onsite in Pune\".",
        },
        {
          name: "Candidates who chose to be found",
          description:
            "Matches come from profiles candidates made public. Contact details and the resume file are shared with you only after they apply or reply Interested.",
        },
        {
          name: "Plain-language filters",
          description:
            "Ask the agent for \"at least 5 years with Go\" or \"under 40 LPA\" and it narrows the list. It refuses to filter by protected characteristics.",
        },
        {
          name: "Compare your top picks",
          description:
            "Ask for a side-by-side of your top three on the things that matter for the role: skills against must-haves, experience, preferences and risks.",
        },
        {
          name: "Your own candidates too",
          description:
            "Each job shows a \"From your candidates\" list ranked by similarity from the people you've imported, and a weekly email lists new matches for each active job.",
        },
      ],
    ),
    related: links(
      ["/hire/talent-pool", "Talent pool software"],
      ["/hire/candidate-outreach", "Candidate outreach"],
      ["/hire/ai-recruiter-agent", "AI recruiter agent"],
      ["/blog/fair-ai-hiring-how-gethired-keeps-bias-out-of-candidate-screening", "Fair AI hiring"],
    ),
  },
  "talent-pool": {
    path: "/hire/talent-pool",
    description:
      "Turn old resumes and spreadsheets into a searchable talent pool. Import candidates, match them to every new job and group them into shortlists with notes and ratings.",
    heading: "Talent Pool Software for Candidates You Already Have",
    subheading: () =>
      "Import past applicants, finalists and referrals once. When a new role opens, GetHired shows who in your pool fits it, instead of starting from zero.",
    ctas: [START_FREE, PRICING],
    faq: "talent-pool",
    features: feature(
      "Show me candidates in my talent pool who fit my open job.",
      "A candidate database that works for you",
      "Stop losing good people in inboxes and old spreadsheets.",
      [
        {
          name: "Import resumes in bulk",
          description:
            "Upload resumes, or a spreadsheet of names, contact details, titles and skills. Each person becomes a candidate only your company can see.",
        },
        {
          name: "Add candidates one at a time",
          description:
            "Met someone at an event or got a referral? Add them by hand so they're in the pool when the right role opens.",
        },
        {
          name: "Searchable by meaning",
          description:
            "Search the pool in plain language instead of guessing exact keywords.",
        },
        {
          name: "Matched to every new job",
          description:
            "Open a job and see a \"From your candidates\" list ranked by similarity to the role.",
        },
        {
          name: "Talent lists",
          description:
            "Group candidates into named lists such as \"Backend shortlist\", and leave notes and ratings on anyone in the pool.",
        },
        {
          name: "Invite, don't assume",
          description:
            "Adding a pool candidate to a job's pipeline sends them an outreach invite rather than creating an application on their behalf.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-candidate-matching", "AI candidate matching"],
      ["/hire/candidate-outreach", "Candidate outreach"],
      ["/hire/applicant-tracking-system", "Applicant tracking system"],
      ["/blog/candidate-rediscovery-how-to-turn-old-resumes-and-spreadsheets-into-a-searchable-talent-pool", "Candidate rediscovery guide"],
    ),
  },
  "candidate-outreach": {
    path: "/hire/candidate-outreach",
    description:
      "Reach candidates who want to be found. Send an invite or a short note from a matched profile and see their Interested or Not interested reply, with consent-based contact sharing.",
    heading: "Candidate Outreach That Gets Replies",
    subheading: () =>
      "Message matched candidates from their profile. They answer Interested or Not interested, and you get their contact details only after they say yes.",
    ctas: [START_FREE, PRICING],
    faq: "candidate-outreach",
    features: feature(
      "Write to my top two matches and ask if they're open to a chat.",
      "Outreach built on consent",
      "Every candidate you reach chose to be found.",
      [
        {
          name: "Two ways to reach out",
          description:
            "Invite someone to apply to a job, or send a short note asking if they're open to a chat.",
        },
        {
          name: "Interested or Not interested",
          description:
            "The candidate replies in their GetHired dashboard and you see the answer on your outreach page and in the agent chat.",
        },
        {
          name: "Contact details after consent",
          description:
            "Email, phone and the resume file are shared only after the candidate applies or says Interested.",
        },
        {
          name: "Messages grounded in the match",
          description:
            "The agent drafts a short, specific note from why each person matched. Each outreach goes to one candidate and waits for your approval.",
        },
        {
          name: "Limits that protect your team",
          description:
            "Outreach uses your plan's monthly allowance, and an owner can cap it per role so one person can't use the lot.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-candidate-matching", "AI candidate matching"],
      ["/hire/talent-pool", "Talent pool software"],
      ["/hire/ai-recruiter-agent", "AI recruiter agent"],
      ["/blog/recruiting-outreach-messages-that-get-replies-8-templates-for-tech-candidates", "Outreach message templates"],
    ),
  },
  "ai-applicant-screening": {
    path: "/hire/ai-applicant-screening",
    description:
      "Screen applicants with AI. Every application gets a 0 to 100 fit score, a recommendation, a must-have check with evidence and feedback on answers, so you start with the strongest.",
    heading: "AI Applicant Screening That Sorts by Fit",
    subheading: () =>
      "Every application is scored against your job in the background. Sort two hundred applicants by fit and start at the top. You still make every decision.",
    ctas: [START_FREE, PRICING],
    faq: "ai-applicant-screening",
    features: feature(
      "Summarise who applied to my open job this week and who I should talk to first.",
      "What each applicant gets",
      "Evidence you can check, not just a number.",
      [
        {
          name: "A fit score from 0 to 100",
          description:
            "Sort and filter the applicants table by fit, and open anyone to see how the score was reached.",
        },
        {
          name: "A recommendation and summary",
          description:
            "Strong yes, yes, maybe or no, with a short summary of why.",
        },
        {
          name: "Must-have requirements, checked",
          description:
            "Each must-have is checked against the resume, with the evidence it found.",
        },
        {
          name: "Feedback on their answers",
          description:
            "Typed screening answers are graded, and you can filter by what people answered.",
        },
        {
          name: "Knockout rules you write",
          description:
            "For true requirements, such as the right to work in a country, add a rule to a yes/no or choice question. Applicants never see the rules.",
        },
        {
          name: "Fair by design",
          description:
            "The models never see names, photos, age, gender or other protected characteristics. The AI never rejects anyone on its own, and every score is labelled as AI-generated.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-screening-interviews", "AI screening interviews"],
      ["/hire/applicant-tracking-system", "Applicant tracking system"],
      ["/hire/careers-page-builder", "Application form builder"],
      ["/blog/ai-applicant-screening-how-to-sort-200-applicants-by-fit-without-reading-them-all", "How the fit score works"],
      ["/blog/knockout-questions-how-to-screen-out-unqualified-applicants-without-losing-good-ones", "Knockout questions guide"],
    ),
  },
  "ai-screening-interviews": {
    path: "/hire/ai-screening-interviews",
    description:
      "Replace first-round phone screens with an AI screening interview. Applicants take a structured voice interview in their browser and you read a one-page report with quotes.",
    heading: "AI Screening Interviews Instead of Phone Screens",
    subheading: () =>
      "Add a short voice interview to a job. Strong applicants take it in their browser, and you read a one-page report scored against your competencies.",
    ctas: [START_FREE, PRICING],
    faq: "ai-screening-interviews",
    features: feature(
      "Invite every applicant above 75 to the AI interview for my open job.",
      "How an AI screening interview works",
      "The first call is the most expensive part of hiring. This takes the calendar out of it.",
      [
        {
          name: "You set it up on the job",
          description:
            "Choose the must-ask questions, up to five competencies to score, the interview length and how many days candidates have to take it. Save question sets to reuse.",
        },
        {
          name: "Invite by fit threshold",
          description:
            "Applicants at or above your fit score are invited automatically, or invite people by hand, up to 50 at a time.",
        },
        {
          name: "The same structure for everyone",
          description:
            "A voice interviewer covers your questions, follows up on vague answers and keeps to time, so reports are comparable.",
        },
        {
          name: "A one-page report",
          description:
            "A score per competency, short quotes as evidence, concerns worth probing and follow-up questions for your own interview.",
        },
        {
          name: "Evidence is verified",
          description:
            "Quotes that don't appear word for word in the transcript are removed before you see them, and each candidate gets one attempt plus one retry for technical failures.",
        },
        {
          name: "Pay for completed interviews",
          description:
            "Interview minutes are reserved when you invite and charged only when the candidate finishes. They are released if the invite expires or is cancelled.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-applicant-screening", "AI applicant screening"],
      ["/hire/interview-scheduling", "Interview scheduling"],
      ["/hire/applicant-tracking-system", "Applicant tracking system"],
      ["/blog/ai-screening-interviews-replace-30-phone-screens-with-one-page-reports", "AI screening interviews guide"],
    ),
  },
  "applicant-tracking-system": {
    path: "/hire/applicant-tracking-system",
    description:
      "A free-to-start applicant tracking system for startups and small teams. Custom pipelines, a drag-and-drop board, bulk moves, notes, email templates and a hiring funnel.",
    heading: "A Lightweight Applicant Tracking System for Startups",
    subheading: () =>
      "Run hiring from one pipeline instead of a spreadsheet. Every stage move, email and note is recorded, and it needs no setup beyond posting a job.",
    ctas: [START_FREE, PRICING],
    faq: "applicant-tracking-system",
    features: feature(
      "Show me my hiring pipeline and which applicants need attention.",
      "The parts of an ATS a small team actually uses",
      "Everything you need to run a hiring process, none of the weeks of setup.",
      [
        {
          name: "Pipeline stages you control",
          description:
            "Start with Applied, Screening, Interview, Offer and Hired, plus Rejected and On hold. Rename, reorder and add your own, up to 12.",
        },
        {
          name: "List and board views",
          description:
            "A sortable table filtered by stage, fit or answers, or a drag-and-drop board with fit score, days in stage, notes and AI interview status on each card.",
        },
        {
          name: "Bulk moves with optional emails",
          description:
            "Move up to 50 applicants to a stage at once. When the move changes what the candidate sees, it offers a templated email with a preview.",
        },
        {
          name: "Notes, ratings and a timeline",
          description:
            "Notes in markdown with a rating from strong no to strong yes, and a timeline of every move, email, screening and interview with who did it.",
        },
        {
          name: "Email templates with your scheduling link",
          description:
            "Editable templates for rejection, moving forward, interview invites and offers, with variables such as the candidate's first name and your scheduling link.",
        },
        {
          name: "A hiring funnel",
          description:
            "Candidates per stage, conversion between stages, median days in each stage, source of candidates and time to hire. A needs-attention list flags applications that have sat in Applied for days.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-applicant-screening", "AI applicant screening"],
      ["/hire/interview-scheduling", "Interview scheduling"],
      ["/hire/hiring-team-collaboration", "Hiring team collaboration"],
      ["/blog/a-lightweight-ats-for-startups-pipeline-stages-boards-notes-and-email-templates", "ATS guide for startups"],
      ["/blog/recruiting-metrics-for-startups-time-to-hire-funnel-conversion-and-source-of-hire", "Recruiting metrics for startups"],
    ),
  },
  "interview-scheduling": {
    path: "/hire/interview-scheduling",
    description:
      "Plan interview rounds, schedule panels, send self-scheduling links and collect scorecards. Sync interviews with Google Calendar and keep feedback in one place.",
    heading: "Interview Scheduling and Scorecards for Hiring Teams",
    subheading: () =>
      "Plan each job's interview rounds, put a panel on the calendar or let the candidate pick a time, and collect a scorecard from every interviewer.",
    ctas: [START_FREE, PRICING],
    faq: "interview-scheduling",
    features: feature(
      "Plan the interview rounds for my open job and schedule the next interview.",
      "From interview plan to scorecard",
      "One place for who interviews whom, when, and what they thought.",
      [
        {
          name: "An interview plan per job",
          description:
            "Define each round with a name, a length from 15 to 240 minutes, the competencies it covers, questions and default interviewers. Up to 20 interviews per job.",
        },
        {
          name: "Panels of up to six",
          description:
            "Schedule an interview with one to six people from your team and record the meeting link.",
        },
        {
          name: "Self-scheduling links",
          description:
            "Send the candidate a link to pick a time, so there's no back-and-forth over email.",
        },
        {
          name: "Google Calendar sync",
          description:
            "Connect a Google Calendar and scheduled interviews are kept in step with it, including reschedules and cancellations.",
        },
        {
          name: "Interview kits and scorecards",
          description:
            "Each interviewer gets a kit for the interview and writes a scorecard against the competencies. Scorecards stay blind for a window after the interview so ratings are independent, and you can remind interviewers who haven't submitted.",
        },
        {
          name: "Ask the agent",
          description:
            "\"Find a slot for Priya with the engineering panel.\" The agent can draft a plan, schedule, reschedule and remind interviewers, and asks before it acts.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-screening-interviews", "AI screening interviews"],
      ["/hire/applicant-tracking-system", "Applicant tracking system"],
      ["/hire/hiring-team-collaboration", "Hiring team collaboration"],
      ["/blog/structured-interviews-for-tech-hiring-how-to-build-scorecards-and-rubrics", "Structured interviews guide"],
    ),
  },
  "careers-page-builder": {
    path: "/hire/careers-page-builder",
    description:
      "Build a branded careers page and custom application forms without a developer. Publish at your own address with search and filters, perks, sections and knockout questions.",
    heading: "A Careers Page Builder With Custom Application Forms",
    subheading: () =>
      "Publish a branded careers page in minutes. It lists your open roles with search and filters, and each job can have its own application form.",
    ctas: [START_FREE, PRICING],
    faq: "careers-page-builder",
    features: feature(
      "Help me set up my company's careers page.",
      "Your careers page and application forms",
      "A page that's always current, because it's built from your jobs.",
      [
        {
          name: "Your own address",
          description:
            "Claim a slug such as gethired.devhub.co.in/careers/acme. If you change it later the old address redirects, so shared links keep working.",
        },
        {
          name: "Branded header and sections",
          description:
            "Logo, tag line, optional cover image, website and social links, an About section, up to 12 perks and up to three custom sections such as \"How we hire\".",
        },
        {
          name: "A searchable jobs list",
          description:
            "Keyword search and filters for location, job type, workplace type, experience and minimum salary. Filters live in the address, so you can link to \"all remote roles\".",
        },
        {
          name: "Always up to date",
          description:
            "The page updates the moment you publish, edit or close a job. Preview before you publish and unpublish any time.",
        },
        {
          name: "Custom application forms",
          description:
            "Text, choice, yes/no, number, date and URL questions, each required or optional with help text. Save question sets and reuse them across jobs.",
        },
        {
          name: "Knockout rules, kept private",
          description:
            "Add a rule to a yes/no or choice question for a firm requirement. Applicants never see the rules, and questions about protected characteristics are refused.",
        },
      ],
    ),
    related: links(
      ["/hire/ai-job-description-generator", "AI job description generator"],
      ["/hire/job-multiposting", "Job multiposting"],
      ["/hire/ai-applicant-screening", "AI applicant screening"],
      ["/blog/build-a-branded-careers-page-and-custom-application-form-in-minutes", "Careers page guide"],
    ),
  },
  "job-multiposting": {
    path: "/hire/job-multiposting",
    description:
      "Post a job once and reach more candidates. GetHired submits jobs to Google and Bing and sends feeds to job boards you switch on, with per-job status for each board.",
    heading: "Job Multiposting From One Job Post",
    subheading: () =>
      "Publish once on GetHired. Your job is submitted to Google and Bing, and you choose which job boards get it, for the whole company or job by job.",
    ctas: [START_FREE, PRICING],
    faq: "job-multiposting",
    features: feature(
      "Show me where my open jobs are published.",
      "One post, more places to be found",
      "Control where each job appears, and see where it is live.",
      [
        {
          name: "Google for Jobs and Bing",
          description:
            "Published jobs are submitted to Google and Bing for indexing, so they can appear in search results. This is always on.",
        },
        {
          name: "Job board feeds",
          description:
            "Switch on feeds for boards such as Jooble, Adzuna, Talent.com and ZipRecruiter once, for all your jobs. A board shows jobs after it has approved GetHired.",
        },
        {
          name: "Bring your own board account",
          description:
            "Boards that work through your own account, such as Naukri, are connected on the Distribution page.",
        },
        {
          name: "Opt a job out",
          description:
            "A job can leave itself out of an active board without changing the company-wide switch.",
        },
        {
          name: "Status for every channel",
          description:
            "Each job's Distribution page shows whether it is live, queued, waiting for the board, off, opted out or in error, and why.",
        },
        {
          name: "Applications come back to one pipeline",
          description:
            "Boards that accept applications on their own site can send them to GetHired, where they join the same pipeline and screening as everyone else.",
        },
      ],
    ),
    related: links(
      ["/hire/careers-page-builder", "Careers page builder"],
      ["/hire/ai-job-description-generator", "AI job description generator"],
      ["/hire/applicant-tracking-system", "Applicant tracking system"],
    ),
  },
  "hiring-team-collaboration": {
    path: "/hire/hiring-team-collaboration",
    description:
      "Hire as a team with custom roles, permissions, hiring teams per job, usage caps and an audit log. Give each person the access they need and nothing more.",
    heading: "Hiring Team Collaboration With Roles and Permissions",
    subheading: () =>
      "Invite cofounders, hiring managers and interviewers. Decide what each person can do, and limit them to the jobs they work on.",
    ctas: [START_FREE, PRICING],
    faq: "hiring-team-collaboration",
    features: feature(
      "Invite a hiring manager to my open job and show me what they can do.",
      "Access that fits how you hire",
      "From a two-founder team to a hiring panel.",
      [
        {
          name: "Invite by email",
          description:
            "Invite people from Settings, resend or revoke pending invites, or ask the agent. It always asks before sending an invite.",
        },
        {
          name: "Roles built from permissions",
          description:
            "Start from Admin, Member or Hiring manager and adjust, or build a role from permissions across jobs, applications, candidates, outreach, interviews, the careers page and the agent.",
        },
        {
          name: "Hiring teams per job",
          description:
            "Grant most permissions for all jobs or only the jobs a person is assigned to, from a job's Hiring team section or in bulk.",
        },
        {
          name: "Usage caps per role",
          description:
            "Set a monthly cap on allowances such as outreach, AI interviews and agent messages so one person doesn't use the whole company's share.",
        },
        {
          name: "An audit log",
          description:
            "See who changed a role, invited or removed a member, changed permissions or edited important settings.",
        },
        {
          name: "The agent follows the same rules",
          description:
            "The recruiter agent acts as the person using it, and tells them which permission is missing when something isn't allowed.",
        },
      ],
    ),
    related: links(
      ["/hire/applicant-tracking-system", "Applicant tracking system"],
      ["/hire/ai-recruiter-agent", "AI recruiter agent"],
      ["/hire/interview-scheduling", "Interview scheduling"],
      ["/blog/hiring-as-a-team-custom-roles-permissions-and-hiring-teams-on-gethired", "Hiring as a team guide"],
    ),
  },
};

/** Each page's browser title, structured-data name, keywords and hero pill. */
export const COMPANY_PAGE_SEO: Record<
  CompanyPageKey,
  { title: string; keywords: string[]; eyebrowDetail: string }
> = {
  "ai-recruiter-agent": {
    title: "AI Recruiter Agent for Hiring Teams",
    keywords: [
      "ai recruiter",
      "ai recruiting agent",
      "ai recruiting software",
      "ai recruiting assistant",
      "recruiter agent",
      "conversational ai hiring",
    ],
    eyebrowDetail: "Post a job and screen applicants in one chat",
  },
  "ai-job-description-generator": {
    title: "AI Job Description Generator",
    keywords: [
      "ai job description generator",
      "job description generator",
      "ai job post writer",
      "write a job description",
      "job posting generator",
      "job post template",
    ],
    eyebrowDetail: "Draft a job post from a few sentences",
  },
  "ai-candidate-matching": {
    title: "AI Candidate Matching and Sourcing",
    keywords: [
      "ai candidate matching",
      "ai candidate sourcing",
      "candidate sourcing software",
      "find candidates for a job",
      "ai talent matching",
      "semantic candidate search",
    ],
    eyebrowDetail: "Find the best candidates and see why they fit",
  },
  "talent-pool": {
    title: "Talent Pool Software and Candidate Database",
    keywords: [
      "talent pool software",
      "candidate database",
      "candidate rediscovery",
      "resume database",
      "import resumes",
      "talent pipeline software",
    ],
    eyebrowDetail: "Match your existing candidates to your open job",
  },
  "candidate-outreach": {
    title: "Candidate Outreach and Recruiting Messages",
    keywords: [
      "candidate outreach",
      "recruiting outreach",
      "recruiter outreach messages",
      "consent based recruiting",
      "passive candidate outreach",
      "reach out to candidates",
    ],
    eyebrowDetail: "Draft outreach to your top matches",
  },
  "ai-applicant-screening": {
    title: "AI Applicant Screening and Resume Ranking",
    keywords: [
      "ai applicant screening",
      "ai resume screening",
      "resume screening software",
      "candidate screening software",
      "rank applicants by fit",
      "knockout questions",
    ],
    eyebrowDetail: "Ask who applied and who to talk to first",
  },
  "ai-screening-interviews": {
    title: "AI Screening Interviews for Hiring",
    keywords: [
      "ai screening interview",
      "ai interview agent",
      "ai interviewing software",
      "candidate pre-screening",
      "automated phone screen",
      "ai voice interview for hiring",
    ],
    eyebrowDetail: "Invite your strongest applicants to an AI interview",
  },
  "applicant-tracking-system": {
    title: "Applicant Tracking System for Startups",
    keywords: [
      "applicant tracking system for startups",
      "small business ats",
      "free applicant tracking system",
      "lightweight ats",
      "hiring pipeline software",
      "recruiting pipeline board",
    ],
    eyebrowDetail: "Show your pipeline and what needs attention",
  },
  "interview-scheduling": {
    title: "Interview Scheduling and Scorecards",
    keywords: [
      "interview scheduling software",
      "interview scorecards",
      "panel interview scheduling",
      "interview plan template",
      "self scheduling interviews",
      "google calendar interview scheduling",
    ],
    eyebrowDetail: "Plan rounds and schedule your next interview",
  },
  "careers-page-builder": {
    title: "Careers Page Builder and Application Forms",
    keywords: [
      "careers page builder",
      "career page builder",
      "branded careers page",
      "custom application form",
      "job application form builder",
      "company careers page",
    ],
    eyebrowDetail: "Set up your careers page with the agent",
  },
  "job-multiposting": {
    title: "Job Multiposting to Google and Job Boards",
    keywords: [
      "job multiposting",
      "post jobs to multiple job boards",
      "free job posting sites",
      "google for jobs posting",
      "job distribution software",
      "job board feeds",
    ],
    eyebrowDetail: "See where your jobs are published",
  },
  "hiring-team-collaboration": {
    title: "Hiring Team Collaboration and Permissions",
    keywords: [
      "hiring team collaboration",
      "recruiting team permissions",
      "hiring manager access",
      "ats roles and permissions",
      "collaborative hiring software",
      "recruiting audit log",
    ],
    eyebrowDetail: "Invite a hiring manager to a job",
  },
};

export const COMPANY_PAGE_KEYS = Object.keys(COMPANY_LANDING_PAGES) as CompanyPageKey[];
