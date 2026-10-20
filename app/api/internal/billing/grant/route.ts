import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { applyBillingGrant, grantSchema, GrantError } from "@/helpers/billing/grant";

// BL-REQ-015: set a company's plan until a date and/or grant credits.
// Authenticated with x-api-key (the internal secret).
export async function POST(req: NextRequest) {
  if (!INTERNAL_API_SECRET || req.headers.get("x-api-key") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = grantSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid grant." },
      { status: 400 },
    );
  }

  try {
    const result = await applyBillingGrant(createServiceRoleClient(), parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof GrantError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[billing] grant failed", err);
    return NextResponse.json({ error: "Grant failed." }, { status: 500 });
  }
}
