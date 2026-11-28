"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { businessCurrency } from "@/lib/currency";
import { useT } from "@/i18n/provider";

export interface ReceiptData {
    businessName?: string;
    businessAddress?: string;
    businessPhone?: string;
    customer?: { name: string; phone: string; email: string; distributorId?: string };
    shop: { name: string; location: string; contact: string; serialNumber: string };
    operator: { name: string; phone?: string; email?: string };
    clientType: string;
    paymentMode: string;
    date: string;
    paymentDueDate?: string;
    invoiceNumber: string;
    items: any[];
    total: number;
    totalPV: number;
    totalBV: number;
    balance?: number;
    initialDeposit?: number;
    packageType?: string;
    deliveryStatus?: string;
    promotions?: {
        promotionName: string;
        prize: string;
        redeemedQuantity: number;
        productName?: string;
    }[];
    customerPhone?: string;
    customerLocation?: string;
    transactionType?: string;
    returnedItems?: { stockId: string; name: string; productCode?: string; quantity?: number; qty?: number; price?: number }[];
    /* ── URA / VAT compliance ── */
    taxEnabled?: boolean;
    taxRate?: number;
    taxInclusive?: boolean;
    taxNote?: string;
    /** Taxpayer Identification Number (URA TIN). */
    tin?: string;
    /** VAT-exclusive amount (net) when tax is inclusive. */
    netAmount?: number;
    /** VAT amount charged. */
    vatAmount?: number;
    /** Human label for the item being sold, e.g. "Medicine". */
    itemLabel?: string;
    /**
     * The currency the sale was made in.
     *
     * A receipt belongs to a sale, so it shows the currency of that sale
     * rather than the currency the business happens to trade in today.
     */
    currency?: string;
}

