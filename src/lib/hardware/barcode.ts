/**
 * SMARTBUZ — barcode scanning.
 *
 * Most cheap barcode scanners are not scanners at all: they are
 * keyboards. They type the barcode into whatever has focus, very fast,
 * and then press Enter.
 *
 * That is why this works the way it does. It watches the keyboard for
 * characters arriving faster than a person could type them, and treats
 * a burst followed by Enter as a scan.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * It does not decode a barcode. It does not open a scanner as a device.
 * It cannot tell a barcode from a person who typed the same characters
 * quickly, and it cannot tell one scanner from another.
 *
 * It also never swallows a keystroke. If the operator is typing into a
 * search box, the keystrokes go to the search box, exactly as they
 * would without this code. Only a burst that looks like a barcode and
 * ends with Enter is treated as a scan.
 */

/** How the scanner should behave. */
export interface BarcodeScannerOptions {
    /** The shortest burst that counts as a barcode. Default 4. */
    minLength?: number;
    /** The longest burst that counts as a barcode. Default 64. */
    maxLength?: number;
    /**
     * How long a gap may be between two characters and still count as
     * one scan. Default 60 milliseconds — slower than a scanner, faster
     * than a person.
     */
    timeoutMs?: number;
    /** Called with the barcode when one is read. */
    onScan: (barcode: string) => void;
    /** Called when something goes wrong, in words an operator can read. */
    onError?: (message: string) => void;
}

/** The scanner's controls. */
export interface BarcodeScanner {
    /** Start listening. Safe to call twice — the second call does nothing. */
    start(): void;
    /** Stop listening and release the keyboard handler. */
    stop(): void;
    /** Whether it is listening now. */
    isListening(): boolean;
    /** The characters typed so far, for debugging. */
    buffer(): string;
}

/**
 * Put a barcode in the form it is stored in.
 *
 * Scanners differ in the case they report, and the code on the product
 * is not always the case on the shelf label. Upper case with the
 * spaces taken out means one product, one barcode.
 */
export function normaliseBarcode(raw: string): string {
    return raw.replace(/[^0-9A-Za-z-]/g, "").toUpperCase();
}

/**
 * Does this look like a barcode?
 *
 * A cheap check: the right length, and only the characters barcodes
 * actually use. It keeps a typed search term from being mistaken for a
 * scan.
 */
export function looksLikeBarcode(value: string): boolean {
    if (!value) return false;
    if (value.length < 4 || value.length > 64) return false;
    return /^[0-9A-Za-z-]+$/.test(value);
}

/**
 * Is this event coming from somewhere the operator is typing?
 *
 * A barcode scanned into a search box should fill the search box. The
 * scanner does not intercept it; it just listens alongside.
 */
function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== "object") return false;

    const element = target as HTMLElement;
    const tagName = element.tagName?.toUpperCase();

    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
        return true;
    }

    return element.isContentEditable === true;
}

/**
 * Watch the keyboard for barcode scans.
 *
 * The returned object has to be stopped when the till closes, or the
 * handler stays attached to the document for the life of the page.
 */
export function createBarcodeScanner(
    options: BarcodeScannerOptions
): BarcodeScanner {
    const minLength = options.minLength ?? 4;
    const maxLength = options.maxLength ?? 64;
    const timeoutMs = options.timeoutMs ?? 60;

    let listening = false;
    let buffer = "";
    let lastKeyAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const reset = () => {
        buffer = "";
        lastKeyAt = 0;
        clearTimer();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        // A scan typed into a form belongs to the form.
        if (isTypingTarget(event.target)) return;

        const now = Date.now();

        // A long gap means the previous burst was not a scan — it was
        // someone typing, or an abandoned entry.
        if (buffer && now - lastKeyAt > timeoutMs) {
            reset();
        }

        if (event.key === "Enter") {
            if (buffer.length >= minLength && buffer.length <= maxLength) {
                if (looksLikeBarcode(buffer)) {
                    const barcode = normaliseBarcode(buffer);
                    reset();
                    try {
                        options.onScan(barcode);
                    } catch (err) {
                        options.onError?.(
                            err instanceof Error
                                ? err.message
                                : "The barcode was read but could not be handled."
                        );
                    }
                    return;
                }
            }
            // Not a barcode — let it through as an ordinary Enter.
            reset();
            return;
        }

        if (event.key.length !== 1) {
            // A modifier, an arrow, a function key — not part of a barcode.
            return;
        }

        if (event.ctrlKey || event.altKey || event.metaKey) {
            return;
        }

        buffer += event.key;
        lastKeyAt = now;

        if (buffer.length > maxLength) {
            reset();
            return;
        }

        clearTimer();
        timer = setTimeout(() => {
            // The burst stopped without an Enter. It was not a scan.
            reset();
        }, timeoutMs);
    };

    return {
        start() {
            if (listening) return;
            if (typeof document === "undefined") return;
            document.addEventListener("keydown", handleKeyDown, true);
            listening = true;
        },
        stop() {
            if (!listening) return;
            if (typeof document !== "undefined") {
                document.removeEventListener("keydown", handleKeyDown, true);
            }
            reset();
            listening = false;
        },
        isListening() {
            return listening;
        },
        buffer() {
            return buffer;
        },
    };
}
