import { after, NextResponse } from "next/server";
import { BOARD_ADAPTERS, ingestStatus } from "@/helpers/distribution/ingest/board-application";
import { storeBoardResume } from "@/helpers/distribution/ingest/store-board-resume";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Json } from "@/utils/types/database.types";

/** Base64 of a 10 MB file plus the rest of the payload. */
const MAX_BODY_CHARS = 15 * 1024 * 1024;

type IngestResult =
  | { ok: true; application_id: string; candidate_id: string; company_id: string; has_resume: boolean }
  | { ok: false; reason: string };

/**
 * MPT-030/031 (MP-REQ-008): a job board POSTs an application taken on its own
 * site. Public in the middleware; the board's signature over the raw body is
 * the only way in, and a board with no secret configured is a 404. The
 * application becomes a company candidate (never linked to an account) and
 * an application with source `job_board`, through `ingest_board_application`,
 * which also refuses replays, unknown and closed jobs. The resume is read
 * after the reply, because boards time out quickly.
 */
export async function POST(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const adapter = Object.hasOwn(BOARD_ADAPTERS, platform) ? BOARD_ADAPTERS[platform] : undefined;
  const secret = adapter ? process.env[adapter.secretEnv] : undefined;
  if (!adapter || !secret) return NextResponse.json({ message: "Unknown platform." }, { status: 404 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_CHARS) return NextResponse.json({ message: "Payload too large." }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return NextResponse.json({ message: "Payload too large." }, { status: 413 });

  if (!adapter.verify(raw, request.headers, secret, new URL(request.url))) {
    return NextResponse.json({ message: "Bad signature." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 });
  }
  const application = adapter.parse(body);
  if (!application) return NextResponse.json({ message: "Invalid payload." }, { status: 400 });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("ingest_board_application", {
    p_channel: platform,
    p_job_ref: application.jobRef,
    p_external_id: application.externalId,
    p_applicant: {
      full_name: application.applicant.fullName,
      email: application.applicant.email,
      phone: application.applicant.phone,
    },
    p_payload: application.summary as Json,
  });
  if (error || !data) {
    reportError("[jobboard webhook] ingest failed", platform, error?.message);
    return NextResponse.json({ message: "Couldn't record the application." }, { status: 500 });
  }

  const result = data as IngestResult;
  if (!result.ok) {
    return NextResponse.json({ message: result.reason }, { status: ingestStatus(result.reason) });
  }

  const resume = application.resumeBase64;
  if (resume && !result.has_resume) {
    after(async () => {
      try {
        await storeBoardResume(admin, { companyId: result.company_id, candidateId: result.candidate_id, base64: resume });
      } catch (err) {
        reportError("[jobboard webhook] resume failed", result.application_id, err);
      }
    });
  }
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
