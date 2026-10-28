"use client";

import React from "react";
import { ReceiptData } from "./ReceiptTemplate";

export function ThermalReceipt({ data }: { data: ReceiptData }) {
    return (
        <div id="thermal-receipt" className="w-[80mm] max-w-[80mm] mx-auto p-4 bg-white text-black font-mono text-[11px] leading-tight">
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
                <p className="text-base font-black tracking-tight uppercase">{data.businessName || data.shop.name}</p>
                {data.businessName && data.shop.name !== data.businessName && (
                    <p className="text-xs font-bold uppercase">{data.shop.name}</p>
                )}
                {data.shop.location && <p className="text-[10px] text-gray-700">{data.shop.location}</p>}
                {data.shop.contact && <p className="text-[10px] text-gray-700">Tel: {data.shop.contact}</p>}
                <p className="text-[9px] font-bold mt-1 uppercase">Official Sales Receipt</p>
            </div>

            {/* Meta Details */}
            <div className="py-2 border-b border-dashed border-black text-[10px] space-y-1">
                <div className="flex justify-between">
                    <span className="font-bold">INVOICE:</span>
                    <span className="font-black">{data.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                    <span>DATE:</span>
                    <span>{new Date(data.date).toLocaleDateString()} {new Date(data.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="flex justify-between">
                    <span>CASHIER:</span>
                    <span className="truncate max-w-[120px]">{data.operator.name}</span>
                </div>
                {data.customer?.name && (
                    <div className="flex justify-between">
                        <span>CLIENT:</span>
                        <span className="font-bold truncate max-w-[120px]">{data.customer.name}</span>
                    </div>
                )}
                {data.customer?.distributorId && (
                    <div className="flex justify-between">
                        <span>DIST ID:</span>
                        <span className="font-bold">{data.customer.distributorId}</span>
                    </div>
                )}
                <div className="flex justify-between">
                    <span>TYPE:</span>
                    <span>{data.clientType}</span>
                </div>
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-dashed border-black">
                <div className="flex justify-between text-[10px] font-bold pb-1 border-b border-black">
                    <span>ITEM</span>
                    <span>QTY x PRICE</span>
                    <span className="text-right">TOTAL</span>
                </div>

                <div className="divide-y divide-dotted divide-gray-300 py-1">
                    {data.items.map((item, idx) => (
                        <div key={idx} className="py-1 text-[10px]">
                            <div className="font-bold truncate">{item.name}</div>
                            <div className="flex justify-between text-gray-700">
                                <span>{item.quantity} x {item.price.toLocaleString()}</span>
                                <span className="font-bold text-black">{(item.quantity * item.price).toLocaleString()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Financial Summary */}
            <div className="py-2 border-b border-dashed border-black space-y-1 text-[11px]">
                <div className="flex justify-between font-black text-sm pt-1">
                    <span>TOTAL:</span>
                    <span>UGX {data.total.toLocaleString()}</span>
                </div>

                {(data.totalPV > 0 || data.totalBV > 0) && (
                    <div className="flex justify-between text-[10px] text-gray-700 pt-0.5">
                        <span>POINTS:</span>
                        <span>{data.totalPV.toFixed(1)} PV | {data.totalBV.toFixed(1)} BV</span>
                    </div>
                )}

                <div className="flex justify-between text-[10px] pt-0.5">
                    <span>PAYMENT:</span>
                    <span className="font-bold uppercase">{data.paymentMode}</span>
                </div>

                {data.initialDeposit !== undefined && data.initialDeposit > 0 && (
                    <div className="flex justify-between text-[10px]">
                        <span>DEPOSIT:</span>
                        <span className="font-bold">UGX {data.initialDeposit.toLocaleString()}</span>
                    </div>
                )}

                {data.balance !== undefined && data.balance > 0 && (
                    <div className="flex justify-between text-[10px] font-bold text-red-600">
                        <span>BALANCE DUE:</span>
                        <span>UGX {data.balance.toLocaleString()}</span>
                    </div>
                )}
            </div>

            {/* Promotions */}
            {data.promotions && data.promotions.length > 0 && (
                <div className="py-2 border-b border-dashed border-black text-[10px]">
                    <p className="font-black text-center mb-1 uppercase tracking-wider">🎉 PROMO REWARDS</p>
                    {data.promotions.map((p, idx) => (
                        <div key={idx} className="flex justify-between">
                            <span className="truncate max-w-[120px]">{p.promotionName}</span>
                            <span className="font-bold">{p.prize}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="pt-3 text-center space-y-1 text-[9px] text-gray-600">
                <p className="font-bold text-black">THANK YOU FOR SHOPPING WITH US!</p>
                <p>Goods once sold are not returnable</p>
                <p>Printed on {new Date().toLocaleDateString()}</p>
                <p className="font-mono text-[8px] text-gray-400">POWERED BY SMARTBUZ POS</p>
            </div>
        </div>
    );
}
