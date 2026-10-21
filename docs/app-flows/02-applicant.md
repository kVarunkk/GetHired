# Applicant flows

## Applicant journey at a glance

```mermaid
flowchart LR
  SU["P2 Sign up"] --> A1["A1 Onboarding<br/>/get-started"]
  A1 --> A2["A2 Discover jobs<br/>/jobs"]
  A2 --> A3["A3 Job page tools<br/>/jobs/[id]"]
  A3 --> A4["A4 Apply / track"]
  A4 --> A8["A8 Screening interview<br/>(if company invites)"]
  A1 --> A5["A5 Resumes<br/>/resume"]
  A5 --> A6["A6 Resume review<br/>/resume-review"]
  A2 --> A7["A7 Practice interview<br/>/ai-interview"]
  A9["A9 Outreach inbox<br/>/opportunities"] --> A4
  A10["A10 Credits<br/>/dashboard/buy-credits"] -.-> A3 & A6 & A7
  A11["A11 Email crons"] -.-> A2
  A12["A12 Agent /agent"] -.-> A2 & A5 & A6 & A1 & A4
  A13["A13 Settings<br/>/settings"] -.-> A9 & A11
```

## A1. Onboarding

```mermaid
sequenceDiagram
  autonumber
  actor U as Applicant
  participant P as /get-started<br/>OnboardingComponent
  participant UR as uploadResumeFileAction
  participant PR as helpers/resume/parse-resume
  participant SO as submitOnboardingAction
  participant CO as helpers/user/complete-onboarding
  participant DB as resumes / user_info
  participant Q as onboarding_pipeline
  participant SCH as External scheduler
  participant W as GET /api/worker/user/onboarding
  participant G as Gemini
  participant RJ as processUserRelevance

  U->>P: upload PDF
  P->>UR: file
  UR->>DB: storage upload + insert resumes
  UR->>PR: parseResume (Gemini → resumes.content)
  Note over DB: trigger resumes_store_public_sections → resume_public_sections
  U->>P: preferences form
  P->>SO: values
  SO->>CO: zod (onboarding-profile = user_info allowlist)
  CO->>DB: update user_info, primary resume
  CO->>Q: send {userId, resumeId}
  CO->>CO: setUserAppMetadata(onboarding_complete)
  SCH->>W: X-Internal-Secret
  W->>Q: read
  opt resume not parsed
    W->>PR: parseResume
  end
  W->>G: updateUserEmbedding → user_info.embedding
  W->>RJ: fetch /api/jobs?sortBy=relevance → rerank → user_relevant_jobs
  W->>DB: user_info.relevant_jobs_update_status = done / failed
  W->>Q: delete
  P-->>U: useRelevantJobPoller polls status
```

## A2. Job discovery and search

```mermaid
flowchart TD
  J["/jobs, /remote-jobs/[location],<br/>/companies, /companies/[id]"] --> API["GET /api/jobs"]
  J --> F["GET /api/jobs/filters → rpc get_unique_companies<br/>GET /api/locations → view flat_locations"]
  J --> CF["GET /api/companies (+/filters)<br/>companiesFilterQueryBuilder → rpc match_all_companies,<br/>get_unique_*_company_info"]
  API --> SJ["helpers/jobs/search-jobs"]
  SJ --> FQB["filterQueryBuilder<br/>expandLocations → location_aliases"]
  FQB --> SORT{"sortBy"}
  SORT -- "date / filters" --> AJ[("all_jobs")]
  SORT -- "relevance (signed in)" --> URJ[("user_relevant_jobs inner join")]
  SORT -- "similar_jobs / standard vector" --> MV["rpc match_all_jobs_test(embedding)"]
  FQB --> MU["rpc get_masked_job_urls (service role)"]
  SJ --> RR["rerankJobsIfApplicable → POST /api/ai-search/jobs"]
  RR --> JEV{{"Rerank service"}}
  RR --> G{{"Gemini (reasons)"}}
  RR --> CR["rpc deduct_user_credits"]
  J --> BM["Save search: toggleSearchBookmarkAction → bookmarks<br/>setBookmarkAlertAction (≤ 5 alerts) → A11 job-alert"]
```

## A3. Job page tools (`/jobs/[job_id]`)

