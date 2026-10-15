/** Links in agent replies open in a new tab, so the chat stays put. */
export const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

const APP_ORIGIN = "https://gethired.devhub.co.in";

/** A link into the app: a relative path, or the app's own origin (SEC-014). */
export function isInAppHref(href: string | undefined) {
  if (!href) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.startsWith("/\\");
  try {
    return new URL(href).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

export const inlineLink = "font-medium text-foreground underline underline-offset-4 hover:text-brand";
