import { httpRouter } from "convex/server";
import { jwks } from "./jwks";
import { paymentCallback } from "./integrations/webhooks";

const http = httpRouter();

http.route({ path: "/auth/jwks", method: "GET", handler: jwks });

/**
 * The payment callback.
 *
 * This is the one address a payment provider is allowed to call. It is
 * unauthenticated by nature — the provider is not a signed-in member of
 * staff — and is authenticated instead by the reference it names and by
 * the signature the business configured.
 *
 * See `convex/integrations/webhooks.ts` for what it accepts and what it
 * refuses.
 */
http.route({
    path: "/payments/callback",
    method: "POST",
    handler: paymentCallback,
});

export default http;