```mermaid
flowchart LR
  JP["/jobs/[job_id]<br/>get-job-details → all_jobs"] --> SUM["summarizeJobAction<br/>Gemini → credits"]
  JP --> Q["POST /api/ai-search/jobs/questions/[job_id]<br/>validateAndSanitize → Gemini → credits"]
  JP --> SIM["POST /api/ai-search/jobs/similar-jobs<br/>match_all_jobs_test + rerank"]
  JP --> FAV["favorite: POST /api/jobs/[id]/favorite<br/>or JobFavoriteBtn → setFavoriteAction →<br/>user_favorites, user_favorites_companies"]
  JP --> URL["GET /api/jobs/[id]/urls → get_masked_job_urls"]
  JP --> FB["submitJobFeedback → job_feedback"]
  JP --> RV["Review resume vs this JD → A6"]
  JP --> IV["Practice interview for this JD → A7"]
  JP --> AP["Apply → A4"]
```

## A4. Apply

```mermaid
sequenceDiagram
  autonumber
  actor U as Applicant
  participant JP as /jobs/[id] or /careers/[slug]/jobs/[id]
  participant SA as submitApplicationAction<br/>(helpers/applications/submit-application)
  participant DB as Postgres
  participant TR as applications triggers
  participant Q1 as application_screening_queue
  participant Q2 as company_notification_queue
  participant KW as /api/updates/knockouts/worker

  alt scraped job (all_jobs, external URL)
    U->>JP: Apply Now (JobApplyBtn) → opens the job's own site
    JP->>DB: deductApplicationCreditsAction → deduct_user_credits
    U->>JP: "Did you apply?" (JobStatusDialog)
    JP->>DB: trackExternalApplicationAction → applications insert (user client, job_post_id null)
    Note over JP,DB: later: setExternalApplicationStatusAction / removeExternalApplicationAction<br/>(JobPageDropdown, refused for platform jobs)
  else company job (job_postings): form, or the agent's Easy Apply (A12)
    U->>JP: JobApplicationForm (readApplicationForm / publicApplicationForm)
    JP->>SA: resume + answers
    SA->>DB: resume belongs to user, job_postings (status active),<br/>job_posting_form_rules + duplicate check (service role)
    SA->>SA: validateAnswers + evaluateKnockouts
    SA->>DB: insert applications as the service role<br/>(answers, answers_v2, form_snapshot), users can't insert these themselves
    DB->>TR: protect_application_pipeline_columns, applications_sync_status (BEFORE)
    TR->>DB: first_pipeline_stage, log_application_applied → application_events
    TR->>Q1: enqueue_application_screening (+ application_screenings row) → C5
    TR->>Q2: notify_company_of_application → C11
    opt knockout reject rule
      SA->>DB: rejectForKnockout → stage Rejected + application_events
    end
    SA->>DB: application_knockouts (reject_email_due_at = +24h)
    SA->>DB: deduct_user_credits
    KW->>DB: due + still rejected → Resend email, reject_email_sent_at, email_sent event
  end
  opt share proof with company
    U->>DB: attachments action → application_attachments (trigger check_application_attachment)
    DB->>DB: rpc enqueue_company_interview_analysis → interview_analyses + interview_analysis_queue
  end
```

## A5. Resumes (`/resume`, `/resume/[id]`)

```mermaid
flowchart LR
  R["/resume"] --> UP["uploadResumeFileAction → storage + resumes → parseResume (Gemini)"]
  R --> RT["retryResumeParsingAction → parseResume"]
  R --> PRIM["setPrimaryResumeAction → resumes.is_primary → updateUserEmbedding (Gemini) → user_info.embedding"]
  R --> API["GET/DELETE /api/resumes, /api/resumes/[id]"]
  UP --> TRG["trigger resumes_store_public_sections → resume_public_sections<br/>(what companies may see)"]
  UP --> EM["parseResume → sendResumeStatusEmail (Resend)"]
```

## A6. Resume review

```mermaid
sequenceDiagram
  autonumber
  actor U as Applicant
  participant P as /resume-review
  participant SA as createResumeReview action /<br/>POST /api/resume-review
  participant H as start-review-analysis
  participant DB as resume_reviews / user_info
  participant G as Gemini flash-lite
  U->>P: resume + JD (or job from all_jobs)
  P->>SA: create
  SA->>DB: insert resume_reviews (status processing)
  SA->>H: startReviewAnalysis
  H-->>P: returns at once
  Note over H: after()
  H->>G: generateText (structured)
  H->>DB: update resume_reviews (analysis, done)
  H->>H: sendReviewStatusEmail
  H->>DB: deduct_user_credits (only on success)
  P->>DB: poll GET /api/resume-review/[id] → /resume-review/[reviewId]
  Note over P,DB: edits on the review page: updateReviewJdAction (job description),<br/>linkReviewResumeAction (pick one of the user's resumes),<br/>rename / delete → updateOwnedItemAction / deleteOwnedItemAction
```

