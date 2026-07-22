import PostHogClient from "@/app/posthog";
import { PostHogEvent } from "@/utils/types";

export async function eventCaptureServer({
  event,
  distinctId,
  properties = {},
}: {
  event: PostHogEvent;
  distinctId: string;
  properties?: Record<string, unknown>;
}) {
  try {
    const posthog = PostHogClient();
    console.log(distinctId, event, properties);
    posthog.capture({ distinctId, event, properties });
    await posthog.shutdown();
  } catch (err) {
    console.error(`[posthog] failed to capture "${event}"`, err);
  }
}
