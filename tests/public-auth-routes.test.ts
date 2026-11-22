/**
 * SMARTBUZ — tests for the server side of the public auth routes.
 *
 * The sign-in, register, address-verification and password-reset routes
 * used to call the backend through the Convex client, which meant the
 * sign-in screen downloaded 24 KB gzipped of client it did not use. They
 * now call this server, and the server calls the backend.
 *
 * Two things have to hold, and they are what these tests are about:
 *
 *   - when the backend cannot be reached, the route says so. It must not
 *     answer "success" (that would tell a person their account was made
 *     when it was not), and it must not answer with the backend's error
 *     message (that would tell a person their password was wrong when the
 *     server was down);
 *   - the backend's own message is passed back untouched when the backend
 *     *did* answer, because "An account with this email already exists"
 *     is the answer the person needs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    convexMutation,
    extractConvexErrorMessage,
    serverSecret,
} from "../src/lib/convex-server";
import {
    handleRegister,
    handleResetPassword,
    handleVerifyEmail,
} from "../src/lib/public-auth";

/**
 * A request as the handlers see it.
 *
 * The handlers read the caller's address from the headers, and that is
 * all they use the request for.
 */
function fakeRequest() {
  return { headers: new Headers() } as unknown as Request;
}

describe("reading the backend's error message", () => {
    it("takes the message out of an errorMessage field", () => {
        assert.equal(
            extractConvexErrorMessage({ errorMessage: "Invalid or expired reset code" }),
            "Invalid or expired reset code"
        );
    });

    it("takes the message out of a message field", () => {
        assert.equal(
            extractConvexErrorMessage({ message: "Password must be at least 8 characters long" }),
            "Password must be at least 8 characters long"
        );
    });

    it("has nothing to say about a body that carries no message", () => {
        assert.equal(extractConvexErrorMessage({ status: "error" }), undefined);
        assert.equal(extractConvexErrorMessage(null), undefined);
        assert.equal(extractConvexErrorMessage(undefined), undefined);
        assert.equal(extractConvexErrorMessage("not an object"), undefined);
    });

    it("does not mistake a non-string field for a message", () => {
        assert.equal(extractConvexErrorMessage({ errorMessage: { nested: true } }), undefined);
    });
});

describe("the shared server secret", () => {
    it("prefers SMARTBUZ_SERVER_SECRET over the fallbacks", () => {
        const original = {
            smartbuz: process.env.SMARTBUZ_SERVER_SECRET,
            resend: process.env.RESEND_API_KEY,
            session: process.env.SESSION_SECRET,
        };

        try {
            process.env.SMARTBUZ_SERVER_SECRET = "the-real-one";
            process.env.RESEND_API_KEY = "the-fallback";
            process.env.SESSION_SECRET = "the-last-one";
            assert.equal(serverSecret(), "the-real-one");

            delete process.env.SMARTBUZ_SERVER_SECRET;
            assert.equal(serverSecret(), "the-fallback");

            delete process.env.RESEND_API_KEY;
            assert.equal(serverSecret(), "the-last-one");

            delete process.env.SESSION_SECRET;
            assert.equal(serverSecret(), undefined);
        } finally {
            for (const [name, value] of [
                ["SMARTBUZ_SERVER_SECRET", original.smartbuz],
                ["RESEND_API_KEY", original.resend],
                ["SESSION_SECRET", original.session],
            ] as const) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
        }
    });
});

describe("calling the backend when it cannot be reached", () => {
    it("says the backend was unreachable rather than reporting a failure", async () => {
        // The test process has no NEXT_PUBLIC_CONVEX_URL, so the deployment
        // address is the placeholder and the call cannot succeed.
        const { CONVEX_URL, IS_CONVEX_URL_CONFIGURED } = await import("../src/lib/convex-url");
        assert.equal(IS_CONVEX_URL_CONFIGURED, false);
        assert.ok(CONVEX_URL.includes("placeholder"));

        const result = await convexMutation("users:register", { email: "a@b.test" });
        assert.equal(result.ok, false);
        assert.equal(result.unreachable, true);
    });
});

describe("the public auth handlers", () => {
    it("register refuses to claim success when the backend is down", async () => {
        const result = await handleRegister(
            {
                first_name: "Test",
                last_name: "Person",
                email: "test@example.test",
                password: "a-good-password",
            },
            fakeRequest()
        );

        assert.equal(result.status, 503);
        assert.equal(result.body.success, false);
        assert.match(result.body.error ?? "", /could not reach the server/i);
    });

    it("register checks what it is given before it calls anything", async () => {
        const noName = await handleRegister(
            { email: "a@b.test", password: "longenough" },
            fakeRequest()
        );
        assert.equal(noName.status, 400);

        const noEmail = await handleRegister(
            { first_name: "A", last_name: "B", password: "longenough" },
            fakeRequest()
        );
        assert.equal(noEmail.status, 400);

        const shortPassword = await handleRegister(
            { first_name: "A", last_name: "B", email: "a@b.test", password: "short" },
            fakeRequest()
        );
        assert.equal(shortPassword.status, 400);
        assert.match(shortPassword.body.error ?? "", /at least 8 characters/i);
    });

    it("verify-email refuses to claim success when the backend is down", async () => {
        const result = await handleVerifyEmail({ email: "a@b.test", code: "123456" });

        assert.equal(result.status, 503);
        assert.equal(result.body.success, false);
    });

    it("verify-email checks what it is given before it calls anything", async () => {
        const result = await handleVerifyEmail({ email: "a@b.test" });
        assert.equal(result.status, 400);
    });

    it("reset-password refuses to claim success when the backend is down", async () => {
        const result = await handleResetPassword({
            email: "a@b.test",
            code: "123456",
            newPassword: "a-good-password",
        });

        assert.equal(result.status, 503);
        assert.equal(result.body.success, false);
    });

    it("reset-password refuses a password that is too short", async () => {
        const result = await handleResetPassword({
            email: "a@b.test",
            code: "123456",
            newPassword: "short",
        });
        assert.equal(result.status, 400);
        assert.match(result.body.error ?? "", /at least 8 characters/i);
    });
});
