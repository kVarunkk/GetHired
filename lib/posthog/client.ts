import type { PostHog } from "posthog-js";

// posthog-js loads on the visitor's first interaction (see
// instrumentation-client.ts), not with the page: it is the largest script on
// the landing pages. Import this instead of "posthog-js" in client code. Calls
// made before it loads are queued and replayed after init; posthog-js itself
// would drop them.

let instance: PostHog | null = null;
let loading: Promise<PostHog> | null = null;
const queue: ((posthog: PostHog) => void)[] = [];

export function loadPostHog(): Promise<PostHog> {
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      defaults: "2026-05-30",
      // listenForUncaughtErrors (report-client-error.ts) already reports
      // these, from page load on. This also overrides the project setting.
      capture_exceptions: false,
    });
    instance = posthog;
    for (const call of queue.splice(0)) call(posthog);
    return posthog;
  });
  return loading;
}

function run(call: (posthog: PostHog) => void) {
  if (instance) call(instance);
  else queue.push(call);
}

const posthog = {
  capture: (...args: Parameters<PostHog["capture"]>) => run((p) => p.capture(...args)),
  identify: (...args: Parameters<PostHog["identify"]>) => run((p) => p.identify(...args)),
  reset: (...args: Parameters<PostHog["reset"]>) => run((p) => p.reset(...args)),
  captureException: (...args: Parameters<PostHog["captureException"]>) => {
    run((p) => p.captureException(...args));
    // Don't wait for an interaction to report a crash.
    void loadPostHog();
  },
};

export default posthog;
