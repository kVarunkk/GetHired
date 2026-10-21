# Platform flows

## P1. Request routing (`middleware.ts` → `lib/supabase/middleware.ts`)

```mermaid
flowchart TD
  R["Request"] --> MD{"/index.md, /hire.md,<br/>/blog/[slug].md … ?"}
  MD -- yes --> RW["rewrite to /md/… (P7), no auth"]
  MD -- no --> T{"Bearer gh_… ?"}
  T -- yes --> TA{"path starts with<br/>/api/user/profile, /api/jobs,<br/>/api/ai-search/jobs, /api/resumes,<br/>/api/resume-review ?"}
  TA -- no --> F403["403 JSON"]
  TA -- yes --> PASS["pass (route resolves token via<br/>createClient / getUserFromRequest → user_api_tokens)"]
  T -- no --> U["getUserFromRequest()"]
  U --> S{"signed in?"}
  S -- no --> P{"publicPaths or prefix<br/>/jobs/* /blog/* /companies/* /remote-jobs/*<br/>/sitemap/* /careers/* /api/careers/* ?"}
  P -- yes --> OK["serve"]
  P -- no --> LOGIN["302 /auth/login?returnTo=…<br/>(+ company=true for /company/*)"]
  S -- yes --> M{"app_metadata.type"}
  M -- "company on /" --> CH["302 /company<br/>(or onboarding if not done)"]
  M -- company, not onboarded --> GS["302 /get-started?company=true<br/>&returnTo=/company/… (companyOnboardingPath)"]
  M -- company --> CO{"/agent, /dashboard,<br/>/resume-review, applicant onboarding?"}
  CO -- yes --> CR["302 to company equivalent<br/>(/agent → /company/agent)"]
  CO -- no --> OK
  M -- applicant --> AP{"/company/* ?"}
  AP -- yes --> AR["302 applicant home"]
  AP -- no --> OK
```

`returnTo` is checked by `safeReturnPath` (`helpers/user/home-path.ts`), so only same-site paths are kept. After signing in, `login-form` calls `clearRouterCacheAction` so the browser doesn't replay a cached redirect to login.

## P2. Sign-up, email confirm, OAuth, invite sign-up

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant P as /auth/sign-up page
  participant SA as signUpEmail action<br/>(app/actions/sign-up-email.tsx)
  participant AU as Supabase Auth
  participant DB as Postgres
  participant RS as Resend
  participant CB as /auth/confirm or /auth/callback
  participant AH as utils/auth-handlers

  U->>P: email + password (+ ?company=true, returnTo / invite token)
  P->>SA: submit
  SA->>AU: admin generateLink / signUp
  SA->>SA: setUserAppMetadata(type)
  alt invite token
    Note over SA: no user_info / company_info row<br/>(membership comes from accept_company_invite, C2)
  else company
    SA->>DB: insert company_info (service role)
    Note over DB: company_info triggers fire → C1
  else applicant
    SA->>DB: insert user_info
  end
  SA->>RS: confirmation email (redirect: join link,<br/>companyOnboardingPath(returnTo) or applicant home)
  U->>CB: click link (or Google OAuth)
  CB->>AU: verifyOtp / exchangeCodeForSession
  CB->>AH: handleUserUpsert(user)
  AH->>DB: user_info upsert if missing + setUserAppMetadata
  AH->>DB: grantReferralCredits: only a pending invitation from that referrer<br/>→ status complete → referrer user_info.ai_credits
  CB-->>U: redirect homePath (helpers/user/home-path)
```

## P3. The browser only reads; writes go through server actions

The browser Supabase client (`lib/supabase/client.ts`) is used for reads only; `test/no-browser-writes.test.ts` fails the build if a component inserts, updates, deletes or calls an RPC with it. Every write is a server action that validates its input with zod and takes the user (or company) from the session, never from the input.

```mermaid
flowchart LR
  C["Client component"] -- "select" --> RLS[("Postgres via RLS")]
  C -- "write" --> SA["Server action<br/>getUserFromRequest / requireCompanyForAction"]
  SA --> Z["zod input schema<br/>(allowlisted fields)"]
  Z --> DB[("user client (RLS)<br/>or service role, scoped to the session")]
  DB --> G["column / row guards<br/>(migration 20261020130000_browser_write_guards)"]
