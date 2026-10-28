/**
 * ESC/POS Binary Command Generator & WebUSB / WebBluetooth Direct Thermal Printing
 * Supports 80mm (48 columns) and 58mm (32 columns) standard receipt printers (Xprinter, Epson, Zjiang).
 */

export interface ThermalReceiptItem {
    name: string;
    qty: number;
    price: number;
    pv?: number;
    bv?: number;
}

export interface ThermalReceiptData {
    businessName?: string;
    shopName: string;
    shopLocation?: string;
    shopContact?: string;
    invoiceNumber: string;
    date: string;
    cashierName: string;
    customerName?: string;
    customerPhone?: string;
    distributorId?: string;
    items: ThermalReceiptItem[];
    total: number;
    totalPV?: number;
    totalBV?: number;
    paymentMode: string;
    isLoan?: boolean;
    initialDeposit?: number;
    balance?: number;
    promotions?: Array<{ promotionName: string; prize: string; count?: number }>;
}

// Common ESC/POS Command Byte Sequences
const ESC = 0x1b;
const GS = 0x1d;

export class EscPosBuilder {
    private buffer: number[] = [];
    private lineWidth: number;

    constructor(paperWidth: "80mm" | "58mm" = "80mm") {
        this.lineWidth = paperWidth === "80mm" ? 48 : 32;
        this.init();
    }

    init(): this {
        this.buffer.push(ESC, 0x40); // Initialize printer
        return this;
    }

    align(alignment: "left" | "center" | "right"): this {
        const val = alignment === "center" ? 1 : alignment === "right" ? 2 : 0;
        this.buffer.push(ESC, 0x61, val);
        return this;
    }

    bold(enable: boolean = true): this {
        this.buffer.push(ESC, 0x45, enable ? 1 : 0);
        return this;
    }

    size(width: 1 | 2 = 1, height: 1 | 2 = 1): this {
        const n = ((width - 1) << 4) | (height - 1);
        this.buffer.push(GS, 0x21, n);
        return this;
    }

    text(str: string): this {
        for (let i = 0; i < str.length; i++) {
            this.buffer.push(str.charCodeAt(i) & 0xff);
        }
        return this;
    }

    line(str: string = ""): this {
        this.text(str);
        this.buffer.push(0x0a); // LF
        return this;
    }

    divider(char: string = "-"): this {
        return this.line(char.repeat(this.lineWidth));
    }

    row(left: string, right: string): this {
        const leftLen = left.length;
        const rightLen = right.length;
        const spaces = Math.max(1, this.lineWidth - leftLen - rightLen);
        return this.line(left + " ".repeat(spaces) + right);
    }

    itemRow(name: string, qty: number, price: number, total: number): this {
        const formattedTotal = total.toLocaleString();
        const detail = `${qty} x ${price.toLocaleString()}`;

        if (name.length > this.lineWidth - 12) {
            this.line(name);
            return this.row(`  ${detail}`, formattedTotal);
        } else {
            const left = `${name} (${qty})`;
            return this.row(left, formattedTotal);
        }
    }

    feed(lines: number = 3): this {
        this.buffer.push(ESC, 0x64, lines);
        return this;
    }

    cut(partial: boolean = false): this {
        this.buffer.push(GS, 0x56, partial ? 1 : 0);
        return this;
    }

    kickDrawer(): this {
        this.buffer.push(ESC, 0x70, 0, 25, 250); // Pulse cash drawer
        return this;
    }

    build(): Uint8Array {
        return new Uint8Array(this.buffer);
    }
}

/**
 * Compiles a structured receipt into raw ESC/POS bytes ready for thermal transmission
 */
export function buildThermalReceipt(data: ThermalReceiptData, width: "80mm" | "58mm" = "80mm"): Uint8Array {
    const b = new EscPosBuilder(width);

    // Header
    b.align("center")
        .bold(true)
        .size(2, 2)
        .line((data.businessName || data.shopName).toUpperCase())
        .size(1, 1);

    if (data.businessName && data.shopName !== data.businessName) {
        b.line(data.shopName.toUpperCase());
    }
    b.bold(false);

    if (data.shopLocation) b.line(data.shopLocation);
    if (data.shopContact) b.line(`Tel: ${data.shopContact}`);

    b.divider("=");

    // Transaction Details
    b.align("left")
        .row("INVOICE #:", data.invoiceNumber)
        .row("DATE:", data.date)
        .row("CASHIER:", data.cashierName);

    if (data.customerName) {
        b.row("CUSTOMER:", data.customerName);
    }
    if (data.distributorId) {
        b.row("DISTRIBUTOR ID:", data.distributorId);
    }

    b.divider("-");

    // Table Header
    b.bold(true).row("ITEM (QTY)", "AMOUNT (UGX)").bold(false);
    b.divider("-");

    // Items
    for (const item of data.items) {
        b.itemRow(item.name, item.qty, item.price, item.qty * item.price);
    }

    b.divider("-");

    // Financial Summary
    b.bold(true)
        .size(1, 2)
        .row("TOTAL AMOUNT:", `UGX ${data.total.toLocaleString()}`)
        .size(1, 1)
        .bold(false);

    if (data.totalPV !== undefined) {
        b.row("TOTAL PV:", `${data.totalPV.toFixed(1)} PV`);
    }
    if (data.totalBV !== undefined) {
        b.row("TOTAL BV:", `${data.totalBV.toFixed(1)} BV`);
    }

    b.row("PAYMENT MODE:", data.paymentMode);

    if (data.isLoan) {
        b.bold(true);
        if (data.initialDeposit) {
            b.row("INITIAL DEPOSIT:", `UGX ${data.initialDeposit.toLocaleString()}`);
        }
        if (data.balance) {
            b.row("OUTSTANDING BAL:", `UGX ${data.balance.toLocaleString()}`);
        }
        b.bold(false);
    }

    // Promotions Awarded
    if (data.promotions && data.promotions.length > 0) {
        b.divider("*");
        b.align("center").bold(true).line("PROMOTIONS AWARDED").bold(false);
        for (const p of data.promotions) {
            b.line(`* ${p.promotionName}: ${p.prize} ${p.count ? `(x${p.count})` : ""}`);
        }
    }

    // Footer
    b.divider("=");
    b.align("center")
        .line("Thank you for your business!")
        .line("Goods once sold are not returnable")
        .line("Powered by SMARTBUZ POS")
        .feed(3)
        .cut()
        .kickDrawer();

    return b.build();
}

/**
 * Direct print to a Web Serial / USB connected ESC/POS thermal printer
 */
export async function printDirectWebSerial(bytes: Uint8Array): Promise<boolean> {
    if (!("serial" in navigator)) {
        throw new Error("Web Serial API is not supported in this browser. Use Chrome/Edge or standard print.");
    }

    try {
        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate: 9600 });
        const writer = port.writable.getWriter();
        await writer.write(bytes);
        writer.releaseLock();
        await port.close();
        return true;
    } catch (e: any) {
        console.error("Direct Web Serial printing failed:", e);
        throw e;
    }
}
