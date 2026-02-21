import React from "react";
import { cn } from "@/lib/utils";

export interface ReceiptData {
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
        productName: string;
    }[];
    customerPhone?: string;
    customerLocation?: string;
    transactionType?: string;
    returnedItems?: { stockId: string; name: string; productCode?: string; quantity: number }[];
}

export const ReceiptTemplate = ({ data }: { data: ReceiptData }) => {
    return (
        <div id="receipt-content" className="p-4 text-black bg-white print:p-0 print:m-0 print:w-full print-shrink font-sans leading-tight">
            <style dangerouslySetInnerHTML={{
                __html: `
                @media print {
                    #receipt-content {
                        width: 100%;
                        color: black !important;
                        background: white !important;
                    }
                    .no-print { display: none !important; }
                    * { border-color: black !important; }
                }
            ` }} />

            {/* Header section matched to photo */}
            <div className="pb-2 print:break-inside-avoid">
                <div className="flex justify-between items-start border-b border-black pb-4 mb-4">
                    <div className="flex-1 text-center">
                        <h2 className="text-2xl font-black text-black tracking-tighter uppercase mb-1">TIENS HEALTH PRODUCTS</h2>
                        <p className="text-[10px] leading-tight opacity-90">6th Floor, King Fahd Plaza, Plot 52 Kampala Rd</p>
                        <p className="text-[10px] leading-tight opacity-90">P.O.Box .... Kampala, Tel: +256 (0) 702 794 458 | 0773 662 136</p>
                    </div>
                    <div className="w-[80px] h-[80px] shrink-0 ml-4">
                        <img src="/logo.ico" alt="TIENS Logo" className="w-full h-full object-contain grayscale" />
                    </div>
                </div>

                {/* Info Fields Grid - Box Styles */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 text-[10px] font-bold uppercase">
                    {/* Row 1 */}
                    <div className="flex items-center gap-2">
                        <span className="shrink-0 w-24">DISTRIBUTOR'S NAME:</span>
                        <div className="border border-black h-6 flex-1 px-1 flex items-center font-black truncate bg-white">
                            {data.customer?.name || ""}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="shrink-0 w-24">DISTRIBUTOR'S CONTACTS:</span>
                        <div className="border border-black h-6 flex-1 px-1 flex items-center bg-white">
                            {data.customerPhone || data.customer?.phone || "N/A"}
                        </div>
                    </div>

                    {/* Row 2 */}
                    <div className="flex items-center gap-2">
                        <span className="shrink-0 w-24">DISTRIBUTOR ID NO:</span>
                        <div className="flex gap-[1px] flex-1">
                            {(data.customer?.distributorId || data.customer?.email || "").slice(0, 8).padEnd(8, " ").split("").map((char, i) => (
                                <div key={i} className="border border-black w-6 h-6 flex items-center justify-center font-black bg-white">
                                    {char.trim() || ""}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="shrink-0 w-16 text-right">SHOP SERIAL NO:</span>
                        <div className="border border-black h-6 w-32 px-1 flex items-center justify-center font-black bg-white">
                            {data.shop.serialNumber || ""}
                        </div>
                    </div>

                    {/* Row 3 */}
                    <div className="flex items-center gap-2 mt-1">
                        <span className="shrink-0 w-24">CLIENT TYPE:</span>
                        <div className="border border-black h-6 flex-1 px-2 flex items-center bg-white font-black">
                            {data.clientType}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="shrink-0 w-24">RECEIPT SERIAL NO:</span>
                        <div className="border border-black h-6 flex-1 px-2 flex items-center font-mono text-[9px] bg-white">
                            {data.invoiceNumber || "N/A"}
                        </div>
                    </div>
                </div>
            </div>

            {/* Items Table - Dense v5 Format */}
            <div className="mt-4 border-t border-l border-black text-[9px] print:break-inside-auto mb-4">
                {/* Custom Table Head */}
                <div className="grid grid-cols-[0.7fr_2.5fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr_0.6fr_0.7fr_1.2fr] font-black border-b border-r border-black uppercase text-center bg-slate-50 print:bg-transparent">
                    <div className="p-1 border-r border-black flex items-center justify-center">CODE</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">NAME</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">QTY</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">PV</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">%PV</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">TOTAL PV</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">BV</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">%BV</div>
                    <div className="p-1 border-r border-black flex items-center justify-center">TOTAL BV</div>
                    <div className="p-1 break-words">UG SHS</div>
                </div>

                {/* Items Rows */}
                {data.items.map((item, i) => {
                    const totalLinePV = (item.pv || 0) * item.qty;
                    const totalLineBV = (item.bv || 0) * item.qty;
                    const percentPv = item.price > 0 ? `${((item.pv / item.price) * 100).toFixed(1)}%` : "0%";
                    const percentBv = item.price > 0 ? `${((item.bv / item.price) * 100).toFixed(1)}%` : "0%";

                    return (
                        <div key={i} className="grid grid-cols-[0.7fr_2.5fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr_0.6fr_0.7fr_1.2fr] border-b border-r border-black text-center min-h-[24px]">
                            <div className="p-1 border-r border-black flex items-center justify-center">{item.productCode || ""}</div>
                            <div className="p-1 border-r border-black flex items-center text-left pl-2 font-medium">{item.name}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center font-black">{item.qty}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center">{item.pv}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center italic opacity-60">{percentPv}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center font-bold">{totalLinePV}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center">{item.bv}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center italic opacity-60">{percentBv}</div>
                            <div className="p-1 border-r border-black flex items-center justify-center font-bold">{totalLineBV}</div>
                            <div className="p-1 flex items-center justify-end pr-2 font-black">{(item.price * item.qty).toLocaleString()}</div>
                        </div>
                    );
                })}

                {/* Footer / Totals Row */}
                <div className="grid grid-cols-[0.7fr_2.5fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr_0.6fr_0.7fr_1.2fr] font-black border-b border-r border-black">
                    <div className="col-span-5 p-1 border-r border-black text-right pr-4 uppercase">TOTAL:</div>
                    <div className="p-1 border-r border-black text-center border-t border-black bg-slate-50 print:bg-transparent">{data.totalPV}</div>
                    <div className="col-span-2 border-r border-black"></div>
                    <div className="p-1 border-r border-black text-center border-t border-black bg-slate-50 print:bg-transparent">{data.totalBV}</div>
                    <div className="p-1 text-right pr-2 border-t border-black bg-slate-50 print:bg-transparent">{data.total.toLocaleString()}</div>
                </div>
            </div>

            {/* Post-Table info */}
            <div className="mt-4 text-[10px] space-y-2 print:break-inside-avoid">
                <div className="flex justify-between items-start border-b border-black border-dashed pb-2">
                    <div className="space-y-1">
                        <p className="font-bold uppercase tracking-tighter">Mode of Payment: <span className="underline ml-1">{data.paymentMode}</span></p>
                        {data.packageType && (
                            <p className="font-black italic text-[11px] uppercase tracking-widest border border-black px-2 py-0.5 inline-block">
                                PACKAGE: {data.packageType}
                            </p>
                        )}
                        {data.paymentDueDate && (
                            <p className="font-bold underline italic bg-slate-100 px-1 inline-block">DUE DATE: {new Date(data.paymentDueDate).toLocaleDateString()}</p>
                        )}
                    </div>
                    <div className="text-right space-y-1">
                        <div className="flex justify-end gap-10 min-w-[200px]">
                            <span className="font-bold uppercase">GRAND TOTAL (UGX):</span>
                            <span className="text-lg font-black">{data.total.toLocaleString()}</span>
                        </div>
                        {data.initialDeposit !== undefined && data.initialDeposit > 0 && (
                            <div className="flex justify-end gap-10">
                                <span className="font-medium italic">Amount Paid:</span>
                                <span className="font-bold">{data.initialDeposit.toLocaleString()}</span>
                            </div>
                        )}
                        {data.balance !== undefined && (
                            <div className="flex justify-end gap-10 border-t border-black pt-1">
                                <span className="font-black uppercase">BALANCE DUE:</span>
                                <span className="font-black underline text-sm">{data.balance.toLocaleString()}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Operator and Date */}
                <div className="grid grid-cols-2 gap-20 py-4 border-b border-black">
                    <div>
                        <p className="font-bold uppercase text-[8px] mb-1">Operator Signature:</p>
                        <div className="border-b border-black h-8 flex items-end pb-1 font-mono text-[9px]">
                            {data.operator?.name}
                        </div>
                    </div>
                    <div>
                        <p className="font-bold uppercase text-[8px] mb-1">Delivery Status:</p>
                        <div className="h-8 flex items-end pb-1 font-black text-[10px]">
                            {data.deliveryStatus === "Pending" ? "NOT TAKEN" : "FULLY DELIVERED"}
                        </div>
                    </div>
                </div>

                <div className="pt-2 text-[8px] italic flex justify-between uppercase font-bold opacity-60">
                    <span>Generated on: {new Date(data.date).toLocaleString()}</span>
                    <span>Official Document</span>
                </div>
            </div>

            <div className="mt-4 text-center text-[9px] font-black uppercase tracking-widest border-t border-black pt-2">
                TIENS - BE HEALTHIER, BE WEALTHIER
            </div>
        </div>
    );
};
