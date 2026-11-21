/**
 * SMARTBUZ — process-level error hook (BUG-028).
 *
 * There was no error reporting of any kind: a failure in production surfaced
 * as a line of console output that nobody was watching, or as a customer
 * reading their browser console. This file gives the platform a place to
 * report unhandled failures so that they appear in the runtime logs with a
 * machine-readable code that an alert can be raised on.
 *
 * It is deliberately dependency free. Adding an error-reporting service means
 * adding a dependency, a configuration variable and a privacy policy, and the
 * 19 Nov 2026 outage showed what happens when configuration is assumed
 * rather than verified. A log line that always works is worth more than a
 * service that works when it is configured.
 *
 * Two properties matter more than the feature itself:
 *
 *   1. It must never throw. A reporting hook that throws turns one failed
 *      request into two, and during a build it turns a warning into a failed
 *      deployment. Every line below is guarded.
 *
 *   2. It must not leak configuration. Only the error's name, message and
 *      stack are reported. No environment value is ever read here.
 *
 * The errors it catches are the ones that escaped every other layer. Handled
 * application errors are not supposed to reach this file; they belong in the
 * route that produced them.
 */

/**
 * The runtime gate.
 *
 * Next.js loads this module in the Edge runtime as well as in Node. The
 * `process` error events exist in both, but the Node runtime is where the
 * server-side failures we care about happen, and where the platform's log
 * collector reads them.
 */
function isNodeRuntime(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === undefined;
}

/**
 * Reports one error as a single line of JSON.
 *
 * A single line, with a stable `code`, so that a log query can find every
 * occurrence of a given kind of failure without reading prose. The code is
 * the alertable handle: "SMARTBUZ_UNHANDLED_REJECTION" can be turned into an
 * alert without anybody having to read the message first.
 */
function report(code: string, error: unknown): void {
  try {
    const isError = error instanceof Error;
    const name = isError ? error.name : typeof error;
    const message = isError ? error.message : String(error);
    const stack = isError ? error.stack : undefined;

    console.error(
      JSON.stringify({
        level: "error",
        code,
        name,
        message,
        stack,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch {
    // Reporting must never be the reason something else fails. If the
    // console is unavailable, or the error object has a throwing getter,
    // there is nothing useful left to do but stay quiet.
  }
}

/**
 * Registers the hooks.
 *
 * Next.js calls this once when the server starts. It must resolve even when
 * nothing can be registered: a failure to install a logging hook is not a
 * reason to refuse to boot.
 */
export async function register(): Promise<void> {
  try {
    if (!isNodeRuntime()) return;

    process.on("unhandledRejection", (reason: unknown) => {
      report("SMARTBUZ_UNHANDLED_REJECTION", reason);
      // A rejected promise is not, on its own, a reason to kill the server:
      // the request it belonged to may already have been answered, and on a
      // point-of-sale terminal an abrupt restart is worse than a logged
      // rejection. The error is not swallowed - it stays visible in the log.
    });

    process.on("uncaughtException", (error: unknown) => {
      report("SMARTBUZ_UNCAUGHT_EXCEPTION", error);
      // An uncaught exception means the process is in a state we did not
      // expect. Node's default behaviour - crash - is the correct one here:
      // on Vercel the instance is recycled automatically, and a fresh
      // process is safer than one whose invariants are unknown. The exit is
      // deferred by a tick so that the log line is flushed first.
      setTimeout(() => process.exit(1), 0);
    });
  } catch {
    // A build must never fail because a diagnostic hook could not be
    // installed. Losing the hook is a far smaller problem than losing the
    // deployment.
  }
}
