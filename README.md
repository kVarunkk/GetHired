# GetHired: Your Smartest Path To The Perfect Job

[**GetHired**](https://gethired.devhub.co.in) is a modern, full-stack platform engineered to eliminate friction in the tech hiring market. We leverage Generative AI and vector search to provide unparalleled relevance, matching job seekers with ideal roles and enabling companies to hire quality talent instantly.

## Core Value Proposition

We are building the **Hyper-Personalized Job Feed**. We don't just search for keywords; we use conversational AI to understand user intent and match profiles based on skills, experience, and motivation.

## Key Features and Benefits

### For Job Seekers (Finding the Right Fit)

| **Feature**                   | **Benefit**                                                                                                              |
| :---------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **Natural Language Search**   | Type your dream job in plain English (e.g., "Remote Python jobs in NYC, min $150k")—our AI builds the filters instantly. |
| **Personalized AI Matching**  | Uses vector embeddings of your resume/profile to rank job relevance, ensuring you see the best roles first.              |
| **Daily Job Digest**          | Receive a curated email digest of the top most suitable jobs, reducing time spent scrolling.                             |
| **Simplified Authentication** | One-click login with Google; no separate passwords or complex forms required.                                            |
| **Full Application Tracking** | Manage and track the status of all your applications (Submitted, Reviewed, Interview, etc.).                             |

### For Companies (Finding the Right Candidate)

| **Feature**                    | **Benefit**                                                                                                    |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------- |
| **AI Candidate Re-Ranking**    | Upload a job description and instantly re-rank applicants based on technical alignment and fit.                |
| **Instant Candidate Insights** | Quickly find the perfect match by filtering and searching candidate profiles based on AI-derived data.         |
| **Dedicated ATS Dashboard**    | Streamlined management interface to view applications, update status, and manage interview pipelines.          |
| **Secure Resume Handling**     | Resumes are managed securely in private Supabase Storage buckets, accessible only by authorized company users. |

## How the App Works

The [application flow docs](docs/app-flows/README.md) map every end-to-end flow as diagrams. For each one you can see the pages, server actions, API routes, database tables, triggers, queues and background jobs it uses.

| **Doc**                                                   | **What it covers**                                                                                                  |
| :-------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| [System overview](docs/app-flows/README.md)               | The whole system on one diagram, plus an index of every flow.                                                       |
| [Platform](docs/app-flows/01-platform.md)                 | Auth and routing, sign-up, how writes are secured, job ingestion and embeddings, API keys / MCP, extension, public pages. |
| [Job seekers](docs/app-flows/02-applicant.md)             | Onboarding, job search, applying, resumes and reviews, practice and screening interviews, credits, the AI agent.     |
| [Companies](docs/app-flows/03-company.md)                 | Onboarding, team and roles, job posts, AI screening, pipeline, candidate search, outreach, billing, careers page, recruiter agent. |
| [Background jobs](docs/app-flows/04-background-jobs.md)   | Every queue and cron: what fills it, what processes it, and what it does.                                           |
| [Inventory](docs/app-flows/05-inventory.md)               | Tables, RPCs, triggers, routes and server actions, grouped by flow.                                                 |

## Technology Stack & Architecture

GetHired is built on a modern, high-performance stack designed for speed and scalability:

| **Layer**                | **Technology**                   | **Purpose**                                                                             |
| :----------------------- | :------------------------------- | :-------------------------------------------------------------------------------------- |
| **Frontend/UI**          | **Next.js (App Router)**         | Performant, server-first rendering and routing.                                         |
| **Styling/Components**   | **Tailwind CSS, Shadcn UI**      | Rapid, responsive design and accessibility-focused components.                          |
| **Authentication**       | **Supabase Auth / Google OAuth** | Secure, passwordless authentication and user management.                                |
| **Database/Storage**     | **Supabase (PostgreSQL)**        | Primary database, secure file storage, and real-time user preference tracking.          |
| **Vector Search Engine** | **`pgvector` (HNSW Index)**      | High-speed similarity search for job and user embeddings, run directly in the database. |
| **AI/LLM Processing**    | **Vercel AI SDK / FastAPI**      | Used for structured query parsing (Natural Language Search) and external AI re-ranking. |

## Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) (v18+ recommended) installed.

### Installation & Configuration

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create your `.env.local` file from the example template and fill in the required keys:
   ```bash
   cp .env.example .env.local
   ```

### Running the Project

Start the local development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.
