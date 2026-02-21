"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
                    <style dangerouslySetInnerHTML={{
                        __html: `
                        @media print {
                            /* Hide everything in the body by default */
                            body > * { display: none !important; }
                            
                            /* Enable visibility for our portal */
                            #print-portal { 
                                display: block !important;
                                width: 100%;
                                background: white;
                            }
                            #print-portal * { 
                                visibility: visible !important; 
                            }
                            
                            /* Reset margins to hide browser header/footer */
                            @page { margin: 0; size: auto; }
                            
                            #print-portal {
                                padding: 0.5cm !important;
                            }
                        }
                        /* Hide print container on screen */
                        @media screen {
                            #print-portal { display: none; }
                        }
                    ` }} />
                    <div className="p-8">
                        <ReceiptTemplate data={data} />
                    </div>
                </div>,
                document.body
            )}

            {/* MODAL VIEW - For on-screen viewing only */}
            <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white text-black sm:max-w-[800px] print:hidden">
                    <DialogTitle className="sr-only">Receipt Preview</DialogTitle>
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
