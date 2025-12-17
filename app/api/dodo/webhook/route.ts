import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { client } from "@/lib/dodo/initialize";
import { WebhookPayload } from "dodopayments/resources/webhook-events.mjs";
import { SendPaymentUpdateEmail } from "@/lib/dodo/utils";
import { IPayment, TPaymentStatus } from "@/lib/types";

// LISTENING FOR THE FOLLOWING EVENTS:
// 1) payment.failed
// 2) payment.cancelled
// 3) payment.processing
// 4) payment.succeeded

// BUT ACCORDING TO DISCORD DISCUSSION, ONLY:
// 1) payment.succeeded
// 2) payment.failed
// EVENTS ARE TRIGGERED FOR ONE TIME PAYMENT.

export async function POST(req: NextRequest) {
  const serviceRoleSupabase = createServiceRoleClient();

  const webhookSignature = req.headers.get("webhook-signature");
  const webhookTimestamp = req.headers.get("webhook-timestamp");
  const webhookId = req.headers.get("webhook-id");
  const reqText = await req.text();
  const body = JSON.parse(reqText);
  const eventType = body.type;
  const webhookPayload = body.data as WebhookPayload.Payment;
  let userName;
  let email;

  try {
    client.webhooks.unwrap(reqText, {
      headers: {
        "webhook-id": webhookId as string,
        "webhook-signature": webhookSignature as string,
        "webhook-timestamp": webhookTimestamp as string,
      },
    });
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed.", err);
    return NextResponse.json(
      { error: "Webhook Error: Invalid Signature" },
      { status: 400 }
    );
  }

  const { data, error } = await serviceRoleSupabase
    .from("user_info")
    .select("full_name, email")
    .eq("user_id", webhookPayload.metadata.user_id)
    .single();

  if (data && !error) {
    userName = data.full_name ?? data.email.split("@")[0];
    email = data.email;
  }

  // FAILED
  if (eventType === "payment.failed") {
    const { error: paymentUpdateError } = await serviceRoleSupabase
      .from("payments")
      .update({
        status: "failed",
        credits_fulfilled: false,
        payment_id: webhookPayload.payment_id,
        failure_reason: webhookPayload.error_message ?? "unknown",
        updated_at: new Date().toISOString(),
        currency: webhookPayload.currency,
        total_amount: webhookPayload.total_amount,
        billing: webhookPayload.billing,
        customer: webhookPayload.customer,
      })
      .eq("user_id", webhookPayload.metadata?.user_id)
      .eq("session_id", webhookPayload.checkout_session_id);

    if (paymentUpdateError) {
      return NextResponse.json(
        { error: "Failed to update payment record inside payment.failed" },
        { status: 500 }
      );
    }

    const { error, success } = await SendPaymentUpdateEmail({
      userName,
      email,
      paymentDetails: {
        status: "failed" as TPaymentStatus,
        total_amount: webhookPayload.total_amount,
        currency: webhookPayload.currency,
        credit_amount: Number(webhookPayload.metadata.credit_amount),
        payment_method: webhookPayload.payment_method ?? "",
        payment_id: webhookPayload.payment_id,
      } as unknown as IPayment,
    });

    if (!error && success) {
      await serviceRoleSupabase
        .from("payments")
        .update({ email_sent: true })
        .eq("payment_id", webhookPayload.payment_id);
    }

    return NextResponse.json({
      received: true,
      message:
        error && !success
          ? "Payment failed. Email not sent."
          : "Payment failed.",
    });
  }

  // CANCELLED
  if (eventType === "payment.cancelled") {
    const { error: paymentUpdateError } = await serviceRoleSupabase
      .from("payments")
      .update({
        status: "cancelled",
        credits_fulfilled: false,
        payment_id: webhookPayload.payment_id,
        failure_reason: webhookPayload.error_message ?? "unknown",
        updated_at: new Date().toISOString(),
        currency: webhookPayload.currency,
        total_amount: webhookPayload.total_amount,
        billing: webhookPayload.billing,
        customer: webhookPayload.customer,
      })
      .eq("user_id", webhookPayload.metadata?.user_id)
      .eq("session_id", webhookPayload.checkout_session_id);

    if (paymentUpdateError) {
      return NextResponse.json(
        { error: "Failed to update payment record inside payment.cancelled" },
        { status: 500 }
      );
    }

    const { error, success } = await SendPaymentUpdateEmail({
      userName,
      email,
      paymentDetails: {
        status: "cancelled" as TPaymentStatus,
      } as unknown as IPayment,
    });

    if (!error && success) {
      await serviceRoleSupabase
        .from("payments")
        .update({ email_sent: true })
        .eq("payment_id", webhookPayload.payment_id);
    }

    return NextResponse.json({
      received: true,
      message:
        error && !success
          ? "Payment cancelled. Email not sent."
          : "Payment cancelled.",
    });
  }

  // PROCESSING
  if (eventType === "payment.processing") {
    const { error: paymentUpdateError } = await serviceRoleSupabase
      .from("payments")
      .update({
        status: "pending",
        credits_fulfilled: false,
        payment_id: webhookPayload.payment_id,
        // failure_reason: webhookPayload.error_message ?? "unknown",
        updated_at: new Date().toISOString(),
        currency: webhookPayload.currency,
        total_amount: webhookPayload.total_amount,
        billing: webhookPayload.billing,
        customer: webhookPayload.customer,
      })
      .eq("user_id", webhookPayload.metadata?.user_id)
      .eq("session_id", webhookPayload.checkout_session_id);

    if (paymentUpdateError) {
      return NextResponse.json(
        {
          error:
            "Failed to update payment record inside payment.failed. " +
            paymentUpdateError.message,
        },
        { status: 500 }
      );
    }

    const { error, success } = await SendPaymentUpdateEmail({
      userName,
      email,
      paymentDetails: {
        status: "pending" as TPaymentStatus,
        total_amount: webhookPayload.total_amount,
        currency: webhookPayload.currency,
        credit_amount: Number(webhookPayload.metadata.credit_amount),
        payment_method: webhookPayload.payment_method ?? "",
        payment_id: webhookPayload.payment_id,
      } as unknown as IPayment,
    });

    return NextResponse.json({
      received: true,
      message:
        error && !success
          ? "Payment processing. Email not sent."
          : "Payment processing.",
    });
  }

  // SUCCEEDED
  if (eventType === "payment.succeeded") {
    const payment_id = webhookPayload.payment_id;
    const { credit_amount, user_id } = webhookPayload.metadata || {};

    if (!user_id || !payment_id || !credit_amount) {
      console.error(
        "Webhook Error: Missing required fulfillment data in session metadata.",
        { user_id, payment_id, credit_amount }
      );
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }

    const credits = parseInt(credit_amount, 10);

    try {
      // Idempotency Check: Ensure we haven't already fulfilled this payment
      const { data: payment } = await serviceRoleSupabase
        .from("payments")
        .select("credits_fulfilled")
        .eq("user_id", user_id)
        .eq("session_id", webhookPayload.checkout_session_id)
        .single();

      if (payment?.credits_fulfilled) {
        return NextResponse.json({
          received: true,
          message: "Credit payment already fulfilled.",
        });
      }

      const { data: userInfoData, error: userInfoError } =
        await serviceRoleSupabase
          .from("user_info")
          .select("ai_credits")
          .eq("user_id", user_id)
          .single();

      if (userInfoError || !userInfoData) {
        throw new Error(`User retrieval failed: ${userInfoError?.message}`);
      }
      // A. Fulfill the order: Increment User Credits
      const { error: creditError } = await serviceRoleSupabase
        .from("user_info")
        .update({
          ai_credits: (userInfoData.ai_credits || 0) + credits,
        })
        .eq("user_id", user_id);

      if (creditError)
        throw new Error(`Credit update failed: ${creditError.message}`);

      // B. Mark payment record as fulfilled
      const { error: updateError } = await serviceRoleSupabase
        .from("payments")
        .update({
          status: "complete",
          credits_fulfilled: true,
          payment_id: webhookPayload.payment_id,
          fulfillment_date: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          currency: webhookPayload.currency,
          total_amount: webhookPayload.total_amount,
          billing: webhookPayload.billing,
          customer: webhookPayload.customer,
        })
        .eq("user_id", user_id)
        .eq("session_id", webhookPayload.checkout_session_id);

      if (updateError)
        throw new Error(`Payment record update failed: ${updateError.message}`);

      const { error, success } = await SendPaymentUpdateEmail({
        userName,
        email,
        paymentDetails: {
          status: "complete" as TPaymentStatus,
          total_amount: webhookPayload.total_amount,
          currency: webhookPayload.currency,
          credit_amount: Number(webhookPayload.metadata.credit_amount),
          payment_method: webhookPayload.payment_method ?? "",
          payment_id: webhookPayload.payment_id,
        } as unknown as IPayment,
      });

      if (!error && success) {
        await serviceRoleSupabase
          .from("payments")
          .update({ email_sent: true })
          .eq("payment_id", webhookPayload.payment_id);
      }

      return NextResponse.json({
        received: true,
        message:
          error && !success
            ? "Payment fulfilled. Email not sent."
            : "Payment fulfilled.",
      });
    } catch (err) {
      console.error("Fulfillment Error:", err);
      return NextResponse.json(
        {
          error: `Fulfillment Error: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    received: true,
    message: `Unhandled event type: ${eventType}`,
  });
}
