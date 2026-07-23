import PostHogClient from "@/app/posthog";

export async function eventCaptureServerException({
  error,
  distinctId,
  properties = {},
}: {
  error: unknown;
  distinctId?: string;
  properties?: Record<string, unknown>;
}) {
  try {
    const posthog = PostHogClient();
    posthog.captureException(error, distinctId, properties);
    await posthog.shutdown();
  } catch (err) {
    console.error("[posthog] failed to capture exception", err);
  }
}
