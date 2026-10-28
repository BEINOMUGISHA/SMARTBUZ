"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Phone, CheckCircle2, AlertCircle, Smartphone } from "lucide-react";
import { formatUgandaPhone, detectCarrier, initiateMoMoPush } from "@/lib/mobile-money";
import { toast } from "sonner";

interface MoMoModalProps {
    isOpen: boolean;
    onClose: () => void;
    amount: number;
    initialPhone?: string;
    onPaymentConfirmed: (reference: string) => void;
}

export function MobileMoneyModal({
    isOpen,
    onClose,
    amount,
    initialPhone = "",
    onPaymentConfirmed,
}: MoMoModalProps) {
    const [phone, setPhone] = useState(initialPhone);
    const [network, setNetwork] = useState<"MTN" | "AIRTEL">("MTN");
    const [status, setStatus] = useState<"IDLE" | "PROMPTING" | "WAITING_PIN" | "CONFIRMED">("IDLE");
    const [manualRef, setManualRef] = useState("");
    const [timer, setTimer] = useState(60);

    // Auto-detect carrier when phone changes
    useEffect(() => {
        if (phone) {
            const detected = detectCarrier(phone);
            if (detected === "MTN" || detected === "AIRTEL") {
                setNetwork(detected);
            }
        }
    }, [phone]);

    // Timer countdown while waiting for customer PIN
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (status === "WAITING_PIN" && timer > 0) {
            interval = setInterval(() => setTimer((t) => t - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [status, timer]);

    const handleSendPrompt = async () => {
        const msisdn = formatUgandaPhone(phone);
        if (msisdn.length !== 12) {
            toast.error("Please enter a valid Ugandan phone number (e.g. 0772123456)");
            return;
        }

        setStatus("PROMPTING");
        try {
            const response = await initiateMoMoPush({
                amount,
                phone: msisdn,
                network,
                reference: `SALE-${Date.now()}`,
                description: "POS Sale Payment",
            });

            if (response.success) {
                setStatus("WAITING_PIN");
                setTimer(60);
                toast.success(`Prompt sent! Customer should enter PIN on their ${network} handset.`);
            } else {
                toast.error(response.message || "Failed to send USSD prompt.");
                setStatus("IDLE");
            }
        } catch {
            toast.error("Network timeout requesting Mobile Money prompt.");
            setStatus("IDLE");
        }
    };

    const handleConfirmPayment = () => {
        const reference = manualRef.trim() || `${network}-${Date.now().toString(36).toUpperCase()}`;
        onPaymentConfirmed(reference);
        toast.success(`Mobile Money payment of UGX ${amount.toLocaleString()} confirmed!`);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Smartphone className="h-5 w-5 text-primary" />
                        <span>Mobile Money Payment</span>
                    </DialogTitle>
                    <DialogDescription>
                        Send an instant USSD PIN prompt directly to the customer's phone.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Amount Callout */}
                    <div className="p-3 rounded-xl bg-muted/60 border flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Amount Due:</span>
                        <span className="text-xl font-black text-primary">UGX {amount.toLocaleString()}</span>
                    </div>

                    {/* Network Selection */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-bold">Select Mobile Carrier</Label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setNetwork("MTN")}
                                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all ${network === "MTN" ? "border-amber-400 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-2 ring-amber-400/20" : "border-border hover:bg-muted"}`}
                            >
                                <span>MTN MoMo</span>
                                <Badge className="bg-amber-400 text-black hover:bg-amber-400 text-[10px] font-black">*165#</Badge>
                            </button>

                            <button
                                type="button"
                                onClick={() => setNetwork("AIRTEL")}
                                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-black transition-all ${network === "AIRTEL" ? "border-red-500 bg-red-500/10 text-red-600 dark:text-red-300 ring-2 ring-red-500/20" : "border-border hover:bg-muted"}`}
                            >
                                <span>Airtel Money</span>
                                <Badge className="bg-red-600 text-white hover:bg-red-600 text-[10px] font-black">*185#</Badge>
                            </button>
                        </div>
                    </div>

                    {/* Phone Input */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-bold">Customer Phone Number</Label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="0772 123 456"
                                className="pl-9 font-mono"
                                disabled={status === "WAITING_PIN"}
                            />
                        </div>
                    </div>

                    {/* Waiting State */}
                    {status === "WAITING_PIN" && (
                        <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 text-center space-y-2 animate-in fade-in">
                            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                            <p className="font-bold text-sm">USSD Prompt Dispatched</p>
                            <p className="text-xs text-muted-foreground">
                                Customer is entering their secret MoMo PIN on their phone.
                            </p>
                            <div className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                                Timeout in {timer}s
                            </div>
                        </div>
                    )}

                    {/* Manual SMS Reference Fallback */}
                    <div className="space-y-1.5 pt-2 border-t">
                        <Label className="text-[11px] text-muted-foreground font-semibold">
                            Manual Verification / SMS Reference (Optional)
                        </Label>
                        <Input
                            placeholder="e.g. 1948203948 (from customer's SMS)"
                            value={manualRef}
                            onChange={(e) => setManualRef(e.target.value)}
                            className="h-8 text-xs font-mono"
                        />
                    </div>
                </div>

                <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
                    <Button variant="outline" size="sm" onClick={onClose}>
                        Cancel
                    </Button>

                    <div className="flex items-center gap-2">
                        {status !== "WAITING_PIN" ? (
                            <Button
                                size="sm"
                                onClick={handleSendPrompt}
                                disabled={!phone || status === "PROMPTING"}
                                className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-black font-bold"
                            >
                                {status === "PROMPTING" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}
                                <span>Send USSD Prompt</span>
                            </Button>
                        ) : null}

                        <Button
                            size="sm"
                            onClick={handleConfirmPayment}
                            className="gap-1.5 bg-green-600 hover:bg-green-700 text-white font-bold"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Confirm & Paid</span>
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