```

The guards make direct REST calls with a user's own token harmless:

| Table | Guard |
|---|---|
| `user_info` | `protect_user_info_columns`: users can't change their email (except to their verified one), `invitations_count`, `referral_code` or the embedding |
| `applications` | users insert and delete only external rows (`job_post_id` null); platform applications are inserted by the service role inside `submitApplicationAction`; answers, form snapshot and resume are fixed after submit |
| `invitations` | read and mark-as-shown only |
| `interviews` | `charged_session_ids` belongs to the charge RPC |
| `bookmarks` | at most 5 active job alerts per user |

## P4. Job ingestion and embeddings (scraped jobs + company posts)

```mermaid
sequenceDiagram
  autonumber
  participant SCR as Scraper (external, own DB access)
  participant DB as all_jobs / job_postings
  participant TR as trigger on_job_update /<br/>on_job_posting_update (AFTER INSERT)
  participant Q as job_embeddings_queue
  participant SCH as External scheduler
  participant W as POST /api/update-embedding/gemini/job
  participant G as Gemini embedding-001 (768d)

  SCR->>DB: write all_jobs rows
  DB->>TR: new row
  TR->>Q: send {id, table} (DB fn send_job_embedding)
  Note over DB,TR: company posts (C3) insert job_postings + all_jobs, same trigger
  SCH->>W: X-Internal-Secret
  W->>Q: read batch (vt)
  W->>DB: load rows from all_jobs / job_postings
  W->>G: embedMany
  W->>DB: update embedding_new (+ embedding_updated_at)
  W->>Q: delete msg
```

## P5. API keys, MCP and OAuth

```mermaid
sequenceDiagram
  autonumber
  actor U as Applicant
  participant K as /dashboard/api-keys
  participant TK as /api/user/tokens
  participant DB as user_api_tokens
  participant MCP as MCP server
  participant MW as middleware
  participant API as /api/jobs, /api/user/profile,<br/>/api/resumes, /api/resume-review,<br/>/api/ai-search/jobs
  participant OC as /oauth/consent
  participant OD as /api/oauth/decision

  U->>K: create key
  K->>TK: POST
  TK->>DB: insert sha hash, return gh_… once
  MCP->>MW: Authorization: Bearer gh_…
  MW->>API: allowed prefix only
  API->>DB: getUserFromRequest → hash lookup → user
  Note over OC,OD: OAuth path (Supabase OAuth server)
  MCP->>OC: authorize
  U->>OD: approve / deny form
  OD->>OD: supabase.auth.oauth.approveAuthorization / denyAuthorization
```

## P6. Browser extension

```mermaid
sequenceDiagram
  autonumber
  participant EX as Extension
  participant EU as POST /api/extension/ensure-user
  participant GA as POST /api/extension/generate-answer
  participant DB as user_info / resumes
  participant G as Gemini flash-lite
  EX->>EU: Bearer supabase JWT
  EU->>DB: auth.getUser(token) → handleUserUpsert
  EX->>GA: question + page context
  GA->>DB: profile + primary resume
  GA->>G: generateText
  GA->>DB: deduct_user_credits
  GA-->>EX: answer
```

## P7. Public pages, blog and markdown for AI agents

```mermaid
flowchart LR
  V["Visitor / crawler / AI agent"] --> L["/ (applicant pitch), /hire (company pitch),<br/>/pricing/companies, /mcp-server, /extension …<br/>each with its own title + description"]
  L --> DEMO["Agent demo cards → /agent?prompt=… or<br/>/company/agent?prompt=… (login with returnTo if signed out)"]
  V --> B["/blog (filter: job seekers / companies) → /blog/[slug]<br/>Keystatic .mdoc posts with a date and an audience"]
  V --> MDP["/index.md, /hire.md, /pricing/companies.md,<br/>/blog.md, /blog/[slug].md …"]
  MDP --> MWR["middleware: pageForMarkdownPath → rewrite /md/…"]
  MWR --> MR["GET /md/[...path]<br/>helpers/marketing/markdown (static, hourly)"]
  V --> LT["public/llms.txt, robots.ts, sitemap.ts"]
  NF["404 page"] --> HOME["links for the visitor's role:<br/>company → /company, applicant → /dashboard, signed out → /"]
```
