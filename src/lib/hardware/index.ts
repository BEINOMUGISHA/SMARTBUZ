/**
 * SMARTBUZ — the till's hardware.
 *
 * The browser half of the hardware layer: the barcode scanner, the
 * receipt printer, the cash drawer and the weighing scale.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule these all obey
 * ────────────────────────────────────────────────────────────────────────
 *
 * **Report what actually happened.**
 *
 * The printer cannot read its own paper. The drawer cannot report that
 * it opened — its status line is a serial pin a browser cannot watch.
 * The scale cannot say whether it is calibrated.
 *
 * So none of these ever claims a device is working. They say what they
 * did, and where a person has to look, they say that too. The server
 * keeps the register, and only a person can mark a device as verified.
 */

export {
    createBarcodeScanner,
    looksLikeBarcode,
    normaliseBarcode,
    type BarcodeScanner,
    type BarcodeScannerOptions,
} from "./barcode";

export {
    createSerialScale,
    parseScaleLine,
    readHttpScale,
    type ScaleReading,
    type SerialScale,
    type SerialScaleOptions,
} from "./scale";

export {
    buildTestReceipt,
    createThermalPrinter,
    DEFAULT_PRINTER_PROFILES,
    printerCapabilities,
    type PrinterCapabilities,
    type PrinterConnection,
    type PrinterPaperWidth,
    type PrinterProfile,
    type ThermalPrinter,
} from "./printer";

export {
    buildDrawerPulse,
    createCashDrawer,
    drawerCapabilities,
    type CashDrawer,
    type DrawerCapabilities,
    type DrawerPrinter,
    type DrawerResult,
} from "./drawer";
