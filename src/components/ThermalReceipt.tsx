"use client";

import React from "react";
import { ReceiptData } from "./ReceiptTemplate";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

interface ReceiptLineItem {
    name?: string;
    quantity?: number | string;
    qty?: number | string;
    price?: number | string;
}

/** Receipt data may carry `quantity` or `qty`; normalise on read so a malformed
 *  item can never print "undefined" or "NaN" on the slip. */
function getLineTotals(item: ReceiptLineItem) {
    const qty = Number(item.quantity ?? item.qty ?? 1) || 1;
    const price = Number(item.price) || 0;
    const total = qty * price;
    return { qty, price, total: Number.isFinite(total) ? total : 0 };
}

export function ThermalReceipt({ data }: { data: ReceiptData }) {
    
    const t = useT();const { currency } = useCurrency();
    return (
        <div id="thermal-receipt" className="w-[80mm] max-w-[80mm] mx-auto p-4 bg-white text-black font-mono text-xs leading-tight">
            <style dangerouslySetInnerHTML={{
                __html: `
                @media print {
                    @page {
                        size: 80mm auto;
                        margin: 0mm;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        background: white;
                    }
                    #thermal-receipt {
                        width: 80mm !important;
                        max-width: 80mm !important;
                        padding: 2mm 3mm !important;
                        margin: 0 auto !important;
                        color: black !important;
                    }
                }
                `
            }} />

            {/* Header */}
            <div className="text-center space-y-0.5 pb-2 border-b border-dashed border-black">
                <p className="text-base font-semibold tracking-tight uppercase">{data.businessName || data.shop.name}</p>
                {data.businessName && data.shop.name !== data.businessName && (
                    <p className="text-xs font-bold uppercase">{data.shop.name}</p>
                )}
                {data.shop.location && <p className="text-xs text-gray-700">{data.shop.location}</p>}
                {data.shop.contact && <p className="text-xs text-gray-700">{t("Tel:")} {data.shop.contact}</p>}
                <p className="mt-1 text-eyebrow uppercase tracking-eyebrow">{t("Official Sales Receipt")}</p>
            </div>

            {/* Meta Details */}
            <div className="py-2 border-b border-dashed border-black text-xs space-y-1">
                <div className="flex justify-between">
                    <span className="font-bold">{t("INVOICE:")}</span>
                    <span className="font-semibold">{data.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                    <span>{t("DATE:")}</span>
                    <span>{new Date(data.date).toLocaleDateString()} {new Date(data.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="flex justify-between">
                    <span>{t("CASHIER:")}</span>
                    <span className="truncate max-w-[120px]">{data.operator.name}</span>
                </div>
                {data.customer?.name && (
                    <div className="flex justify-between">
                        <span>{t("CLIENT:")}</span>
                        <span className="font-bold truncate max-w-[120px]">{data.customer.name}</span>
                    </div>
                )}
                {data.customer?.distributorId && (
                    <div className="flex justify-between">
                        <span>{t("DIST ID:")}</span>
                        <span className="font-bold">{data.customer.distributorId}</span>
                    </div>
                )}
                <div className="flex justify-between">
                    <span>{t("TYPE:")}</span>
                    <span>{data.clientType}</span>
                </div>
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-dashed border-black">
                <div className="flex justify-between text-xs font-bold pb-1 border-b border-black">
                    <span>{t("ITEM")}</span>
                    <span>{t("QTY x PRICE")}</span>
                    <span className="text-right">{t("TOTAL")}</span>
                </div>

                <div className="divide-y divide-dotted divide-gray-300 py-1">
                    {data.items.map((item: ReceiptLineItem, idx) => {
                        const { qty, price, total } = getLineTotals(item);
                        return (
                            <div key={idx} className="py-1 text-xs">
                                <div className="font-bold truncate">{item.name}</div>
                                <div className="flex justify-between text-gray-700">
                                    <span>{qty} x {price.toLocaleString()}</span>
                                    <span className="font-bold text-black">{total.toLocaleString()}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Financial Summary */}
            <div className="py-2 border-b border-dashed border-black space-y-1 text-xs">
                <div className="flex justify-between font-semibold text-sm pt-1">
                    <span>{t("TOTAL:")}</span>
                    <span>{currency} {data.total.toLocaleString()}</span>
                </div>

                {(data.totalPV > 0 || data.totalBV > 0) && (
                    <div className="flex justify-between text-xs text-gray-700 pt-0.5">
                        <span>{t("POINTS:")}</span>
                        <span>{data.totalPV.toFixed(1)} {t("PV |")} {data.totalBV.toFixed(1)} {t("BV")}</span>
                    </div>
                )}

                <div className="flex justify-between text-xs pt-0.5">
                    <span>{t("PAYMENT:")}</span>
                    <span className="font-bold uppercase">{data.paymentMode}</span>
                </div>

                {data.initialDeposit !== undefined && data.initialDeposit > 0 && (
                    <div className="flex justify-between text-xs">
                        <span>{t("DEPOSIT:")}</span>
                        <span className="font-bold">{currency} {data.initialDeposit.toLocaleString()}</span>
                    </div>
                )}

                {data.balance !== undefined && data.balance > 0 && (
                    <div className="flex justify-between text-xs font-bold text-red-600">
                        <span>{t("BALANCE DUE:")}</span>
                        <span>{currency} {data.balance.toLocaleString()}</span>
                    </div>
                )}
            </div>

            {/* Promotions */}
            {data.promotions && data.promotions.length > 0 && (
                <div className="py-2 border-b border-dashed border-black text-xs">
                    <p className="font-semibold text-center mb-1 uppercase tracking-wider">{t("🎉 PROMO REWARDS")}</p>
                    {data.promotions.map((p, idx) => (
                        <div key={idx} className="flex justify-between">
                            <span className="truncate max-w-[120px]">{p.promotionName}</span>
                            <span className="font-bold">{p.prize}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="pt-3 text-center space-y-1 text-xs text-gray-600">
                <p className="font-bold text-black">{t("THANK YOU FOR SHOPPING WITH US!")}</p>
                <p>{t("Goods once sold are not returnable")}</p>
                <p>{t("Printed on")} {new Date().toLocaleDateString()}</p>
                <p className="font-mono text-xs text-gray-600">{t("POWERED BY SMARTBUZ POS")}</p>
            </div>
        </div>
    );
}
