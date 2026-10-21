# Company flows

## Company journey at a glance

```mermaid
flowchart LR
  SU["P2 Sign up (company)"] --> C1["C1 Onboarding + seeding"]
  C1 --> C2["C2 Team + roles"]
  C1 --> C12["C12 Billing"]
  C1 --> C3["C3 Job posts + forms"]
  C3 --> C13["C13 Careers page"]
  C13 --> APPLY["A4 Apply"]
  C3 --> APPLY
  APPLY --> C4["C4 Intake"] --> C5["C5 AI screening"] --> C10["C10 Screening interview"]
  C4 --> C6["C6 Pipeline"] --> C7["C7 Notes"]
  C3 --> C8["C8 Search + matching"] --> C9["C9 Outreach"]
  C4 & C8 --> C11["C11 Notifications"]
  C14["C14 Recruiter agent"] -.-> C3 & C6 & C8 & C9 & C10 & C2
  C12 -. "entitlements" .-> C5 & C8 & C9 & C10 & C14
```

## Permission check (every company action / route / tool)

```mermaid
flowchart LR
  A["action / route / agent tool"] --> RC["requireCompanyForAction({permission, jobId?})<br/>requireCompany(...)"]
  RC --> GM["getMyCompany → rpc my_company_access<br/>(grants, assigned jobs, limits) + touch_company_membership"]
  GM --> CAN{"can(company, key, job)"}
  CAN -- no --> FM["forbiddenMessage: 'Your role can't …'"]
  CAN -- yes --> RUN["run"]
  RUN --> RLS[("RLS + RPCs → has_company_permission(company, key, job?)<br/>owners (company_members.is_owner) pass all")]
  RUN --> JS["company job lists → scopeToJobs (job-scope.ts)"]
```

## C1. Company onboarding and seeding

```mermaid
sequenceDiagram
  autonumber
  actor U as Recruiter
  participant SA as signUpEmail (company)
  participant CI as company_info
  participant TR as company_info AFTER INSERT triggers
  participant P as /get-started?company=true<br/>CompanyOnboardingForm
  participant SV as saveCompanyProfileAction<br/>(company.profile)
  participant G as Gemini embedding-001
  U->>SA: sign up
  SA->>CI: insert (service role)
  CI->>TR: fire
  TR->>TR: create_default_subscription → company_subscriptions (free)<br/>seed_owner_membership → company_members (is_owner)<br/>seed_company_roles → company_roles + company_role_permissions<br/>seed_default_pipeline → pipeline_stages<br/>seed_default_templates → company_email_templates
  Note over CI: BEFORE triggers: protect_company_info_columns,<br/>protect_careers_columns, protect_company_digest_watermark
  U->>P: details + logo
  P->>SV: FormData (values JSON, logo, removeLogo)
  SV->>SV: companyProfileSchema, logo type / size check
  SV->>G: embedCompanyProfile (description, HQ, size, industry)
  SV->>CI: logo → storage images/company_logos/{session company} (service role)
  SV->>CI: update company_info (user client, RLS), filled = true
  SV->>CI: embedding_new (service role, session company only)
  SV->>SV: markMyOnboardingComplete("company"), revalidate /company
  P-->>U: returnTo (e.g. /company/agent) or /company (rpc get_company_metrics)
```

## C2. Team, roles, hiring teams

```mermaid
sequenceDiagram
  autonumber
  actor A as Admin
  participant TS as /company/settings/team, /roles
  participant SA as team/* and roles/* actions
  participant DB as RPCs
  participant RS as Resend
  actor I as Invitee
  participant J as /company/join
  participant AC as acceptInviteAction

  A->>TS: invite (email, role, jobs)
  TS->>SA: inviteMemberAction (team.invite) → createAndSendInvite
  SA->>DB: rpc create_company_invite → company_invites (hash)<br/>check_member_limit, role_within_caller_ceiling
  SA->>RS: invite email (token link)
  I->>J: open link (findOpenInvite)
  alt new account
    I->>J: sign up with token (P2, no user rows)
  end
  I->>AC: accept
  AC->>DB: rpc accept_company_invite → company_members,<br/>company_job_assignments, company_invites.accepted, write_company_audit
  AC->>AC: setUserAppMetadata(company, onboarding_complete)
  Note over SA,DB: resend / revoke → company_invites, revoke_company_invite<br/>change role → set_company_member_role<br/>remove → remove_company_member<br/>owner → set_company_owner, make_primary_owner (transfer)<br/>roles → create/update/delete_company_role, set_default_company_role<br/>(guard_role_permission, check_role_dependencies, company_role_limits)<br/>display name → set_my_display_name<br/>jobs → assign_job / unassign_job (jobs.assign)<br/>views → list_company_team, list_company_roles,<br/>list_company_hiring_teams, list_job_hiring_team<br/>audit page → list_company_audit (company_audit_log)
```

