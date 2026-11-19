/**
 * SMARTBUZ — weighing scales.
 *
 * Two ways to reach a scale, because scales differ:
 *
 *   - **Serial** — the scale is plugged into the till and reports over
 *     a serial line. This is the common USB-and-weighing-machine setup.
 *   - **HTTP** — the scale is on the network and reports to a URL.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * It does not calibrate the scale, and it cannot tell a wrong scale from
 * a right one. A scale reading a kilo too heavy gives a price a kilo too
 * high, and nothing here can detect it. **The shop must check the scale
 * against a known weight.** That is why every reading reports
 * `verified: false`: the number came off the scale, but nobody has
 * confirmed the scale is right.
 *
 * The default parser refuses a line it cannot read rather than guessing
 * a number out of it. A guessed weight is a wrong price.
 */

/** A reading from a scale. */
export interface ScaleReading {
    /** The weight, in the scale's own unit. */
    weight: number;
    /** The unit the scale reported. */
    unit: string;
    /** Whether the scale said the weight was stable. */
    stable: boolean;
    /** Where the reading came from. */
    source: "serial" | "http";
    /**
     * True only when the reading is known to be from real hardware.
     *
     * A network scale reports its own reading, but SMARTBUZ cannot
     * confirm the scale was zeroed or calibrated, so it is never true
     * here.
     */
    verified: boolean;
    /** What happened, in words. */
    detail: string;
}

/** How a serial scale is set up. */
export interface SerialScaleOptions {
    baudRate?: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "even" | "odd";
    /** Read a line yourself instead of using the default parser. */
    parse?: (line: string) => { weight: number; unit: string; stable: boolean } | null;
}

/**
 * Read a line a scale has sent.
 *
 * The shapes scales actually send:
 *
 *   `1.250 kg`      `1.250kg ST`      `+ 1.250 kg`
 *   `ST,GS,+1.250 kg`                   `  1.250  kg  `
 *
 * A line that cannot be read returns `null`. It never returns a
 * guessed number.
 */
export function parseScaleLine(
    line: string
): { weight: number; unit: string; stable: boolean } | null {
    if (!line) return null;

    const text = line.trim();
    if (!text) return null;

    // The stable flag: scales mark a settled weight with S, ST or GS.
    const stable = /\b(?:ST|GS|S)\b/.test(text) || /,S\b/.test(text);

    // Take the first number that looks like a weight.
    const match = /([+-]?\d+(?:[.,]\d+)?)\s*([A-Za-z]{1,5})?/.exec(text);
    if (!match) return null;

    const rawWeight = match[1].replace(",", ".");
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight)) return null;

    // The unit is the letters after the number, if they are a unit and
    // not a marker such as ST.
    let unit = (match[2] ?? "").toLowerCase();
    if (!unit || ["st", "gs", "s", "t", "wt"].includes(unit)) {
        unit = "";
    }

    return { weight, unit, stable };
}

/**
 * The serial scale's controls.
 */
export interface SerialScale {
    /** Ask for the port and open it. */
    connect(): Promise<void>;
    /** Read a weight from the scale. */
    read(): Promise<ScaleReading>;
    /** Close the port. */
    disconnect(): Promise<void>;
    /** Whether the port is open. */
    isConnected(): boolean;
}

/**
 * The narrow shape of the Web Serial API this module uses.
 *
 * The browser's own types are not always present, so the bits that are
 * needed are declared here rather than casting to `any` everywhere.
 */
interface SerialPortLike {
    open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string }): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream<Uint8Array> | null;
    getInfo?: () => { usbVendorId?: number; usbProductId?: number };
}

/**
 * A scale on a serial line.
 */
