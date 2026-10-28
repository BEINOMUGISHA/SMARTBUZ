"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Zap, FileText } from "lucide-react";
import { ReceiptTemplate, ReceiptData } from "./ReceiptTemplate";
import { ThermalReceipt } from "./ThermalReceipt";
import { buildThermalReceipt, printDirectWebSerial } from "@/lib/escpos";
import { toast } from "sonner";

interface ReceiptProps {
    isOpen: boolean;
    onClose: () => void;
    data: ReceiptData;
}

export function ReceiptModal({ isOpen, onClose, data }: ReceiptProps) {
    const [mounted, setMounted] = useState(false);
    const [receiptFormat, setReceiptFormat] = useState<"thermal" | "a4">("thermal");
    const [isSerialPrinting, setIsSerialPrinting] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!data) return null;

    const handleDirectThermalPrint = async () => {
        setIsSerialPrinting(true);
        try {
            const thermalBytes = buildThermalReceipt({
                shopName: data.shop.name,
                shopLocation: data.shop.location,
                shopContact: data.shop.contact,
                invoiceNumber: data.invoiceNumber,
                date: new Date(data.date).toLocaleDateString() + " " + new Date(data.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                cashierName: data.operator.name,
                customerName: data.customer?.name,
                customerPhone: data.customerPhone || data.customer?.phone,
                distributorId: data.customer?.distributorId,
                items: data.items.map((i: any) => ({
                    name: i.name,
                    qty: i.quantity,
                    price: i.price,
                })),
                total: data.total,
                totalPV: data.totalPV,
                totalBV: data.totalBV,
                paymentMode: data.paymentMode,
                isLoan: data.balance !== undefined && data.balance > 0,
                initialDeposit: data.initialDeposit,
                balance: data.balance,
                promotions: data.promotions?.map((p: any) => ({
                    promotionName: p.promotionName,
                    prize: p.prize,
                    count: p.redeemedQuantity,
                })),
            }, "80mm");

            await printDirectWebSerial(thermalBytes);
            toast.success("Printed directly to thermal printer!");
        } catch (err: any) {
            // Fall back to standard print
            toast.info("Using standard browser printing for thermal receipt.");
            window.print();
        } finally {
            setIsSerialPrinting(false);
        }
    };

    return (
        <>
            {/* HIDDEN PRINT VIEW: Rendered via Portal at document.body level */}
            {mounted && isOpen && createPortal(
                <div id="print-portal">
                    <style dangerouslySetInnerHTML={{
                        __html: `
                        @media print {
                            body > * { display: none !important; }
                            #print-portal { 
                                display: block !important; 
                                width: 100%; 
                                background: white; 
                            }
                            #print-portal * { 
                                visibility: visible !important; 
                            }
                            @page { 
                                size: ${receiptFormat === "thermal" ? "80mm auto" : "auto"}; 
                                margin: ${receiptFormat === "thermal" ? "0mm" : "0.5cm"}; 
                            }
                        }
                        @media screen {
                            #print-portal { display: none; }
                        }
                    ` }} />
                    <div className={receiptFormat === "thermal" ? "w-[80mm] mx-auto p-0" : "p-8"}>
                        {receiptFormat === "thermal" ? (
                            <ThermalReceipt data={data} />
                        ) : (
                            <ReceiptTemplate data={data} />
                        )}
                    </div>
                </div>,
                document.body
            )}

            {/* MODAL VIEW - For on-screen preview & actions */}
            <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto bg-white text-black print:hidden p-0">
                    <DialogTitle className="sr-only">Receipt Preview</DialogTitle>

                    {/* Top Switcher Bar */}
                    <div className="flex items-center justify-between p-3 border-b bg-gray-50">
                        <div className="flex items-center gap-1.5 bg-gray-200 p-0.5 rounded-lg text-xs font-bold">
                            <button
                                type="button"
                                onClick={() => setReceiptFormat("thermal")}
                                className={`px-3 py-1.5 rounded-md transition-all ${receiptFormat === "thermal" ? "bg-white shadow-sm text-black" : "text-gray-600 hover:text-black"}`}
                            >
                                80mm Thermal Slip
                            </button>
                            <button
                                type="button"
                                onClick={() => setReceiptFormat("a4")}
                                className={`px-3 py-1.5 rounded-md transition-all ${receiptFormat === "a4" ? "bg-white shadow-sm text-black" : "text-gray-600 hover:text-black"}`}
                            >
                                A4 Full Invoice
                            </button>
                        </div>
                    </div>

                    {/* Preview Area */}
                    <div className="p-4 flex justify-center bg-gray-100 overflow-x-auto min-h-[400px]">
                        <div className="bg-white shadow-md rounded border">
                            {receiptFormat === "thermal" ? (
                                <ThermalReceipt data={data} />
                            ) : (
                                <div className="max-w-[700px]">
                                    <ReceiptTemplate data={data} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Controls */}
                    <div className="p-4 border-t bg-gray-50 flex items-center justify-between">
                        <Button variant="outline" size="sm" onClick={onClose}>
                            Close
                        </Button>

                        <div className="flex items-center gap-2">
                            {receiptFormat === "thermal" && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleDirectThermalPrint}
                                    disabled={isSerialPrinting}
                                    className="gap-1.5 text-xs font-bold"
                                    title="Send raw ESC/POS commands directly to USB/Serial printer without dialog"
                                >
                                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                                    <span>Direct ESC/POS</span>
                                </Button>
                            )}

                            <Button
                                size="sm"
                                onClick={() => window.print()}
                                className="gap-2 font-bold bg-green-600 hover:bg-green-700 text-white"
                            >
                                <Printer className="h-4 w-4" />
                                <span>Print Receipt</span>
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