## C3. Job posts, forms, question sets

```mermaid
sequenceDiagram
  autonumber
  actor R as Recruiter
  participant F as /company/job-posts/new or [id]/edit<br/>JobPostingForm
  participant SA as upsertJobPostingAction (jobs.create / jobs.edit)
  participant H as helpers/jobs/upsert-job-posting
  participant DB as Postgres
  participant EMB as /api/update-embedding/gemini/job
  participant Q as application_screening_queue

  R->>F: details + application form (+ question set)
  F->>SA: values
  SA->>H: upsertJobPosting
  H->>H: screenFormFairness, splitForm (public form vs rules)
  H->>DB: insert / update job_postings (application_form, questions = legacyQuestionsOf)
  Note over DB: enforce_active_job_post_limit, guard_job_posting_update,<br/>job_postings_assign_creator, on_job_posting_update → job_embeddings_queue (P4)
  H->>DB: upsert job_posting_form_rules (company-only)
  H->>DB: rpc assign_job_creator
  opt edit
    H->>DB: markJobResultsStale → application_screenings / job_relevant_profiles stale
    H->>Q: re-screen (enqueue-screenings)
    H->>EMB: POST (X-Internal-Secret)
    H->>DB: update all_jobs mirror
  end
  opt new
    H->>DB: insert all_jobs mirror → job_postings.job_id
  end
  H->>H: revalidateTag job-…, careersCompanyTag
  Note over R,DB: status → setJobPostingStatusAction (jobs.publish) → job_postings + all_jobs<br/>delete → deleteJobPostingAction (jobs.delete)<br/>question sets → save/delete/list → company_question_sets (check_question_set_cap)
```

## C4. Application intake (what one apply sets off)

```mermaid
flowchart TD
  INS["INSERT applications (A4)"] --> B1["BEFORE: protect_application_pipeline_columns<br/>applications_sync_status (stage ↔ status)"]
  INS --> A1["AFTER: log_application_applied → application_events 'applied'"]
  INS --> A2["AFTER: enqueue_application_screening<br/>→ application_screenings + application_screening_queue → C5"]
  INS --> A3["AFTER: notify_company_of_application<br/>→ company_notification_queue → C11"]
  INS --> K["submitApplicationAction: application_knockouts<br/>reject → Rejected stage, +24h email (knockouts worker)"]
  INS --> V["Company views: /company/applications, /company/job-posts/[id]/applications<br/>/company/applications/[id]/* → loadApplicationFrame, answersView"]
```

## C5. AI screening of applications

```mermaid
sequenceDiagram
  autonumber
  participant SRC as Producers
  participant Q as application_screening_queue
  participant CR as pg_cron 1m
  participant W as /api/worker/application-screening
  participant DB as Postgres
  participant G as Gemini
  participant FT as fit-threshold

  SRC->>Q: trigger on applications insert<br/>POST /api/company/job-posts/[id]/screen (queueScreenings)<br/>saveInterviewConfigAction, recruiter agent tool, job edit (mark-stale)
  CR->>W: X-Internal-Secret
  W->>Q: read batch
  W->>DB: application_screenings, applications, job_postings (job-snapshot)
  alt already screened for this job version
    W->>Q: archive
  else
    W->>DB: load-candidate (candidate_directory, resumes, user_info)
    W->>G: screenApplication → fit_score + reasons
    W->>DB: consumeEntitlement (null actor) → company_usage
    W->>DB: application_screenings result, application_events 'screened'
    W->>FT: inviteAboveFitThreshold → rpc create_screening_invite → C10
    W->>Q: archive (retry up to MATCH_MAX_ATTEMPTS)
  end
  Note over DB: read: GET /api/company/applications/[id]/screening (screening-view)
```

