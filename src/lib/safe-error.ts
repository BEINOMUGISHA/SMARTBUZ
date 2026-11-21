/**
 * SMARTBUZ — turning a backend error into something safe to show.
 *
 * A Convex function that throws sends its message to the browser. That is
 * exactly right for the messages the backend writes on purpose — "Your plan
 * does not include the credit book" is meant to be read by the person
 * standing at the till.
 *
 * It is not right for the errors nobody planned for. An uncaught
 * exception can carry the file it came from, the line it happened on, and
 * the shape of the data it choked on. None of that helps the operator, and
 * all of it helps somebody who is looking for a way in.
 *
 * So a message is shown when it reads like something a person wrote for a
 * person, and replaced with a plain apology when it does not. The detail
 * is written to the server's log, where it belongs.
 */

/** The things in an error message that give the shape of the code away. */
const INTERNAL_MARKERS: RegExp[] = [
  /\bat\s+\S+\.(ts|tsx|js|mjs|cjs)\b/i, // a stack frame
  /\bnode_modules\b/i,
  /\bconvex\/[a-z]/i, // a path inside the backend
  /\b(src|app|lib)\/\S+\.(ts|tsx)\b/i, // a path inside the app
  /\bUncaught\b/i,
  /\bTypeError\b|\bReferenceError\b|\bRangeError\b|\bSyntaxError\b/i,
  /\bnull is not an object\b|\bcannot read propert/i,
  /\bstack\b/i,
  /\b\d{1,3}(\.\d{1,3}){3}\b/, // an address
];

/**
 * The message to show a person.
 *
 * `detail` is whatever the backend said. If it reads like a message
 * written for a person, it is returned unchanged. Otherwise the fallback
 * is returned and the detail is logged.
 */
export function safeErrorMessage(
  detail: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  const text = typeof detail === "string" ? detail.trim() : "";

  if (!text) return fallback;

  // A message that is short and carries no marker of an internal failure
  // is a message the backend meant a person to read.
  if (text.length <= 300 && !INTERNAL_MARKERS.some((marker) => marker.test(text))) {
    return text;
  }

  console.error("SMARTBUZ: internal error detail:", detail);
  return fallback;
}

/**
 * A short description of an error, for the server's log.
 *
 * It keeps the message and the name of the error, and drops everything
 * else — a stack is not useful once the message says what happened.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "an unknown error";
  }
}
