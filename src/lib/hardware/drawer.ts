/**
 * SMARTBUZ — cash drawers.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The honest problem with cash drawers
 * ────────────────────────────────────────────────────────────────────────
 *
 * A drawer wired to a printer is opened by sending the printer a pulse
 * on one of its pins. That is all.
 *
 * The drawer also has a **status line** — a second pin that tells the
 * host whether the drawer is open or closed. That pin is what a real
 * till reads to confirm the drawer opened.
 *
 * **A browser cannot read it.** The Web Serial API can write to a port;
 * it cannot watch a control line. So SMARTBUZ can open the drawer, and
 * it can tell the printer that it sent the pulse — but it **cannot know
 * whether the drawer actually opened**.
 *
 * Every result from this module therefore says `verified: false`, and
 * the hardware register keeps a `verified` state that only a person can
 * set, by looking at the drawer.
 *
 * This is not a shortcoming to hide; it is the truth about the
 * hardware, and the interface says so.
 */

/** What happened when the drawer was opened. */
export interface DrawerResult {
    /** Whether the pulse was sent. */
    ok: boolean;
    /**
     * Whether the drawer was confirmed open.
     *
     * Always `false` — a browser cannot read the drawer's status line.
     */
    verified: boolean;
    /** What happened, in words. */
    detail: string;
}

/** What the browser can do with a drawer. */
export interface DrawerCapabilities {
    /** Whether the drawer can be opened through a printer. */
    escposViaPrinter: boolean;
    /** Whether a drawer can be opened directly over USB. */
    directUsb: boolean;
    /**
     * Whether the drawer's status can be read.
     *
     * Always `false` in a browser.
     */
    statusReadable: boolean;
    /** What this means, in words. */
    detail: string;
}

/**
 * The ESC/POS drawer pulse.
 *
 * `ESC p m t1 t2` — pulse pin 2 for the given times, which on a
 * standard drawer is about 250 milliseconds.
 */
export function buildDrawerPulse(
    pin = 2,
    pulseMs = 250
): Uint8Array {
    // The times are in units of roughly 2ms.
    const units = Math.max(1, Math.round(pulseMs / 2));
    return new Uint8Array([0x1b, 0x70, pin, units & 0xff, (units >> 8) & 0xff]);
}

/**
 * What this browser can do with a drawer.
 */
export function drawerCapabilities(): DrawerCapabilities {
    const escposViaPrinter =
        typeof navigator !== "undefined" && "serial" in navigator;
    const directUsb = typeof navigator !== "undefined" && "usb" in navigator;

    return {
        escposViaPrinter,
        directUsb,
        statusReadable: false,
        detail:
            "The drawer can be opened by sending a pulse to the printer, but its status line cannot be read from a browser — so SMARTBUZ cannot confirm that it opened. Check it by eye.",
    };
}

/** The printer the drawer is attached to. */
export interface DrawerPrinter {
    /** Write bytes to the printer. */
    write(bytes: Uint8Array): Promise<unknown>;
}

/** The drawer's controls. */
export interface CashDrawer {
    /**
     * Open the drawer.
     *
     * The pulse goes to the printer the drawer is wired to.
     */
    open(printer: DrawerPrinter): Promise<DrawerResult>;
}

/**
 * A cash drawer attached to a receipt printer.
 */
export function createCashDrawer(
    options: { pulseMs?: number; pin?: number } = {}
): CashDrawer {
    const pulseMs = options.pulseMs ?? 250;
    const pin = options.pin ?? 2;

    return {
        async open(printer: DrawerPrinter): Promise<DrawerResult> {
            if (!printer) {
                return {
                    ok: false,
                    verified: false,
                    detail:
                        "There is no printer connected, so the drawer cannot be opened. The drawer is wired to the printer.",
                };
            }

            try {
                await printer.write(buildDrawerPulse(pin, pulseMs));

                return {
                    ok: true,
                    verified: false,
                    detail:
                        "The drawer pulse was sent to the printer. Whether the drawer physically opened cannot be read from a browser — check it by eye.",
                };
            } catch (err) {
                return {
                    ok: false,
                    verified: false,
                    detail: `The drawer could not be opened: ${
                        err instanceof Error ? err.message : "unknown error"
                    }. Check that the printer is connected and switched on.`,
                };
            }
        },
    };
}
