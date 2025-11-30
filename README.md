# GetHired: Your Smartest Path To The Perfect Job

[**GetHired**](https://gethired.devhub.co.in) is a modern, full-stack platform engineered to eliminate friction in the tech hiring market. We leverage Generative AI and vector search to provide unparalleled relevance, matching job seekers with ideal roles and enabling companies to hire quality talent instantly.

## Core Value Proposition

We are building the **Hyper-Personalized Job Feed**. We don't just search for keywords; we use conversational AI to understand user intent and match profiles based on skills, experience, and motivation.

## Key Features and Benefits

### For Job Seekers (Finding the Right Fit)

| **Feature** | **Benefit** |
| :--- | :--- |
| **Natural Language Search** | Type your dream job in plain English (e.g., "Remote Python jobs in NYC, min $150k")—our AI builds the filters instantly. |
| **Personalized AI Matching** | Uses vector embeddings of your resume/profile to rank job relevance, ensuring you see the best roles first. |
| **Weekly Job Digest** | Receive a curated email digest of the top 10 most suitable jobs, reducing time spent scrolling. |
| **Simplified Authentication** | One-click login with Google; no separate passwords or complex forms required. |
| **Full Application Tracking** | Manage and track the status of all your applications (Submitted, Reviewed, Interview, etc.). |

### For Companies (Finding the Right Candidate)

| **Feature** | **Benefit** |
| :--- | :--- |
| **AI Candidate Re-Ranking** | Upload a job description and instantly re-rank applicants based on technical alignment and fit. |
| **Instant Candidate Insights** | Quickly find the perfect match by filtering and searching candidate profiles based on AI-derived data. |
| **Dedicated ATS Dashboard** | Streamlined management interface to view applications, update status, and manage interview pipelines. |
| **Secure Resume Handling** | Resumes are managed securely in private Supabase Storage buckets, accessible only by authorized company users. |

## Technology Stack & Architecture

GetHired is built on a modern, high-performance stack designed for speed and scalability:

| **Layer** | **Technology** | **Purpose** |
| :--- | :--- | :--- |
| **Frontend/UI** | **Next.js (App Router)** | Performant, server-first rendering and routing. |
| **Styling/Components** | **Tailwind CSS, Shadcn UI** | Rapid, responsive design and accessibility-focused components. |
| **Authentication** | **Supabase Auth / Google OAuth** | Secure, passwordless authentication and user management. |
| **Database/Storage** | **Supabase (PostgreSQL)** | Primary database, secure file storage, and real-time user preference tracking. |
| **Vector Search Engine** | **`pgvector` (HNSW Index)** | High-speed similarity search for job and user embeddings, run directly in the database. |
| **AI/LLM Processing** | **Vercel AI SDK / FastAPI** | Used for structured query parsing (Natural Language Search) and external AI re-ranking. |
