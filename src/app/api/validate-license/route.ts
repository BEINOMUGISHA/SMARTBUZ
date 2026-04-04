import { NextRequest, NextResponse } from "next/server";

const VALID_LICENSE_KEYS = [
  "TIENS-2026-PAID-FULL",
  "DEMO-LICENSE-KEY-001",
];

export async function POST(request: NextRequest) {
  try {
    const { licenseKey } = await request.json();

    if (!licenseKey) {
      return NextResponse.json(
        { valid: false, message: "License key is required" },
        { status: 400 }
      );
    }

    const isValid = VALID_LICENSE_KEYS.includes(licenseKey.trim().toUpperCase());

    if (isValid) {
      return NextResponse.json({ valid: true });
    } else {
      return NextResponse.json(
        { valid: false, message: "Invalid license key" },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { valid: false, message: "Server error" },
      { status: 500 }
    );
  }
}
