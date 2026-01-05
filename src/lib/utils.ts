import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^\[CONVEX[\s\S]*?\]\s*/, "") // Remove [CONVEX ...]
    .replace(/^\[Request ID:[\s\S]*?\]\s*/, "") // Remove [Request ID: ...]
    .replace(/^Server Error\s*/, "")
    .replace(/^Uncaught Error:\s*/, "")
    .replace(/\s*at handler[\s\S]*$/, "") // Remove "at handler" and everything after including newlines
    .replace(/\s*Called by client[\s\S]*$/, "") // Remove "Called by client" and everything after including newlines
    .trim();
}
