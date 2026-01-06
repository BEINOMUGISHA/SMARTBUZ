import React from "react";

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
}

export const ReceiptTemplate = ({ data }: { data: ReceiptData }) => {
    return (
        <div id="receipt-content" className="p-8 text-sm text-gray-700 bg-white border border-gray-300 print:border-none print:p-0 print:m-0 print:w-full">
            {/* Header */}
            <div className="pb-4 print:break-inside-avoid">
                <div className="flex justify-between items-start">
                    <div className="flex-1 text-center">
                        <h2 className="text-2xl font-bold text-black tracking-wide uppercase">TIENS HEALTH PRODUCTS</h2>
                        <p className="text-sm leading-tight -mt-1">6th Floor, King Fahd Plaza, Plot 52 Kampala Rd</p>
                        <p className="text-sm">P.O.Box .... Kampala, Tel: +256 (0) 702 794 458 | 0773 662 136</p>
                    </div>
                    <div className="w-[100px] h-[100px] mr-2">
                        <img src="/logo.ico" alt="TIENS Logo" className="w-full h-full object-contain" />
                    </div>
                </div>

                {/* Customer & Shop Info - Input Style */}
                <div className="grid grid-cols-2 gap-4 mt-4 text-sm font-semibold">
                    <div className="flex items-center gap-2">
                        <span>DISTRIBUTOR'S NAME:</span>
                        <div className="border border-black h-6 w-full px-2 flex items-center">
                            {data.customer?.name || "Walk-in Customer"}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span>DISTRIBUTOR'S CONTACTS:</span>
                        <div className="border border-black h-6 w-full px-2 flex items-center">
                            {data.customer?.phone || "-"}
                        </div>
                    </div>
                </div>

                {/* ID & Serial */}
                <div className="flex justify-between items-center mt-2 text-sm font-semibold">
                    <div className="flex items-center gap-2">
                        <span>DISTRIBUTOR ID NO:</span>
                        <div className="flex gap-[2px]">
                            {(data.customer?.distributorId || data.customer?.email || "").slice(0, 8).padEnd(8, " ").split("").map((char, i) => (
                                <div key={i} className="border border-black w-6 h-6 flex items-center justify-center">
                                    {char}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span>SHOP SERIAL NO:</span>
                        <div className="border border-black h-6 px-2 flex items-center justify-center text-xs w-24">
                            {data.shop.serialNumber || "-"}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2 text-sm font-semibold">
                    <div className="flex items-center gap-2">
                        <span>CLIENT TYPE:</span>
                        <div className="border border-black h-6 w-full px-2 flex items-center">
                            {data.clientType}
                        </div>
                    </div>
                </div>
            </div>


            {/* Items Table */}
            <div className="border border-black text-xs print:text-[11px] print:break-inside-auto">
                <div className="grid grid-cols-12 font-bold border-b border-black">
                    <div className="p-2 border-r border-black break-words">CODE</div>
                    <div className="p-2 border-r border-black break-words col-span-3">NAME</div>
                    <div className="p-2 border-r border-black break-words">QTY</div>
                    <div className="p-2 border-r border-black break-words">PV</div>
                    <div className="p-2 border-r border-black break-words">%PV</div>
                    <div className="p-2 border-r border-black break-words">TOTAL PV</div>
                    <div className="p-2 border-r border-black break-words">BV</div>
                    <div className="p-2 border-r border-black break-words">%BV</div>
                    <div className="p-2 border-r border-black break-words">TOTAL BV</div>
                    <div className="p-2 border-r border-black break-words">UGSHS</div>
                </div>

                {data.items.map((item, i) => {
                    const totalLinePV = (item.pv || 0) * item.qty;
                    const totalLineBV = (item.bv || 0) * item.qty;
                    const percentPv = item.price > 0 ? `${Math.round((item.pv / item.price) * 100)}%` : "0%";
                    const percentBv = item.price > 0 ? `${Math.round((item.bv / item.price) * 100)}%` : "0%";

                    return (
                        <div key={i} className="grid grid-cols-12 border-b border-black text-black last:border-0">
                            <div className="p-2 border-r border-black break-words">{item.productCode || "-"}</div>
                            <div className="p-2 border-r border-black break-words col-span-3">{item.name}</div>
                            <div className="p-2 border-r border-black break-words">{item.qty}</div>
                            <div className="p-2 border-r border-black break-words">{item.pv}</div>
                            <div className="p-2 border-r border-black break-words">{percentPv}</div>
                            <div className="p-2 border-r border-black break-words">{totalLinePV}</div>
                            <div className="p-2 border-r border-black break-words">{item.bv}</div>
                            <div className="p-2 border-r border-black break-words">{percentBv}</div>
                            <div className="p-2 border-r border-black break-words">{totalLineBV}</div>
                            <div className="p-2 border-r border-black break-words">{(item.price * item.qty).toLocaleString()}</div>
                        </div>
                    )
                })}

                {/* Totals Row */}
                <div className="grid grid-cols-12 font-bold border-t border-black text-black">
                    <div className="col-span-5 p-2 border-r border-black text-right uppercase">TOTAL:</div>
                    <div className="col-span-1 p-2 border-r border-black"></div>
                    <div className="col-span-1 p-2 border-r border-black"></div>
                    <div className="col-span-1 p-2 border-r border-black text-right">{data.totalPV}</div>
                    <div className="col-span-1 p-2 border-r border-black"></div>
                    <div className="col-span-1 p-2 border-r border-black"></div>
                    <div className="col-span-1 p-2 border-r border-black text-right">{data.totalBV}</div>
                    <div className="col-span-1 p-2 text-right">{data.total.toLocaleString()}</div>
                </div>
            </div>

            {/* Footer Infos */}
            <div className="mt-8 text-sm border-t border-gray-300 pt-4 print:break-inside-avoid">
                <div className="mb-4">
                    <p className="font-semibold mb-1">Mode of Payment</p>
                    <p className="font-bold">{data.paymentMode}</p>
                    {data.paymentDueDate && (
                        <p className="text-red-600 text-xs mt-1 italic">
                            Due Date: {new Date(data.paymentDueDate).toLocaleDateString()}
                        </p>
                    )}
                </div>
                <div className="mb-4">
                    <p className="font-bold">GRAND TOTAL</p>
                    <p className="text-lg font-semibold">UGX {data.total.toLocaleString()}</p>
                </div>
                <div className="grid grid-cols-2 gap-6 mt-6">
                    <p>Date:</p>
                    <div className="border-b border-gray-300 h-6 mt-1 text-xs text-gray-700">
                        {new Date(data.date).toLocaleDateString()}
                    </div>
                </div>
                <p className="italic text-xs text-gray-500 mt-4">Please confirm that the Tianshi ID Number is correctly filled.</p>
                <p className="text-xs text-center mt-6">
                    <strong>Copies:</strong> First - Office | Second - Distributors | Third - Speciality Shop
                </p>

                <div className="grid grid-cols-2 gap-6 p-4 mt-4 text-sm text-gray-800 border-t border-gray-300 pt-4">
                    <div className="space-y-1">
                        <p className="font-bold mb-2 border-b border-dashed border-black pb-1">Shop Info</p>
                        <div className="flex"><span className="w-24 font-semibold">Name:</span> <span>{data.shop.name}</span></div>
                        <div className="flex"><span className="w-24 font-semibold">Location:</span> <span>{data.shop.location}</span></div>
                        <div className="flex"><span className="w-24 font-semibold">Contact:</span> <span>{data.shop.contact}</span></div>
                    </div>
                    <div className="space-y-1">
                        <p className="font-bold mb-2 border-b border-dashed border-black pb-1">Shop Operator</p>
                        <div className="flex"><span className="w-24 font-semibold">Name:</span> <span>{data.operator?.name || "N/A"}</span></div>
                        <div className="flex"><span className="w-24 font-semibold">Phone:</span> <span>{data.operator?.phone || "N/A"}</span></div>
                        <div className="flex"><span className="w-24 font-semibold">Email:</span> <span>{data.operator?.email || "N/A"}</span></div>
                    </div>
                </div>
            </div>

            <div className="mt-8 text-center text-[10px] italic text-gray-500">
                Thank you for choosing TIENS. Please retain this receipt for your records.
                <br />
                System Generated Receipt.
            </div>
        </div>
    );
};
