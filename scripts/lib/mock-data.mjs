/**
 * SMART_BUZ — the demo loader, shared by the development scripts.
 *
 * The month of demo trading is written in batches, because a Convex
 * transaction has a size and a time limit and a month of sales is more than
 * one transaction should carry. This walks the batches until the seeder
 * says there is nothing left, and hands back the first report.
 */
import { convex, ok, errText } from "./harness.mjs";

/**
 * Load the demo data into a business.
 *
 * @param {object} options
 * @param {string} options.businessId    The business to fill.
 * @param {string} options.token         The owner's access token.
 * @param {string} options.serverSecret  The server-to-backend secret.
 * @param {string} options.deployment    The deployment the caller expects to write to.
 * @param {(report: any) => void} [options.onBatch] Called after every batch.
 * @returns {Promise<any>} The first batch's report.
 */
export async function loadMockData({
    businessId,
    token,
    serverSecret,
    deployment,
    onBatch,
}) {
    let cursor = 0;
    let first = null;
    let batch = 0;

    for (;;) {
        const res = await convex(
            "mutation",
            "devMockData:seedMockData",
            { businessId, serverSecret, cursor, devDeployment: deployment },
            token
        );
        if (!ok(res)) {
            const error = new Error(`seeding failed: ${errText(res)}`);
            error.response = res;
            throw error;
        }

        const report = res.value;
        if (!first) first = report;

        batch += 1;
        if (onBatch) onBatch(report, batch);

        if (report.nextCursor === null || report.nextCursor === undefined) break;
        cursor = report.nextCursor;
    }

    return first;
}