export function createSerialScale(options: SerialScaleOptions = {}): SerialScale {
    const baudRate = options.baudRate ?? 9600;

    let port: SerialPortLike | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let decoder: TextDecoder | null = null;
    let carry = "";

    const isConnected = () => port !== null;

    const disconnect = async () => {
        try {
            if (reader) {
                await reader.cancel();
                reader.releaseLock();
                reader = null;
            }
        } catch {
            // A reader that is already gone is not a problem.
        }

        try {
            if (port) {
                await port.close();
            }
        } catch {
            // A port that is already closed is not a problem.
        }

        port = null;
        decoder = null;
        carry = "";
    };

    return {
        isConnected,

        async connect() {
            if (port) return;

            if (typeof navigator === "undefined" || !("serial" in navigator)) {
                throw new Error(
                    "This browser cannot open a serial port. A USB scale needs Chrome or Edge on a desktop."
                );
            }

            const serial = (navigator as unknown as {
                serial: { requestPort(): Promise<SerialPortLike> };
            }).serial;

            port = await serial.requestPort();
            await port.open({
                baudRate,
                dataBits: options.dataBits ?? 8,
                stopBits: options.stopBits ?? 1,
                parity: options.parity ?? "none",
            });

            decoder = new TextDecoder();
        },

        async read(): Promise<ScaleReading> {
            if (!port || !port.readable) {
                throw new Error(
                    "The scale is not connected. Connect it and try again."
                );
            }

            if (!reader) {
                reader = port.readable.getReader();
            }

            const timeoutMs = 5000;
            const deadline = Date.now() + timeoutMs;

            while (Date.now() < deadline) {
                const { value, done } = await reader.read();

                if (done) {
                    throw new Error(
                        "The scale stopped sending readings. Check that it is switched on and plugged in."
                    );
                }

                if (!value) continue;

                carry += decoder ? decoder.decode(value, { stream: true }) : "";

                // A scale sends whole lines, but the line break may fall
                // across two reads, so the leftover is carried over.
                const lines = carry.split(/\r?\n/);
                carry = lines.pop() ?? "";

                for (const line of lines) {
                    const parsed = options.parse
                        ? options.parse(line)
                        : parseScaleLine(line);

                    if (!parsed) continue;

                    return {
                        weight: parsed.weight,
                        unit: parsed.unit,
                        stable: parsed.stable,
                        source: "serial",
                        verified: false,
                        detail:
                            "The scale reported this weight. Check the scale against a known weight regularly — SMARTBUZ cannot tell whether the scale is calibrated.",
                    };
                }
            }

            throw new Error(
                "The scale did not report a weight. Check that it is switched on and showing a stable reading."
            );
        },

        disconnect,
    };
}

/**
 * Read a weight from a scale on the network.
 *
 * The scale is asked for its weight over HTTP. It reports what it
 * believes, but SMARTBUZ cannot confirm that it was zeroed or
 * calibrated, so the reading is never `verified`.
 */
export async function readHttpScale(
    url: string,
    options: {
        timeoutMs?: number;
        headers?: Record<string, string>;
        /** The field to read when the scale answers with JSON. */
        field?: string;
    } = {}
): Promise<ScaleReading> {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 5000
    );

    let response: Response;
    try {
        response = await fetch(url, {
            headers: { Accept: "application/json, text/plain", ...options.headers },
            signal: controller.signal,
            cache: "no-store",
        });
    } catch (err) {
        throw new Error(
            `The scale could not be reached: ${
                err instanceof Error ? err.message : "no answer"
            }. Check that the scale is switched on and on the network.`
        );
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        throw new Error(
            `The scale answered with HTTP ${response.status}. Check that the address is right.`
        );
    }

    const text = await response.text();

    // A JSON answer is read by field; a plain answer is read as a line.
    let weight: number | null = null;
    let unit = "";

    try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const raw =
            options.field && parsed[options.field] !== undefined
                ? parsed[options.field]
                : parsed.weight ?? parsed.value ?? parsed.reading;

        if (typeof raw === "number" && Number.isFinite(raw)) {
            weight = raw;
        } else if (typeof raw === "string") {
            const fromText = parseScaleLine(raw);
            if (fromText) {
                weight = fromText.weight;
                unit = fromText.unit;
            }
        }

        if (typeof parsed.unit === "string") unit = parsed.unit;
    } catch {
        const fromText = parseScaleLine(text);
        if (fromText) {
            weight = fromText.weight;
            unit = fromText.unit;
        }
    }

    if (weight === null) {
        throw new Error(
            "The scale answered, but its answer did not contain a weight it could read."
        );
    }

    return {
        weight,
        unit,
        stable: true,
        source: "http",
        verified: false,
        detail:
            "The scale reported this weight over the network. Check the scale against a known weight regularly — SMARTBUZ cannot tell whether the scale is calibrated.",
    };
}