## A7. Practice interview (voice)

```mermaid
sequenceDiagram
  autonumber
  actor U as Applicant
  participant P as /ai-interview → /interview/[id]
  participant CI as createInterviewAction
  participant H as useVoiceAgent (browser)
  participant ST as POST /api/interview/start
  participant DB as interviews / interview_sessions
  participant V as Voice server
  participant L as heartbeat / release actions
  participant FZ as finalizeInterviewSessionAction
  participant Q as interview_analysis_queue
  participant W as /api/updates/interview-analysis/worker (pg_cron 1m)
  participant G as Gemini

  U->>CI: JD / job
  CI->>DB: insert interviews (kind practice)
  U->>H: start
  H->>ST: interviewId
  ST->>DB: rpc reserve_interview_session (one live session)
  ST->>V: POST /sessions (x-backend-secret)
  ST->>DB: rpc activate_interview_session
  ST-->>H: wsUrl
  H->>V: WebSocket audio
  H->>DB: savePracticeTurnsAction → interview_sessions transcript
  loop every N s
    H->>L: rpc heartbeat_interview_session
  end
  H->>DB: deductInterviewSessionCreditsAction → rpc deduct_interview_session_credits
  H->>FZ: on end
  FZ->>DB: rpc finalize_interview_analysis_session → interview_analyses
  DB->>Q: send {analysisId}
  W->>Q: read
  W->>G: analyse transcript
  W->>DB: interview_analyses result
  W-->>U: email → /interview/[id]/analysis/[sessionId]
```

## A8. Screening interview (candidate side)

```mermaid
sequenceDiagram
  autonumber
  actor U as Candidate
  participant EM as Invite email (C10)
  participant P as /interview/screening/[id]
  participant SA as screening actions
  participant ST as POST /api/interview/screening/start
  participant DB as RPCs (security definer)
  participant V as Voice server
  participant CB as /api/internal/interview-transcript
  participant Q as interview_analysis_queue

  EM->>U: link
  U->>P: open
  P->>SA: getMyScreeningInterview → rpc my_screening_interviews
  U->>SA: recordScreeningConsent → rpc record_screening_consent
  opt
    U->>SA: requestScreeningAccommodation / declineScreeningInterview<br/>→ rpc + notify-company email
  end
  U->>ST: start
  ST->>DB: rpc reserve_screening_attempt
  ST->>DB: candidate-context (applications, resumes, user_info) + job description
  ST->>V: POST /sessions mode screening (must-ask questions)
  ST->>DB: rpc start_screening_attempt
  ST-->>P: wsUrl
  P->>V: WebSocket (browser saves nothing)
  V->>CB: transcript + x-voice-callback-secret
  CB->>DB: rpc finish_screening_session<br/>(interview_sessions, interviews, application_interviews,<br/>consume interview_minutes if ≥3 answers, else release hold)
  DB->>Q: interview_analyses + send
  Note over Q: worker screening branch → C10 report
```

## A9. Outreach inbox (`/opportunities`)

```mermaid
sequenceDiagram
  autonumber
  participant C as Company (C9)
  participant DB as candidate_outreach
  participant U as Candidate
  participant P as /opportunities, /opportunities/[id]
  participant SA as respondToOutreachAction
  participant RS as Resend
  C->>DB: rpc send_candidate_outreach + email to candidate
  U->>P: open (useOpenOutreachCount badge)
  P->>SA: interested / not interested / block
  SA->>DB: rpc respond_to_outreach → status, application_events,<br/>candidate_company_blocks
  SA->>RS: email the sending member (member-recipient)
  U->>DB: setOutreachPreferencesAction → user_info, candidate_company_blocks
  Note over DB: profile visits → candidate_profile_views<br/>(dashboard: rpc get_my_profile_view_count)
```

## A10. Credits and payments

```mermaid
flowchart TD
  BC["/dashboard/buy-credits"] --> CS["POST /api/dodo/create-checkout-session<br/>price_plan → payments (pending)"]
  CS --> DODO{{"Dodo checkout"}}
  DODO --> WH["POST /api/dodo/webhook<br/>billing_webhook_events (idempotent)"]
  WH --> FP["rpc fulfil_payment → user_info.ai_credits<br/>(company payments → grant_company_credits)"]
  WH --> EM["receipt email, payments.email_sent"]
  BC --> PAY["/payments/[id] → GET /api/dodo/download-invoice/[paymentId]"]
  REF["CreditDepositDialog → sendInviteEmail action<br/>(server: invitations row + email)"] --> GR["grantReferralCredits on invitee sign-up<br/>(pending invitation only)"]
  GR --> SH["markInviteDialogsShownAction<br/>(referrer sees 'invite accepted' once)"]
  SPEND["AI features"] --> DED["rpc deduct_user_credits<br/>(helpers/ai/deduct-user-credits)"]
  SPEND2["Voice practice"] --> DIS["rpc deduct_interview_session_credits"]
```

