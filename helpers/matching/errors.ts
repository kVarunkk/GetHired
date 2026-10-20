import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";

/** The safe error codes stored and returned for matching and screening (MT-SEC-005). */
export const MATCH_ERROR_CODES = ["model_error", "invalid_output", "timeout"] as const;

export type MatchErrorCode = (typeof MATCH_ERROR_CODES)[number];

/** Maps a model-call failure to a safe code. Never exposes the raw message. */
export function matchErrorCode(error: unknown, signal?: AbortSignal): MatchErrorCode {
  if (signal?.aborted) return "timeout";
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "timeout";
  }
  if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
    return "invalid_output";
  }
  return "model_error";
}
