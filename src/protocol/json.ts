import type { ReviewResult } from "./types.js";
import { validateReviewResult } from "./validation.js";

export function serializeReviewResult(result: ReviewResult): string {
  validateReviewResult(result);
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function parseReviewResult(input: string): ReviewResult {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("Review result is not valid JSON");
  }
  validateReviewResult(value as ReviewResult);
  return value as ReviewResult;
}
