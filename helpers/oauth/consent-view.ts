/**
 * What the OAuth consent page shows about the app asking for access
 * (MCP-SEC-012). With dynamic client registration the name is whatever the
 * app said, so the page also shows the host the authorization code is sent to,
 * and warns when the two don't look related.
 */

export type ConsentView = {
  clientName: string;
  /** Where the authorization code goes; null when the URI can't be read. */
  redirectHost: string | null;
  /** A loopback redirect: an app running on the user's own device. */
  isLocal: boolean;
  nameMatchesHost: boolean;
};

// Words too common to show that a name and a host belong together.
const GENERIC_WORDS = new Set([
  "mcp", "app", "apps", "client", "server", "oauth", "auth", "api", "the", "for",
  "and", "inc", "web", "www", "desktop", "connector",
]);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word));

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

function nameMatches(clientName: string, url: URL) {
  const nameWords = words(clientName);
  const compactName = clientName.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Leave out a web host's top-level domain. A custom scheme's "host" (e.g.
  // Cursor's cursor://anysphere.cursor-retrieval) has none.
  const isWeb = url.protocol === "https:" || url.protocol === "http:";
  const labels = url.hostname.split(".");
  const hostWords = words((isWeb && labels.length > 1 ? labels.slice(0, -1) : labels).join(" "));
  return (
    nameWords.some((word) => hostWords.some((label) => label.includes(word))) ||
    hostWords.some((label) => compactName.includes(label))
  );
}

export function consentView({
  clientName,
  redirectUri,
}: {
  clientName: string;
  redirectUri: string;
}): ConsentView {
  const name = clientName.trim() || "An unnamed app";
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return { clientName: name, redirectHost: null, isLocal: false, nameMatchesHost: false };
  }
  const isLocal = isLoopback(url.hostname);
  return {
    clientName: name,
    redirectHost: url.host,
    isLocal,
    // A local app can call itself anything, but only the user's own device gets the code.
    nameMatchesHost: isLocal || nameMatches(name, url),
  };
}

/** The login page, returning to this consent request afterwards. */
export function consentLoginPath(authorizationId: string) {
  const returnTo = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
