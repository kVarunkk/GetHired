import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { client } from "@/lib/dodo/initialize";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const serviceRoleSupabase = createServiceRoleClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  try {
    const { productId, creditAmount, planId } = await request.json();

    if (!productId || !creditAmount || !planId) {
      return NextResponse.json(
        { error: "Missing priceId or creditAmount or planId." },
        { status: 400 }
      );
    }

    // const internalPaymentId = uuidv4();

    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email: user.email ?? "" },
      return_url: `${request.nextUrl.origin}/dashboard/buy-credits/status`,
      metadata: {
        credit_amount: String(creditAmount),
        user_id: user.id,
      },
    });

    // 2. Insert initial PENDING record into your payments table
    const { error: insertError } = await serviceRoleSupabase
      .from("payments")
      .insert({
        user_id: user.id,
        session_id: session.session_id, // Stripe's session ID
        product_id: productId,
        credit_amount: creditAmount,
        price_plan_id: planId,
        status: "pending",
      });

    if (insertError) {
      console.error("Failed to insert pending payment record:", insertError);
      throw insertError;
    }

    return NextResponse.json({ checkoutUrl: session.checkout_url });
  } catch (error) {
    console.error("Stripe Checkout Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Some error occurred.",
      },
      { status: 500 }
    );
  }
}
