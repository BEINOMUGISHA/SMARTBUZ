"use client";

import { useState, useEffect } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Phone, CheckCircle2, AlertCircle, Smartphone, X, PlugZap } from "lucide-react";
import {
    adapterKeyForNetwork,
    describeOutcome,
    detectCarrier,
    formatUgandaPhone,
    type MobileMoneyNetwork,
} from "@/lib/mobile-money";
import { useAuth } from "@/context/auth-context";
import { businessCurrency, formatMoney } from "@/lib/currency";
import { toast } from "sonner";
import { useT } from "@/i18n/provider";

interface MoMoModalProps {
    isOpen: boolean;
    onClose: () => void;
    amount: number;
    initialPhone?: string;
    /**
     * Called when a payment has been **started** and has a reference.
     *
     * The reference is handed over so the sale can carry it. The sale is
     * recorded as awaiting confirmation — the provider confirms it, not
     * this dialog.
     */
    onPaymentStarted: (reference: string, message: string) => void;
}

type ModalStatus = "IDLE" | "PROMPTING" | "WAITING_PIN" | "CONFIRMED" | "FAILED";

export function MobileMoneyModal({
    isOpen,
    onClose,
    amount,
    initialPhone = "",
    onPaymentStarted,
}: MoMoModalProps) {
    
    const tr = useT();const convex = useConvex();
    const { activeBusiness } = useAuth();

    // The currency the business trades in.
    //
    // It used to be sent to the provider as "UGX" whatever the business
    // was set up for. A provider given the wrong currency code refuses the
    // transaction, so a business trading in dollars could not take a
    // mobile-money payment at all.
    const currency = businessCurrency(activeBusiness?.currency);

    const [phone, setPhone] = useState(initialPhone);
    const [network, setNetwork] = useState<MobileMoneyNetwork>("MTN");
    const [status, setStatus] = useState<ModalStatus>("IDLE");
    const [manualRef, setManualRef] = useState("");
    const [timer, setTimer] = useState(60);
    /** The reference of the payment that was started. */
    const [reference, setReference] = useState("");
    const [lastMessage, setLastMessage] = useState("");

    // Keep the phone in sync with the checkout value (prop changes and re-open)
    useEffect(() => {
        if (isOpen) {
            setPhone(initialPhone ?? "");
        }
    }, [isOpen, initialPhone]);

    // Reset transient state when the modal closes so the next payment starts clean
    useEffect(() => {
        if (!isOpen) {
            setStatus("IDLE");
            setManualRef("");
            setTimer(60);
            setReference("");
            setLastMessage("");
        }
    }, [isOpen]);

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

    /**
     * Ask the provider to collect the money.
     *
     * This calls the real adapter on the server. If the adapter has not
     * been proved against the live provider, the server refuses — and
     * that refusal is shown here rather than hidden.
     */
    const handleSendPrompt = async () => {
        const msisdn = formatUgandaPhone(phone);
        if (msisdn.length !== 12) {
            toast.error("Please enter a valid Ugandan phone number (e.g. 0772123456)");
            return;
        }

        setStatus("PROMPTING");

        try {
            const result = await convex.action(
                api.integrations.payments.initiatePayment,
                {
                    adapterKey: adapterKeyForNetwork(network),
                    amount,
                    currency: currency,
                    phone: msisdn,
                    description: "POS Sale Payment",
                }
            );

            const message =
                result.message ??
                `The prompt was sent. The customer still has to enter their ${network} PIN.`;

            setLastMessage(message);
            setReference(result.reference);

            if (result.status === "succeeded") {
                // The provider confirmed it outright — that happens when
                // a collection is already settled.
                setStatus("CONFIRMED");
                onPaymentStarted(result.reference, message);
                toast.success(message);
            } else if (result.status === "failed") {
                setStatus("FAILED");
                toast.error(message);
            } else {
                setStatus("WAITING_PIN");
                setTimer(60);
                onPaymentStarted(result.reference, message);
                toast.success(message);
            }
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "The mobile money prompt could not be sent.";
            setStatus("FAILED");
            setLastMessage(message);
            toast.error(message);
        }
    };

    /**
     * Ask the provider whether the money arrived.
     *
     * This is the only thing that confirms a payment. It asks the
     * provider, not the cashier.
     */
    const handleCheckWithProvider = async () => {
        if (!reference) return;

        setStatus("PROMPTING");

        try {
            const result = await convex.action(
                api.integrations.payments.verifyPaymentWithProvider,
                { reference }
            );

            const message =
                result.message ??
                (result.status === "succeeded"
                    ? "The provider confirmed the payment."
                    : "The provider has not confirmed the payment yet.");

            setLastMessage(message);

            if (result.status === "succeeded") {
                setStatus("CONFIRMED");
                toast.success(message);
            } else if (result.status === "failed") {
                setStatus("FAILED");
                toast.error(message);
            } else {
                setStatus("WAITING_PIN");
                setTimer(60);
                toast.info(message);
            }
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "The provider could not be reached.";
            setStatus("WAITING_PIN");
            setLastMessage(message);
            toast.error(message);
        }
    };

    /**
     * Record a reference the customer gave us.
     *
     * This does **not** confirm the payment. It records the reference so
     * that somebody with the authority to verify payments can check it
     * against the provider's own record later.
     */
    const handleRecordManualReference = () => {
        const trimmedRef = manualRef.trim();

        if (!trimmedRef) {
            toast.error("Enter the reference from the customer's confirmation first.");
            return;
        }

        const message =
            `Recorded reference ${trimmedRef}. The payment still has to be checked against the provider's record before it counts as confirmed.`;

        setLastMessage(message);
        setReference(trimmedRef);
        setStatus("WAITING_PIN");
        onPaymentStarted(trimmedRef, message);
        toast.success(message);
    };

    const isPending = status === "WAITING_PIN";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
                <DialogHeader>
                    <div className="flex items-start justify-between gap-2">
                        <DialogTitle className="flex items-center gap-2">
                            <Smartphone className="h-5 w-5 text-primary" />
                            <span>{tr("Mobile Money Payment")}</span>
                        </DialogTitle>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={onClose}
                            aria-label={tr("Close mobile money dialog")}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                    <DialogDescription>
                        {tr("Ask")} {network} {tr("to send a PIN prompt to the customer&apos;s phone. The money is confirmed by")} {network}{tr(", not by the till.")}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Amount Callout */}
                    <div className="p-3 rounded-xl bg-muted/60 border flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">{tr("Amount Due:")}</span>
                        <span className="text-xl font-semibold text-primary">{formatMoney(amount, currency)}</span>
                    </div>

                    {/* Network Selection */}
                    <div className="space-y-1.5">
                        <Label className="text-xs font-bold">{tr("Select Mobile Carrier")}</Label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setNetwork("MTN")}
                                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-semibold transition-all ${network === "MTN" ? "border-amber-400 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-2 ring-amber-400/20" : "border-border hover:bg-muted"}`}
                            >
                                <span>{tr("MTN MoMo")}</span>
                                <Badge className="bg-amber-400 text-black hover:bg-amber-400 text-xs font-semibold">*165#</Badge>
                            </button>

                            <button
                                type="button"
                                onClick={() => setNetwork("AIRTEL")}
                                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs font-semibold transition-all ${network === "AIRTEL" ? "border-red-500 bg-red-500/10 text-red-600 dark:text-red-300 ring-2 ring-red-500/20" : "border-border hover:bg-muted"}`}
                            >
                                <span>{tr("Airtel Money")}</span>
                                <Badge className="bg-red-600 text-white hover:bg-red-600 text-xs font-semibold">*185#</Badge>
                            </button>
                        </div>
                    </div>

                    {/* Phone Input */}
                    <div className="space-y-1.5">
                        <Label htmlFor="momo-phone" className="text-xs font-bold">{tr("Customer Phone Number")}</Label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="momo-phone"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="0772 123 456"
                                className="pl-9 font-mono"
                                disabled={isPending}
                            />
                        </div>
                    </div>

                    {/* Status Area */}
                    <div aria-live="polite" className="space-y-2">
                        {status === "PROMPTING" && (
                            <div
                                key="prompting"
                                className="p-4 rounded-xl border border-amber-400/30 bg-amber-500/5 text-center space-y-2 animate-in fade-in slide-in-from-top-1 duration-200"
                            >
                                <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
                                <p className="font-bold text-sm">{tr("Talking to")} {network}...</p>
                                <p className="text-xs text-muted-foreground">
                                    {tr("Asking")} {network} {tr("to send a PIN prompt to the customer&apos;s phone.")}
                                </p>
                            </div>
                        )}

                        {isPending && (
                            <div
                                key="waiting-pin"
                                className="p-4 rounded-xl border border-primary/20 bg-primary/5 text-center space-y-2 animate-in fade-in slide-in-from-top-1 duration-200"
                            >
                                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                                <p className="font-bold text-sm">{tr("Waiting for the customer")}</p>
                                <p className="text-xs text-muted-foreground">
                                    {tr("The customer is entering their secret PIN on their phone. The money is confirmed once")} {network} {tr("says so.")}
                                </p>
                                <div className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                                    {tr("Timeout in")} {timer}s
                                </div>
                                {reference && (
                                    <p className="text-xs font-mono text-muted-foreground break-all">
                                        {tr("Reference:")} {reference}
                                    </p>
                                )}
                            </div>
                        )}

                        {status === "CONFIRMED" && (
                            <div
                                key="confirmed"
                                className="p-4 rounded-xl border border-green-500/30 bg-green-500/5 text-center space-y-2 animate-in fade-in slide-in-from-top-1 duration-200"
                            >
                                <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
                                <p className="font-bold text-sm">{tr("Confirmed by")} {network}</p>
                                <p className="text-xs text-muted-foreground">
                                    {tr("The provider confirmed this payment.")}
                                </p>
                            </div>
                        )}

                        {status === "FAILED" && (
                            <div
                                key="failed"
                                className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 text-center space-y-2 animate-in fade-in slide-in-from-top-1 duration-200"
                            >
                                <AlertCircle className="h-8 w-8 text-red-600 mx-auto" />
                                <p className="font-bold text-sm">{tr("The payment did not go through")}</p>
                                <p className="text-xs text-muted-foreground">
                                    {tr("Nothing was charged. Record the sale as unpaid, or try again.")}
                                </p>
                            </div>
                        )}

                        {lastMessage && status !== "PROMPTING" && (
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                {lastMessage}
                            </p>
                        )}
                    </div>

                    {/* Manual Reference */}
                    <div className="space-y-1.5 pt-2 border-t">
                        <Label htmlFor="momo-reference" className="text-xs text-muted-foreground font-semibold">
                            {tr("Reference from the customer&apos;s confirmation (optional)")}
                        </Label>
                        <Input
                            id="momo-reference"
                            placeholder={tr("e.g. 1948203948 (from the customer's SMS)")}
                            value={manualRef}
                            onChange={(e) => setManualRef(e.target.value)}
                            className="h-8 text-xs font-mono"
                        />
                        <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-start gap-1">
                            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>
                                {tr("A reference records the payment for checking. It does not confirm it — that is the provider&apos;s word to give.")}
                            </span>
                        </p>
                    </div>
                </div>

                <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
                    <Button variant="outline" size="sm" onClick={onClose}>
                        {tr("Close")}
                    </Button>

                    <div className="flex items-center gap-2">
                        {!isPending && status !== "CONFIRMED" && (
                            <Button
                                size="sm"
                                onClick={handleSendPrompt}
                                disabled={!phone || status === "PROMPTING"}
                                aria-label={tr("Send PIN prompt to customer")}
                                className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-black font-bold"
                            >
                                {status === "PROMPTING" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}
                                <span>{tr("Send Prompt")}</span>
                            </Button>
                        )}

                        {isPending && reference && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleCheckWithProvider}
                                className="gap-1.5"
                            >
                                <PlugZap className="h-3.5 w-3.5" />
                                <span>{tr("Ask")} {network}</span>
                            </Button>
                        )}

                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleRecordManualReference}
                            disabled={!manualRef.trim()}
                            className="gap-1.5"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>{tr("Record Reference")}</span>
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
