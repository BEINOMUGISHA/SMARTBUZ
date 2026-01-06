import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatError(error: unknown): string {
  if (!error) return "An unknown error occurred";

  const rawMessage = error instanceof Error ? error.message : String(error);

  // 1. Handle Convex Validation Errors specifically
  if (rawMessage.includes("ArgumentValidationError") || rawMessage.includes("validator")) {
    if (rawMessage.includes("extra field")) {
      const match = rawMessage.match(/extra field `([^`]+)`/);
      return match ? `Validation Error: Unexpected information found (${match[1]})` : "Validation Error: The data provided is not in the correct format.";
    }
    if (rawMessage.includes("is required")) {
      const match = rawMessage.match(/field `([^`]+)` is required/);
      return match ? `Missing Info: ${match[1]} is required to complete this action.` : "Validation Error: Some required information is missing.";
    }
    return "The data provided is incorrect. Please check your entries and try again.";
  }

  // 2. Handle generic system/server messages
  let message = rawMessage
    .replace(/^\[CONVEX[\s\S]*?\]\s*/, "") // Remove [CONVEX ...]
    .replace(/^\[Request ID:[\s\S]*?\]\s*/, "") // Remove [Request ID: ...]
    .replace(/^ArgumentValidationError:\s*/, "")
    .replace(/^Validator:\s*v\.object[\s\S]*$/, "")
    .replace(/^Server Error\s*/, "")
    .replace(/^Uncaught Error:\s*/, "")
    .replace(/\s*at handler[\s\S]*$/, "") // Remove stack trace
    .replace(/\s*Called by client[\s\S]*$/, "")
    .split("\n")[0] // Only take the first line
    .trim();

  // 3. Fallback if message became empty after stripping
  if (!message) return "An error occurred on the server. Please try again.";

  // 4. Final polish: Ensure it starts with a capital and ends with a period if it's a sentence
  message = message.charAt(0).toUpperCase() + message.slice(1);
  if (!message.endsWith(".") && !message.endsWith("!") && !message.endsWith("?")) {
    message += ".";
  }

  return message;
}
