import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getDodoClient } from "@/lib/dodo/initialize";

// BL-F01: the body only names a plan. The product and the credit amount come
// from price_plan, so a client can't pay for one pack and be credited another.
// Any other fields in the body are ignored.
const bodySchema = z.object({ planId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
  }
  const { planId } = parsed.data;

  const serviceRoleSupabase = createServiceRoleClient();

  const { data: plan } = await serviceRoleSupabase
    .from("price_plan")
    .select("id, product_id, credit_amount, audience")
    .eq("id", planId)
    .eq("audience", "applicant")
    .maybeSingle();

  if (
    !plan ||
    plan.audience !== "applicant" ||
    !plan.product_id ||
    !plan.credit_amount
  ) {
    return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
  }

  // The row is created first so its id can go in the checkout metadata: the
  // webhook fulfils from this row, never from amounts in the payload.
  const { data: payment, error: insertError } = await serviceRoleSupabase
    .from("payments")
    .insert({
      user_id: user.id,
      product_id: plan.product_id,
      credit_amount: plan.credit_amount,
      price_plan_id: plan.id,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !payment) {
    console.error("Failed to insert pending payment record:", insertError);
    return NextResponse.json(
      { error: "Couldn't start the checkout." },
      { status: 500 },
    );
  }

  try {
    const session = await getDodoClient().checkoutSessions.create({
      product_cart: [{ product_id: plan.product_id, quantity: 1 }],
      customer: { email: user.email ?? "" },
      return_url: `${request.nextUrl.origin}/dashboard/buy-credits/status`,
      metadata: {
        payment_row_id: payment.id,
        user_id: user.id,
        kind: "applicant_credits",
      },
    });

    const { error: sessionError } = await serviceRoleSupabase
      .from("payments")
      .update({ session_id: session.session_id })
      .eq("id", payment.id);

    if (sessionError) {
      // The webhook finds the row by payment_row_id, so this is recoverable.
      console.error("Failed to store the checkout session id:", sessionError);
    }

    return NextResponse.json({ checkoutUrl: session.checkout_url });
  } catch (error) {
    console.error("Dodo Checkout Error:", error);
    await serviceRoleSupabase
      .from("payments")
      .update({
        status: "failed",
        failure_reason: "checkout_session_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id);

    return NextResponse.json(
      { error: "Couldn't start the checkout." },
      { status: 500 },
    );
  }
}