export const ReceiptTemplate = ({ data }: { data: ReceiptData }) => {
    
    const t = useT();const isSwap = data.transactionType === "Swap";
    const currency = businessCurrency(data.currency);
    const returnedItemsList = data.returnedItems || [];
    const totalReturnedValue = returnedItemsList.reduce((sum, item) => {
        const q = item.quantity ?? item.qty ?? 0;
        const p = item.price ?? 0;
        return sum + (q * p);
    }, 0);

    return (
        <div id="receipt-content" className="p-4 text-black bg-white print:p-0 print:m-0 print:w-full print-shrink font-sans leading-tight max-w-[148mm] mx-auto">
            <style dangerouslySetInnerHTML={{
                __html: `
                @page {
                    size: A5 portrait;
                    margin: 6mm;
                }
                @media print {
                    html, body {
                        width: 100% !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        background: white !important;
                    }
                    #receipt-content {
                        width: 100% !important;
                        max-width: 100% !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        color: black !important;
                        background: white !important;
                        font-size: 8.5px !important;
                    }
                    .no-print { display: none !important; }
                    * { border-color: black !important; }
                }
            ` }} />

            {/* Header section */}
            <div className="pb-2 print:break-inside-avoid">
                <div className="flex justify-between items-start border-b border-black pb-3 mb-3">
                    <div className="flex-1 text-center">
                        <h2 className="text-xl font-semibold text-black tracking-tighter uppercase mb-0.5">
                            {data.businessName || data.shop?.name || "OFFICIAL RECEIPT"}
                        </h2>
                        {isSwap && (
                            <div className="inline-block bg-black text-white px-2 py-0.5 mb-1 text-eyebrow uppercase tracking-eyebrow">
                                {t("Product Exchange / Swap Receipt")}
                            </div>
                        )}
                        <p className="text-xs leading-tight opacity-90">{data.businessAddress || data.shop?.location || ""}</p>
                        <p className="text-xs leading-tight opacity-90">
                            {data.businessPhone ? `Tel: ${data.businessPhone}` : (data.shop?.contact ? `Tel: ${data.shop.contact}` : "")}
                        </p>
                        {data.tin && (
                            <p className="leading-tight text-eyebrow uppercase tracking-eyebrow">
                                {t("TIN:")} {data.tin}
                            </p>
                        )}
                    </div>
                    <div className="w-[60px] h-[60px] shrink-0 ml-3 border-2 border-black rounded-lg flex items-center justify-center font-semibold text-xl tracking-tighter bg-slate-50">
                        {((data.businessName || data.shop?.name || "POS").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2)).toUpperCase()}
                    </div>
                </div>

                {/* Info Fields Grid - Box Styles */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-eyebrow uppercase tracking-eyebrow">
                    {/* Row 1 */}
                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 w-24">{t("CUSTOMER NAME:")}</span>
                        <div className="border border-black h-5 flex-1 px-1 flex items-center font-semibold truncate bg-white">
                            {data.customer?.name || "WALK-IN CUSTOMER"}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 w-20">{t("CONTACTS:")}</span>
                        <div className="border border-black h-5 flex-1 px-1 flex items-center bg-white font-mono">
                            {data.customerPhone || data.customer?.phone || "N/A"}
                        </div>
                    </div>

                    {/* Row 2 */}
                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 w-24">{t("DISTRIBUTOR ID:")}</span>
                        <div className="flex gap-[1px] flex-1">
                            {(data.customer?.distributorId || data.customer?.email || "").slice(0, 8).padEnd(8, " ").split("").map((char, i) => (
                                <div key={i} className="border border-black w-5 h-5 flex items-center justify-center font-semibold bg-white text-[8px]">
                                    {char.trim() || ""}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 w-20">{t("LOCATION:")}</span>
                        <div className="border border-black h-5 flex-1 px-1 flex items-center bg-white truncate">
                            {data.customerLocation || data.shop?.location || "N/A"}
                        </div>
                    </div>

                    {/* Row 3 */}
                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 w-24">{t("CLIENT TYPE:")}</span>
                        <div className="border border-black h-5 flex-1 px-1.5 flex items-center bg-white font-semibold truncate">
                            {data.clientType}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 w-20">{t("SHOP SERIAL:")}</span>
                        <div className="border border-black h-5 flex-1 px-1 flex items-center justify-center font-semibold bg-white">
                            {data.shop.serialNumber || ""}
                        </div>
                    </div>

                    {/* Row 4 */}
                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 w-24">{t("TYPE:")}</span>
                        <div className="border border-black h-5 flex-1 px-1.5 flex items-center bg-white font-semibold text-[8px]">
                            {isSwap ? "PRODUCT SWAP" : "STANDARD SALE"}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="shrink-0 w-20">{t("RECEIPT NO:")}</span>
                        <div className="border border-black h-5 flex-1 px-1 flex items-center font-mono text-[8px] bg-white">
                            {data.invoiceNumber || "N/A"}
                        </div>
                    </div>
                </div>
            </div>

            {/* If SWAP: Show RETURNED ITEMS TABLE FIRST */}
            {isSwap && returnedItemsList.length > 0 && (
                <div className="mt-3 border-t border-l border-black text-[8.5px] print:break-inside-avoid">
                    <div className="bg-slate-100 border-b border-r border-black p-1 text-center text-eyebrow uppercase tracking-eyebrow">
                        {t("Items Returned / Surrendered by Customer")}
                    </div>
                    <div className="grid grid-cols-[1fr_3.5fr_1fr_1.5fr] font-semibold border-b border-r border-black uppercase text-center bg-slate-50 print:bg-transparent">
                        <div className="p-1 border-r border-black flex items-center justify-center">{t("CODE")}</div>
                        <div className="p-1 border-r border-black flex items-center justify-center">{t("PRODUCT NAME")}</div>
                        <div className="p-1 border-r border-black flex items-center justify-center">{t("QTY")}</div>
                        <div className="p-1 flex items-center justify-end pr-2">{t("VALUE (")}{currency})</div>
                    </div>
                    {returnedItemsList.map((item, idx) => {
                        const qty = item.quantity ?? item.qty ?? 0;
                        const lineValue = (item.price ?? 0) * qty;
                        return (
                            <div key={idx} className="grid grid-cols-[1fr_3.5fr_1fr_1.5fr] border-b border-r border-black text-center min-h-[22px]">
                                <div className="p-1 border-r border-black flex items-center justify-center font-mono">{item.productCode || "-"}</div>
                                <div className="p-1 border-r border-black flex items-center text-left pl-2 font-medium">{item.name}</div>
                                <div className="p-1 border-r border-black flex items-center justify-center font-semibold">+{qty}</div>
                                <div className="p-1 flex items-center justify-end pr-2 font-mono">{lineValue > 0 ? lineValue.toLocaleString() : "-"}</div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Items Table - Dense Format */}
            <div className="mt-3 border-t border-l border-black text-[8.5px] print:break-inside-auto mb-3">
                {isSwap && (
                    <div className="bg-slate-100 border-b border-r border-black p-1 text-center text-eyebrow uppercase tracking-eyebrow">
                        {t("Items Taken / Issued to Customer")}
                    </div>
                )}
                {/* Custom Table Head */}
                <div className="grid grid-cols-[0.7fr_2.5fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr_0.6fr_0.7fr_1.2fr] font-semibold border-b border-r border-black uppercase text-center bg-slate-50 print:bg-transparent">
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("CODE")}</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("NAME")}</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("QTY")}</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("PV")}</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("%PV")}</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("TOTAL PV")}</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("BV")}</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("%BV")}</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">{t("TOTAL BV")}</div>
                    <div className="p-1 break-words">{t("UG SHS")}</div>
                </div>

                {/* Items Rows */}
                {data.items.map((item, i) => {
                    const itemQty = item.quantity ?? item.qty ?? 0;
                    const totalLinePV = (item.pv || 0) * itemQty;
                    const totalLineBV = (item.bv || 0) * itemQty;
                    const percentPv = item.price > 0 ? `${((item.pv / item.price) * 100).toFixed(1)}%` : "0%";
                    const percentBv = item.price > 0 ? `${((item.bv / item.price) * 100).toFixed(1)}%` : "0%";

                    return (
                        <div key={i} className="grid grid-cols-[0.7fr_2.5fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr_0.6fr_0.7fr_1.2fr] border-b border-r border-black text-center min-h-[22px]">
                            <div className="p-1 border-r border-black flex items-center justify-center font-mono text-[8px]">{item.productCode || ""}</div>
                            <div className="p-1 border-r border-black flex items-center text-left pl-1.5 font-medium truncate">{item.name}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center font-semibold">{itemQty}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center">{item.pv}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center italic opacity-60 text-[8px]">{percentPv}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center font-bold">{totalLinePV}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center">{item.bv}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center italic opacity-60 text-[8px]">{percentBv}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center font-bold">{totalLineBV}</div>
                            <div className="p-1 flex items-center justify-end pr-1.5 font-semibold font-mono">{(item.price * itemQty).toLocaleString()}</div>
                        </div>
                    );
                })}

                {/* Footer / Totals Row */}
                <div className="grid grid-cols-[0.7fr_2.5fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr_0.6fr_0.7fr_1.2fr] font-semibold border-b border-r border-black">
                    <div className="col-span-5 p-1 border-r border-black text-right pr-3 uppercase">{t("TOTAL:")}</div>
                    <div className="p-1 border-r border-black text-center border-t border-black bg-slate-50 print:bg-transparent">{data.totalPV}</div>
                    <div className="col-span-2 border-r border-black"></div>
                    <div className="p-1 border-r border-black text-center border-t border-black bg-slate-50 print:bg-transparent">{data.totalBV}</div>
                    <div className="p-1 text-right pr-1.5 border-t border-black bg-slate-50 print:bg-transparent font-mono">{data.total.toLocaleString()}</div>
                </div>
            </div>

            {/* PROMOTIONAL REWARDS WON */}
            {data.promotions && data.promotions.length > 0 && (
                <div className="my-2 border-2 border-black p-2 bg-slate-50 print:bg-transparent print:break-inside-avoid">
                    <div className="flex justify-between items-center border-b border-black pb-1 mb-1 text-eyebrow uppercase tracking-eyebrow">
                        <span className="flex items-center gap-1">{t("🎁 PROMOTIONAL REWARD WON")}</span>
                        <span className="text-[8px] italic font-bold">{t("REDEEMABLE AT COUNTER")}</span>
                    </div>
                    <div className="space-y-1">
                        {data.promotions.map((promo, idx) => (
                            <div key={idx} className="flex justify-between items-center text-[8.5px]">
                                <span className="font-bold">
                                    {promo.promotionName}
                                    {promo.productName && promo.productName !== "THRESHOLD" && ` (${promo.productName})`}
                                    {promo.redeemedQuantity > 1 && ` x${promo.redeemedQuantity}`}
                                </span>
                                <span className="font-semibold border border-black px-1.5 py-0.5 bg-white uppercase text-[8.5px]">
                                    {t("PRIZE:")} {promo.prize}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Post-Table info */}
            <div className="mt-3 text-xs space-y-2 print:break-inside-avoid">
                <div className="flex justify-between items-start border-b border-black border-dashed pb-2">
                    <div className="space-y-1">
                        <p className="font-bold uppercase tracking-tighter">{t("Mode of Payment:")} <span className="underline ml-1">{data.paymentMode}</span></p>
                        {data.packageType && (
                            <p className="italic border border-black px-1.5 py-0.5 inline-block text-eyebrow uppercase tracking-eyebrow">
                                {t("PACKAGE:")} {data.packageType}
                            </p>
                        )}
                        {data.paymentDueDate && (
                            <p className="font-bold underline italic bg-slate-100 px-1 inline-block">{t("DUE DATE:")} {new Date(data.paymentDueDate).toLocaleDateString()}</p>
                        )}
                    </div>
                    <div className="text-right space-y-1">
                        {isSwap && totalReturnedValue > 0 && (
                            <div className="flex justify-end gap-6 text-[8.5px]">
                                <span className="font-medium">{t("Returned Value:")}</span>
                                <span className="font-bold font-mono">{currency} {totalReturnedValue.toLocaleString()}</span>
                            </div>
                        )}
                        <div className="flex justify-end gap-6 min-w-[180px]">
                            <span className="font-bold uppercase">{isSwap ? `NET BALANCE (${currency}):` : `GRAND TOTAL (${currency}):`}</span>
                            <span className="text-base font-semibold font-mono">{data.total.toLocaleString()}</span>
                        </div>
                        {data.initialDeposit !== undefined && data.initialDeposit > 0 && (
                            <div className="flex justify-end gap-6">
                                <span className="font-medium italic">{t("Amount Paid:")}</span>
                                <span className="font-bold font-mono">{data.initialDeposit.toLocaleString()}</span>
                            </div>
                        )}
                        {data.balance !== undefined && (
                            <div className="flex justify-end gap-6 border-t border-black pt-1">
                                <span className="font-semibold uppercase">{t("BALANCE DUE:")}</span>
                                <span className="font-semibold underline text-xs font-mono">{data.balance.toLocaleString()}</span>
                            </div>
                        )}
                        {data.taxEnabled && data.vatAmount !== undefined && (
                            <div className="space-y-0.5 border-t border-black pt-1">
                                {data.taxInclusive && data.netAmount !== undefined && (
                                    <div className="flex justify-end gap-6">
                                        <span className="font-medium italic">
                                            {t("Net (excl. VAT):")}
                                        </span>
                                        <span className="font-bold font-mono">
                                            {data.netAmount.toLocaleString()}
                                        </span>
                                    </div>
                                )}
                                <div className="flex justify-end gap-6">
                                    <span className="font-bold uppercase">
                                        {t("VAT @")} {data.taxRate ?? 18}%:
                                    </span>
                                    <span className="font-bold font-mono">
                                        {data.vatAmount.toLocaleString()}
                                    </span>
                                </div>
                                {data.taxNote && (
                                    <p className="text-right text-[7.5px] italic opacity-80">
                                        {data.taxNote}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Operator and Date */}
                <div className="grid grid-cols-2 gap-12 py-3 border-b border-black">
                    <div>
                        <p className="font-bold uppercase text-[7.5px] mb-0.5">{t("Operator Signature:")}</p>
                        <div className="border-b border-black h-6 flex items-end pb-0.5 font-mono text-[8.5px]">
                            {data.operator?.name}
                        </div>
                    </div>
                    <div>
                        <p className="font-bold uppercase text-[7.5px] mb-0.5">{t("Delivery Status:")}</p>
                        <div className="h-6 flex items-end pb-0.5 font-semibold text-xs">
                            {data.deliveryStatus === "Pending" ? "NOT TAKEN" : "FULLY DELIVERED"}
                        </div>
                    </div>
                </div>

                <div className="pt-1 text-[7.5px] italic flex justify-between uppercase font-bold opacity-60">
                    <span>{t("Generated on:")} {new Date(data.date).toLocaleString()}</span>
                    <span>{t("Official Document")}</span>
                </div>
            </div>

            <div className="mt-3 text-center border-t border-black pt-1.5 text-eyebrow uppercase tracking-eyebrow">
                {data.businessName || data.shop?.name || "SMARTBUZ"} {t("• THANK YOU FOR YOUR BUSINESS")}
            </div>
        </div>
    );
};
