# GetHired: application flows

A map of every end-to-end flow on the applicant and company sides. For each flow it lists the server actions, route handlers, tables, RPCs, triggers, queues and crons it touches. Up to date as of 2026-10-21.

New here? Read [The whole system](#the-whole-system) below, then the journey diagram at the top of [02-applicant](02-applicant.md) or [03-company](03-company.md).

| File | What's in it |
|---|---|
| [01-platform.md](01-platform.md) | Auth and routing, sign-up, the read-only browser client, job ingestion and embeddings, API keys / MCP / extension, public pages |
| [02-applicant.md](02-applicant.md) | Applicant flows A1–A13 |
| [03-company.md](03-company.md) | Company flows C1–C14 |
| [04-background-jobs.md](04-background-jobs.md) | Every queue and cron: producer → queue → worker → effect |
| [05-inventory.md](05-inventory.md) | Tables, RPCs, triggers, routes and server actions, grouped by flow |

## Legend

```mermaid
flowchart LR
  UI["Page / component"]:::ui --> SA["Server action (app/actions)"]:::sa
  UI --> RH["Route handler (app/api)"]:::rh
  SA --> H["Helper (helpers/*)"]:::h
  RH --> H
  H --> DB[("Table / RPC")]:::db
  DB -. "trigger" .-> Q[["pgmq queue"]]:::q
  C(("cron")):::c --> W["Worker route"]:::rh
  W --> Q
  H --> X{{"External: Gemini / Resend / Dodo / Voice / Rerank"}}:::x
  classDef ui fill:#e0e7ff,stroke:#4f46e5,color:#111
  classDef sa fill:#dcfce7,stroke:#16a34a,color:#111
  classDef rh fill:#fef9c3,stroke:#ca8a04,color:#111
  classDef h fill:#f3f4f6,stroke:#6b7280,color:#111
  classDef db fill:#fee2e2,stroke:#dc2626,color:#111
  classDef q fill:#fae8ff,stroke:#a21caf,color:#111
  classDef c fill:#ffedd5,stroke:#ea580c,color:#111
  classDef x fill:#e0f2fe,stroke:#0284c7,color:#111
```

## The whole system

```mermaid
flowchart TB
  subgraph Clients
    APP["Browser: applicant pages"]
    CO["Browser: company pages"]
    EXT["Browser extension"]
    MCP["MCP server (gh_ token / OAuth)"]
    PUB["Public: /, /hire, /jobs, /careers/[slug], /blog<br/>+ markdown copies (/hire.md, /blog/[slug].md)"]
  end

  MW["middleware.ts → updateSession<br/>markdown rewrite, publicPaths, role + onboarding redirects, gh_ token gate"]

  subgraph Next["Next.js on Cloud Run"]
    SA["Server actions (~115)<br/>every write from the browser"]
    API["Route handlers (/api/*)"]
    AG["Agent: /api/agent/chat<br/>applicant + recruiter roles"]
    WK["Cron / worker routes<br/>/api/updates/** /api/worker/** /api/update-embedding/**"]
    INT["Internal routes /api/internal/*"]
  end

  subgraph Supabase
    AUTH["Auth (app_metadata.type)"]
    PG[("Postgres: ~67 tables, ~170 functions, RLS + column guards")]
    TRG["Triggers"]
    PGMQ[["pgmq: 14 queues"]]
    CRON(("pg_cron + pg_net"))
    ST["Storage (resumes, logos, careers)"]
  end

  subgraph External
    GEM{{"Gemini (text + embeddings)"}}
    RR{{"Rerank service (JEV)"}}
    VOICE{{"Voice server"}}
    DODO{{"Dodo Payments"}}
    RES{{"Resend email"}}
    SCR{{"Job scraper"}}
    SCH{{"External scheduler"}}
    PH{{"PostHog / Arize"}}
  end

  APP & CO & EXT & MCP & PUB --> MW --> SA & API & AG
  APP & CO -. "reads only" .-> PG
  SA & API & AG --> PG
  PG --> TRG --> PGMQ
  SA & API --> PGMQ
  CRON -- "net.http_get + X-Internal-Secret" --> WK
  SCH -- "X-Internal-Secret" --> WK
  WK --> PGMQ
  WK --> PG
  SCR -- "writes all_jobs directly" --> PG
  VOICE -- "transcript callback" --> INT
  INT --> PG
  DODO -- "webhook" --> API
  SA & API & WK & AG --> GEM
  API & WK --> RR
  API --> VOICE
  SA & WK --> RES
  AG --> PH
  SA & API --> AUTH
  SA & API --> ST
```

## Flow index

```mermaid
mindmap
  root((GetHired))
    Platform
      P1 Auth + routing
      P2 Sign-up + user rows
      P3 Read-only browser, writes via actions
      P4 Job ingestion + embeddings
      P5 API keys / MCP / OAuth
      P6 Extension
      P7 Public pages, blog, markdown
    Applicant
      A1 Onboarding
      A2 Job discovery + search
      A3 Job page tools
      A4 Apply
      A5 Resumes
      A6 Resume review
      A7 Practice interview
      A8 Screening interview
      A9 Outreach inbox
      A10 Credits + payments
      A11 Email crons
      A12 Agent
      A13 Settings
    Company
      C1 Onboarding + seeding
      C2 Team + roles
      C3 Job posts + forms
      C4 Application intake
      C5 AI screening
      C6 Pipeline
      C7 Notes + mentions
      C8 Candidate search + matching
      C9 Outreach
      C10 Screening interviews
      C11 Notifications
      C12 Billing
      C13 Careers page
      C14 Recruiter agent
```