## C6. Pipeline (board, stages, emails)

```mermaid
sequenceDiagram
  autonumber
  actor R as Recruiter
  participant B as Board / applications list
  participant SA as moveApplicationsAction (pipeline.move)
  participant H as helpers/pipeline/move
  participant DB as Postgres
  participant Q as pipeline_email_queue
  participant W as /api/worker/pipeline-emails (pg_cron 1m)
  participant RS as Resend

  B->>DB: GET /api/company/job-posts/[id]/pipeline → board.ts<br/>(applications, candidate_notes, job_postings, pipeline_stages)
  Note over B: members without pipeline.move see the board locked<br/>(no drag, stage picker or bulk move)
  R->>SA: move ≤50 to stage (+ template)
  SA->>H: prepareMove: company_email_templates, company_info,<br/>daily cap = email_sent events + rpc pipeline_emails_pending
  H->>DB: update applications.stage_id
  Note over DB: applications_sync_status,<br/>applications_close_screening_interview (Rejected / Hired → cancel interview)
  H->>Q: send_batch messages
  H->>DB: application_events 'stage_changed'
  W->>Q: read
  W->>DB: load applications (email, company matches)
  W->>RS: sendCompanyMessage, branded with the company only (retry ≤ PIPELINE_EMAIL_MAX_READS)
  W->>DB: application_events 'email_sent', archive
  Note over R,DB: previewEmailAction / previewAgentMove<br/>updateApplicationStatusAction<br/>stages → saveStagesAction → pipeline_stages, reorder_pipeline_stages (guard_pipeline_stage)<br/>templates → create/save/deleteTemplate → company_email_templates<br/>settings → update_company_settings (notifications, scheduling link)<br/>funnel → rpc get_job_funnel<br/>talent lists → talent_lists, talent_list_members
```

## C7. Notes and mentions

```mermaid
flowchart LR
  N["/company/applications/[id]/notes"] --> LM["rpc list_mentionable_members"]
  N --> AN["add / update / deleteNote actions (notes.write)"]
  AN --> NH["helpers/pipeline/notes<br/>company_can_view_candidate"]
  NH --> CN[("candidate_notes<br/>trigger guard_candidate_note<br/>member_can_view_notes")]
  NH --> EV[("application_events")]
  NH --> MT[("candidate_note_mentions")]
  MT --> NM["notify-mentions → rpc claim_note_mention_emails → Resend"]
```

## C8. Candidate search and matching

```mermaid
flowchart TD
  P["/company/profiles"] --> API["GET /api/profiles<br/>getMyCompany + entitlements"]
  API --> PQB["profilesFilterQueryBuilder<br/>view candidate_directory, rpc match_user_profiles,<br/>get_unique_profile_filters, *_search RPCs, expandLocations"]
  API --> AIR["ai-rerank-profiles → POST /api/ai-search/profiles → JEV"]
  P --> PP["/company/profiles/[id]<br/>rpc company_has_candidate_access, record_profile_view<br/>→ candidate_profile_views"]
  P & PP --> FAV["ProfileFavoriteStar → setProfileFavoriteAction<br/>(company_can_view_candidate) → company_favorites"]

  subgraph Matching["Job → candidate matches"]
    E1(("pg_cron Mon 03:30")) --> EN["/updates/company/relevant-profiles/enqueue"]
    MAN["relevantProfilesUpdateAction (matching.run)"] --> RQ
    EN --> RQ[["relevance_profiles"]]
    W1(("pg_cron 1m")) --> RW["/updates/company/relevant-profiles/worker<br/>relevant-profiles-utils → rerank"]
    RQ --> RW
    RW --> JRP[("job_relevant_profiles")]
    RW --> XQ[["match_explanation_queue"]]
    W2(("pg_cron 5m")) --> XW["/updates/company/match-explanations/worker<br/>explain-match (Gemini) + consumeEntitlement"]
    XQ --> XW --> JRP
    OD["POST /api/company/matches/explain (on demand)"] --> JRP
  end
```

