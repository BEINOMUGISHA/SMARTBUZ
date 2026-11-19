/**
 * SMARTBUZ — thermal receipt printers.
 *
 * ESC/POS thermal printers, over a serial or USB connection.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The connection is kept open
 * ────────────────────────────────────────────────────────────────────────
 *
 * The existing `printDirectWebSerial` asks for the serial port every
 * single time it prints. That is fine for a demo and unusable for a
 * till: the operator would have to click "choose device" for every
 * receipt, and the browser shows a permission prompt each time.
 *
 * So this module keeps the port open and reuses it. It is closed when
 * the till shuts down, and re-opened when the printer is unplugged.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this cannot do
 * ────────────────────────────────────────────────────────────────────────
 *
 * It cannot read the paper.
 *
 * A successful write means the bytes went to the printer. It does not
 * mean the paper came out, that it was the right receipt, or that the
 * ribbon was working. **Only a person can confirm that**, which is why
 * the hardware register has a `verified` state that a person sets.
 */

import { EscPosBuilder } from "../escpos";

/** The paper widths SMARTBUZ knows. */
export type PrinterPaperWidth = "80mm" | "58mm";

/** How a printer is set up. */
export interface PrinterProfile {
    name: string;
    paperWidth: PrinterPaperWidth;
    /** The characters that fit on a line. */
    columns: number;
    /** The encoding to print in. */
    encoding?: "utf8" | "latin1";
}

/**
 * The profiles that ship with SMARTBUZ.
 *
 * The columns matter: a receipt built for 48 columns printed on a
 * 32-column printer wraps onto a second line for every row, and the
 * customer's copy is a mess.
 */
export const DEFAULT_PRINTER_PROFILES: PrinterProfile[] = [
    {
        name: "Standard 80mm",
        paperWidth: "80mm",
        columns: 48,
        encoding: "utf8",
    },
    {
        name: "Standard 58mm",
        paperWidth: "58mm",
        columns: 32,
        encoding: "utf8",
    },
    {
        name: "Epson 80mm",
        paperWidth: "80mm",
        columns: 48,
        encoding: "latin1",
    },
    {
        name: "Xprinter 58mm",
        paperWidth: "58mm",
        columns: 32,
        encoding: "latin1",
    },
];

/** An open printer. */
export interface PrinterConnection {
    profile: PrinterProfile;
    /** The name of the port, when the browser reports one. */
    portName?: string;
    openedAt: string;
}

/** What the browser can actually do here. */
export interface PrinterCapabilities {
    webSerial: boolean;
    webUsb: boolean;
    webBluetooth: boolean;
    /** Whether the browser can open a print dialog. */
    print: boolean;
}

/**
 * The narrow shape of the Web Serial API this module uses.
 */
interface SerialPortLike {
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    writable: WritableStream<Uint8Array> | null;
    getInfo?: () => { usbVendorId?: number; usbProductId?: number };
}

/**
 * What this browser supports.
 *
 * This reports what is actually there, not what is usually there. A
 * till on Safari gets the truth, and so does the interface that shows
 * the operator why the printer button is greyed out.
 */
export function printerCapabilities(): PrinterCapabilities {
    if (typeof navigator === "undefined") {
        return { webSerial: false, webUsb: false, webBluetooth: false, print: false };
    }

    return {
        webSerial: "serial" in navigator,
        webUsb: "usb" in navigator,
        webBluetooth: "bluetooth" in navigator,
        print: typeof window !== "undefined" && typeof window.print === "function",
    };
}

/**
 * The printer's controls.
 */
export interface ThermalPrinter {
    /** Ask for the port and open it. */
    connect(): Promise<PrinterConnection>;
    /** Write bytes to the printer. */
    print(bytes: Uint8Array): Promise<{ ok: boolean; detail: string }>;
    /** Close the port. */
    disconnect(): Promise<void>;
    /** Whether the port is open. */
    isConnected(): boolean;
    /** The profile in use. */
    profile(): PrinterProfile;
}

/**
 * A thermal printer.
 */
export function createThermalPrinter(
    options: { profile?: PrinterProfile; baudRate?: number } = {}
): ThermalPrinter {
    const profile = options.profile ?? DEFAULT_PRINTER_PROFILES[0];
    const baudRate = options.baudRate ?? 9600;

    let port: SerialPortLike | null = null;
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    const isConnected = () => port !== null;

    const disconnect = async () => {
        try {
            if (writer) {
                await writer.close();
                writer.releaseLock();
                writer = null;
            }
        } catch {
            // A writer that is already closed is not a problem.
        }

        try {
            if (port) {
                await port.close();
            }
        } catch {
            // A port that is already closed is not a problem.
        }

        port = null;
    };

    return {
        isConnected,
        profile: () => profile,

        async connect(): Promise<PrinterConnection> {
            if (port) {
                return {
                    profile,
                    openedAt: new Date().toISOString(),
                };
            }

            if (typeof navigator === "undefined" || !("serial" in navigator)) {
                throw new Error(
                    "This browser cannot open a serial port. A USB receipt printer needs Chrome or Edge on a desktop."
                );
            }

            const serial = (navigator as unknown as {
                serial: { requestPort(): Promise<SerialPortLike> };
            }).serial;

            port = await serial.requestPort();
            await port.open({ baudRate });

            if (!port.writable) {
                await disconnect();
                throw new Error(
                    "That port cannot be written to, so it is not a printer SMARTBUZ can use."
                );
            }

            return {
                profile,
                openedAt: new Date().toISOString(),
            };
        },

        async print(bytes: Uint8Array): Promise<{ ok: boolean; detail: string }> {
            if (!port || !port.writable) {
                return {
                    ok: false,
                    detail:
                        "The printer is not connected. Connect it and try again.",
                };
            }

            try {
                if (!writer) {
                    writer = port.writable.getWriter();
                }

                await writer.write(bytes);

                return {
                    ok: true,
                    detail:
                        "The receipt was sent to the printer. Whether it printed correctly has to be confirmed by eye — SMARTBUZ cannot read the paper.",
                };
            } catch (err) {
                // The printer was unplugged, or the browser revoked the
                // permission. The connection is dropped so the next
                // attempt starts clean.
                await disconnect();

                return {
                    ok: false,
                    detail: `The printer could not be written to: ${
                        err instanceof Error ? err.message : "unknown error"
                    }. Reconnect the printer and try again.`,
                };
            }
        },

        disconnect,
    };
}

/**
 * A short receipt for testing a printer.
 *
 * It says plainly that it is a test, so a stray test receipt in the
 * till drawer is never mistaken for a real one.
 */
export function buildTestReceipt(profile: PrinterProfile): Uint8Array {
    const builder = new EscPosBuilder(profile.paperWidth);

    builder
        .align("center")
        .bold(true)
        .size(2, 2)
        .line("PRINTER TEST")
        .size(1, 1)
        .bold(false)
        .line("SMARTBUZ POS")
        .line(new Date().toLocaleString())
        .divider("-")
        .align("left")
        .line("If you can read this, the printer works.")
        .line("This is a test receipt. It is not a sale.")
        .divider("=")
        .align("center")
        .line("Thank you")
        .feed(3)
        .cut();

    return builder.build();
}
