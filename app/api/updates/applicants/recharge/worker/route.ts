import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { sendEmailForRecharge } from "@/helpers/user/send-recharge-email";

type RechargeJobMessage = {
  msg_id: number;
  read_ct: number;
  message: {
    name: string;
    email: string;
  };
};

const BATCH_SIZE = 5;
const VISIBILITY_TIMEOUT = 60;
const MAX_RETRIES = 3;

export async function GET() {
  const headersList = await headers();
  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access" },
      { status: 401 },
    );
  }

  const supabase = createServiceRoleClient();

  try {
    const { data: messages, error } = (await supabase
      .schema("pgmq_public")
      .rpc("read", {
        queue_name: "recharge_jobs",
        sleep_seconds: VISIBILITY_TIMEOUT,
        n: BATCH_SIZE,
      })) as { data: RechargeJobMessage[] | null; error: Error | null };

    if (error) {
      await sendEmailForStatusUpdate(
        `RECHARGE WORKER: Failed to read queue.\n${error.message}`,
      );
      return NextResponse.json(
        { success: false, message: "Failed to read queue." },
        { status: 500 },
      );
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ success: true, message: "Queue is empty." });
    }

    const results = await Promise.allSettled(
      messages.map(async (msg) => {
        const { name, email } = msg.message;

        const result = await sendEmailForRecharge(email, name);

        if (result.success) {
          await supabase.schema("pgmq_public").rpc("delete", {
            queue_name: "recharge_jobs",
            message_id: msg.msg_id,
          });
        } else {
          console.warn(
            `[WORKER] Message ${msg.msg_id} failed. Attempt count: ${msg.read_ct}`,
          );

          if (msg.read_ct >= MAX_RETRIES) {
            console.error(
              `[WORKER] Message ${msg.msg_id} exceeded max retries (${MAX_RETRIES}). Evicting...`,
            );

            await supabase.schema("pgmq_public").rpc("delete", {
              queue_name: "recharge_jobs",
              message_id: msg.msg_id,
            });

            await sendEmailForStatusUpdate(
              `RECHARGE WORKER POISON ALERT: Message ${msg.msg_id} for User ${name} dropped after failing ${msg.read_ct} times.`,
            );
          }
        }

        return { ...result, msgId: msg.msg_id };
      }),
    );

    const successful = results.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ).length;
    const failed = results.length - successful;

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} messages. Success: ${successful}, Failed: ${failed}.`,
    });
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "unknown error occured.";
    await sendEmailForStatusUpdate(
      `RECHARGE WORKER CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: errorMsg },
      { status: 500 },
    );
  }
}