## C9. Outreach

```mermaid
sequenceDiagram
  autonumber
  actor R as Recruiter
  participant CO as Composer (/company/outreach, profile page)
  participant SA as outreach actions (outreach.send)
  participant H as helpers/outreach/*
  participant DB as Postgres
  participant G as Gemini
  participant RS as Resend
  participant CR as pg_cron 21:00
  R->>CO: open composer
  CO->>SA: loadComposerAction (visible-candidates, job-scope, templates)
  R->>SA: draftOutreachAction
  SA->>H: draft → company_can_view_candidate, rpc increment_outreach_drafts (outreach_draft_usage)
  H->>G: draft text
  R->>SA: sendOutreachAction (or POST /api/company/outreach, agent source)
  SA->>H: send: holdEntitlement(outreach)
  H->>DB: rpc send_candidate_outreach → candidate_outreach (fill_outreach_sender_name),<br/>application_events
  H->>DB: consume (or release on failure)
  H->>RS: email candidate, branded with the company → A9
  R->>SA: withdrawOutreachAction (outreach.view) → status withdrawn
  CR->>DB: /api/updates/outreach/expire → rpc expire_outreach
  Note over DB: contact details unlock only after 'interested'<br/>(company_can_view_candidate / outreach_contact_gating)
```

## C10. Screening interviews (company side)

```mermaid
sequenceDiagram
  autonumber
  actor R as Recruiter
  participant CFG as /company/job-posts/[id]/interview
  participant SA as interview actions (interviews.manage)
  participant DB as RPCs
  participant Q as screening_invite_email_queue
  participant W1 as /api/worker/screening-invite-emails (1m)
  participant CAND as Candidate (A8)
  participant AQ as interview_analysis_queue
  participant W2 as /api/updates/interview-analysis/worker (1m)
  participant LC as /api/updates/screening-interviews (15m)
  participant RT as …/retention (monthly)

  R->>SA: suggestInterviewConfigAction (Gemini)
  R->>SA: saveInterviewConfigAction (+ jobs.edit) → job_interview_configs, queueScreenings
  alt manual / agent / bulk
    R->>SA: inviteToInterviewAction → inviteApplicants (≤50, one job)
    SA->>DB: rpc create_screening_invites
  else auto (C5 fit ≥ threshold)
    DB->>DB: create_screening_invite (null actor)
  end
  DB->>DB: application_interviews (config_snapshot), interviews (screening),<br/>hold_entitlement(interview_minutes), log_screening_event
  DB->>Q: send
  W1->>Q: read → still invited? → email → archive
  CAND->>DB: A8 (start, transcript, finish_screening_session)
  DB->>AQ: analysis
  W2->>W2: screening branch: analysis.ts (flash-lite, sandbox, verifyEvidence, score in code)
  W2->>R: notify-company email
  R->>SA: manageScreeningInterviewAction → rpc manage_screening_interview<br/>(extend, cancel, reopen re-holds + re-queues email)
  LC->>DB: expire_screening_interviews + emails, reminders (48h), sweep sessions with no callback
  RT->>DB: delete old transcripts (SI_RETENTION_DAYS)
  Note over DB: stage move to Rejected / Hired → trigger cancels + releases minutes
```

## C11. Company notifications

```mermaid
flowchart LR
  T["notify_company_of_application"] --> Q1[["company_notification_queue"]] --> W1["/api/worker/company-notifications (1m)<br/>instant, 15-min throttle per job<br/>job_postings.last_applicant_notified_at"]
  C1(("daily 03:30 UTC")) --> E2["/updates/company/applicant-digest/enqueue<br/>notify_new_applicants = daily"] --> Q2[["applicant_digest_queue"]] --> W2["…/worker (5m)<br/>company_info.last_applicant_digest_at"]
  C2(("Mon 03:30 UTC")) --> E3["/updates/company/weekly-matches/enqueue"] --> Q3[["weekly_matches_queue"]] --> W3["…/worker (5m)<br/>top job_relevant_profiles"]
  W1 & W2 & W3 --> RS{{"Resend"}}
```

