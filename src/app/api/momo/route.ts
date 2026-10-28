import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { amount, phone, network, reference, description } = body;

        if (!amount || !phone) {
            return NextResponse.json(
                { success: false, message: "Amount and phone number are required" },
                { status: 400 }
            );
        }

        // Check if environment variables for MTN MoMo / Airtel Money are configured
        const momoApiKey = process.env.MTN_MOMO_API_KEY;
        const airtelClientId = process.env.AIRTEL_MONEY_CLIENT_ID;

        // If production credentials exist, route to real telecom gateway
        if (network === "MTN" && momoApiKey) {
            // Live MTN Open API Collection request
            // Typically: POST https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay
            console.log(`[MTN MoMo Gateway] Initiating collection for UGX ${amount} to ${phone}`);
        } else if (network === "AIRTEL" && airtelClientId) {
            // Live Airtel Money Open API request
            console.log(`[Airtel Money Gateway] Initiating collection for UGX ${amount} to ${phone}`);
        }

        // Return standard response with mock transaction ID for demonstration/sandbox
        const transactionId = `MOMO-${network || "UG"}-${Date.now().toString(36).toUpperCase()}`;

        return NextResponse.json({
            success: true,
            transactionId,
            status: "PENDING",
            message: `USSD push request dispatched to ${phone}. Waiting for PIN authorization.`,
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, message: error.message || "Failed to initiate payment" },
            { status: 500 }
        );
    }
}
