"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { ReceiptTemplate, ReceiptData } from "./ReceiptTemplate";

interface ReceiptProps {
    isOpen: boolean;
    onClose: () => void;
    data: ReceiptData;
}

export function ReceiptModal({ isOpen, onClose, data }: ReceiptProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!data) return null;

    return (
        <>
            {/* HIDDEN PRINT VIEW: Rendered via Portal at document.body level */}
            {mounted && isOpen && createPortal(
                <div id="print-portal">
                    <style jsx global>{`
                        @media print {
                            /* Hide everything in the body by default */
                            body > * { display: none !important; }
                            
                            /* FORCE visibility for our portal */
                            #print-portal { 
                                display: block !important;
                                position: fixed;
                                top: 0;
                                left: 0;
                                width: 100%;
                                height: 100%;
                                background: white;
                                z-index: 99999;
                            }
                            #print-portal * { 
                                visibility: visible !important; 
                            }
                            
                            /* Reset margins */
                            @page { margin: 0.5cm; size: auto; }
                        }
                        /* Hide print container on screen */
                        @media screen {
                            #print-portal { display: none; }
                        }
                    `}</style>
                    <div className="p-8">
                        <ReceiptTemplate data={data} />
                    </div>
                </div>,
                document.body
            )}

            {/* MODAL VIEW - For on-screen viewing only */}
            <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white text-black sm:max-w-[800px] print:hidden">
                    <ReceiptTemplate data={data} />

                    {/* On-Screen Print Button */}
                    <div className="p-4 border-t bg-gray-50 flex justify-end gap-2 print:hidden">
                        <Button variant="outline" onClick={onClose}>Close</Button>
                        <Button onClick={() => window.print()} className="gap-2">
                            <Printer className="h-4 w-4" /> Print Receipt
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
