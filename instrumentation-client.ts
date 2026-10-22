import { loadPostHog } from "@/lib/posthog/client";
import { listenForUncaughtErrors } from "@/lib/posthog/report-client-error";

// Errors are reported from the start; captureException loads PostHog itself.
listenForUncaughtErrors();

// Analytics (PostHog, Google Analytics) load on the visitor's first
// interaction, or after FALLBACK_MS, not with the page. Together they were
// most of the main-thread work before the landing pages became interactive.
const GA_ID = "G-4704XKQWMK";
const FALLBACK_MS = 15_000;
const TRIGGERS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

function loadGoogleAnalytics() {
  const w = window as Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // gtag.js reads the arguments object, not an array.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag("js", new Date());
  w.gtag("config", GA_ID);
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);
}

function loadAnalytics() {
  for (const type of TRIGGERS) window.removeEventListener(type, loadAnalytics);
  clearTimeout(timer);
  void loadPostHog();
  loadGoogleAnalytics();
}

for (const type of TRIGGERS) window.addEventListener(type, loadAnalytics, { passive: true });
const timer = setTimeout(loadAnalytics, FALLBACK_MS);
