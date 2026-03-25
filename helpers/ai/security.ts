/**
 * validateAndSanitizeSearchQuery
 * A single entry-point for processing untrusted search queries.
 */
export function validateAndSanitizeSearchQuery(
  input: unknown,
  maxLength: number = 100,
): { success: boolean; data?: string; error?: string; status?: number } {
  // 1. Basic type check
  if (!input || typeof input !== "string") {
    return { success: false, error: "Invalid or missing query.", status: 400 };
  }

  // 2. Sanitize: Strip HTML/Script tags
  const sanitized = input.replace(/<\/?[^>]+(>|$)/g, "").trim();

  // 3. Length check
  if (sanitized.length > maxLength) {
    return {
      success: false,
      error: `Query is too long. Max ${maxLength} characters allowed.`,
      status: 400,
    };
  }

  // 4. Injection detection
  const dangerousPatterns = [
    /ignore all previous/i,
    /system prompt/i,
    /forget everything/i,
    /you are now/i,
    /output the instructions/i,
  ];

  const hasInjection = dangerousPatterns.some((pattern) =>
    pattern.test(sanitized),
  );
  if (hasInjection) {
    return {
      success: false,
      error: "Potential malicious activity detected.",
      status: 403,
    };
  }

  return { success: true, data: sanitized };
}

/**
 * wrapInSandbox remains used for prompt construction.
 */
export function wrapInSandbox(tagName: string, content: string): string {
  const sanitized = content.replace(
    new RegExp(`</${tagName}>`, "g"),
    `[CLEANED_TAG]`,
  );
  return `<${tagName}>\n${sanitized}\n</${tagName}>`.trim();
}