## A11. Applicant email crons (external scheduler)

```mermaid
flowchart LR
  SCH(("External scheduler")) --> E1["/updates/applicants/digest/enqueue"] --> Q1[["job_digest"]] --> W1["…/digest/worker<br/>relevant jobs + profile views → email"]
  SCH --> E2["/updates/applicants/relevant-jobs/enqueue"] --> Q2[["relevance_jobs"]] --> W2["…/relevant-jobs/worker<br/>processUserRelevance → user_relevant_jobs"]
  SCH --> E3["/updates/applicants/recharge/enqueue<br/>ai_credits low"] --> Q3[["recharge_jobs"]] --> W3["…/recharge/worker → recharge email"]
  SCH --> D1["/updates/applicants/applications<br/>7-day status reminder"]
  SCH --> D2["/updates/applicants/favorites<br/>favourited, not applied"]
  SCH --> D3["/updates/applicants/job-alert<br/>bookmarks.is_alert_on"]
  SCH --> D4["/updates/applicants/onboarding<br/>user_info.filled = false"]
  RJA["relevantJobsUpdateAction (manual refresh)"] --> Q2
```

## A12. Agent (applicant role)

```mermaid
sequenceDiagram
  autonumber
  actor U as Applicant
  participant CP as /agent ChatPane (useChat)
  participant R as POST /api/agent/chat
  participant AU as requireAgentUser
  participant DB as agent_sessions / agent_messages / agent_memories
  participant M as streamText (Gemini)
  participant T as createAgentTools(ctx)
  participant AP as toolApproval policy

  U->>CP: message
  CP->>R: UIMessage (+ approvals)
  R->>AU: role from app_metadata
  R->>DB: upsert session, mergeClientUpdates, last 20 msgs + summary + memories
  R->>M: system prompt + tools (abortSignal)
  loop until stop / AGENT_MAX_STEPS
    M->>T: tool call
    T->>AP: needs approval?
    alt asks
      AP-->>CP: approval-requested (Approve / Deny)
    else runs
      T->>T: run the tool (see table below)
    end
  end
  R->>R: generateFollowUps → data-suggestions
  R->>DB: persist messages (seq), summarise long chats
  R->>R: PostHog agent_chat_turn, flushAgentTraces (Arize)
  CP->>R: GET/PATCH/DELETE /api/agent/sessions*, /api/agent/memories*
```

Applicant tools (`helpers/agent/tools/`). The ones marked **asks** show an Approve / Deny card first (`helpers/agent/approval.ts`).

| Group | Tools |
|---|---|
| Profile + onboarding | `getMyProfile`, `updateMyPreferences` (**asks**), `completeOnboarding` (**asks**) |
| Jobs | `searchJobs`, `naturalLanguageJobSearch`, `findRelevantJobs`, `findSimilarJobs`, `getJobDetails`, `saveJob`, `unsaveJob`, `listSavedJobs` |
| Applications | `listApplications`, `updateApplicationStatus` (external jobs only), `getApplicationForm`, `submitApplication`: Easy Apply through the same `submitApplication` helper as the form (A4), 1 credit (**asks**, card from `previewAgentApplicationAction`) |
| Resumes | `listResumes`, `setPrimaryResume`, `requestResumeUpload`, `pickResumeForJob` (`helpers/resume-review/rank-resumes-for-job`, `shortlist-resumes`), `startResumeReview` (**asks**), `getResumeReview` |
| Interviews | `listInterviews`, `listScreeningInterviews`, `getInterviewAnalysis`, `createInterview` |
| Memory | `saveMemory`, `deleteMemory` |

## A13. Settings (`/settings`)

```mermaid
flowchart LR
  S["/settings"] --> EP["EmailPreferences → setEmailPreferenceAction<br/>(one subscription flag on user_info)"]
  S --> PS["PrivacySettings"]
  PS --> PV["ProfileVisibilitySetting →<br/>setProfileVisibilityAction (user_info.is_public)"]
  PS --> OP["OutreachPreferences → setOutreachPreferencesAction,<br/>unblockCompanyAction → user_info, candidate_company_blocks (A9)"]
  NAV["Navbar FeedbackForm"] --> FB["submitFeedbackAction → feedbacks"]
```