## C12. Billing and entitlements

```mermaid
sequenceDiagram
  autonumber
  actor R as Owner
  participant BP as /company/billing, /pricing/companies
  participant API as /api/company/billing(/checkout)
  participant SA as change / cancel / resume plan, openBillingPortal
  participant D as Dodo
  participant WH as /api/dodo/webhook
  participant DB as Postgres
  participant CR as /api/updates/billing (daily, external)

  BP->>API: GET → get_company_entitlements
  R->>API: POST checkout (plan or credit pack) → payments
  API->>D: create session
  D->>WH: subscription.* / payment.succeeded
  WH->>DB: billing_webhook_events (dedupe)
  WH->>DB: rpc apply_subscription_event → company_subscriptions<br/>(trigger sync_company_info_tier)
  WH->>DB: rpc fulfil_payment → grant_company_credits → company_credit_ledger
  R->>SA: schedule_company_plan_change / set_company_cancel_at_period_end / portal
  Note over DB: every metered action:<br/>check_entitlement → hold_entitlement → consume_entitlement / release_hold<br/>(company_usage, company_usage_events, company_entitlement_holds,<br/>billing_spend_credits, member_limit_state, company_role_limits)
  CR->>DB: rollover_free_periods, billing_usage_alerts → email, mark_usage_notified
  Note over DB: admin: /api/internal/billing/grant (x-api-key) → grant_company_credits / set_company_plan
```

## C13. Careers page

```mermaid
flowchart LR
  ED["/company/settings/careers<br/>/company/careers/preview"] --> CS["claimCareersSlug → rpc claim_careers_slug<br/>(company_careers_slug_history)"]
  ED --> SV["saveCareersPage → rpc save_careers_page"]
  ED --> PB["setCareersPublished → rpc set_careers_published"]
  ED --> IMG["uploadCareersImage → storage 'careers'"]
  CS & SV & PB --> CI[("company_info careers columns<br/>protect_careers_columns trigger")]
  CS & SV & PB --> RV["revalidate careersSlugTag / careersCompanyTag"]
  PUB["/careers/[slug], /careers/[slug]/jobs/[id]<br/>GET /api/careers/[slug]/jobs"] --> RPC["anon rpc get_careers_page, get_careers_jobs<br/>(cached by tag)"]
  PUB --> APPLY["Apply → A4"]
  JOBW["any job write (C3)"] --> RV
```

## C14. Recruiter agent (`/company/agent`)

```mermaid
flowchart TD
  CP["/company/agent ChatPane"] --> R["POST /api/agent/chat"]
  R --> AU["requireAgentUser → company role<br/>(403 until onboarded, agent.use)"]
  AU --> CH["charge 1 agent_messages → consumeEntitlement"]
  CH --> CTX["context: rpc get_recruiter_job_summaries, memories (screenFairnessText)"]
  CTX --> M["streamText Gemini + recruiter tools"]
  M --> TL["tools (RECRUITER_TOOL_PERMISSIONS)"]
  TL --> T1["jobs → upsert-job-posting"]
  TL --> T2["candidates → search-profiles, record_profile_view"]
  TL --> T3["applicants → application_screenings, applications"]
  TL --> T4["pipeline → pipeline/move (preview-agent-move)"]
  TL --> T5["outreach → sendOutreach source agent (preview-agent-outreach)"]
  TL --> T6["interviews → inviteApplicants (preview-agent-interview-invite)"]
  TL --> T7["matching → queueScreenings, relevance"]
  TL --> T8["team → createAndSendInvite, list/resend/revokeInvite (always ask)"]
  TL --> T9["careers → get_my_careers_page"]
  TL --> T10["roles → preview-agent-role"]
  M --> AP["toolApproval → approval cards in ChatPane"]
  M --> PS["persist agent_sessions (role = company), agent_messages"]
```
