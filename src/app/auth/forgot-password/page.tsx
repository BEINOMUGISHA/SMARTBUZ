"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Mail } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const requestReset = useMutation(api.users.requestPasswordReset);


    // ...

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await requestReset({ email });
            setSubmitted(true);
            toast.success("Reset code sent to your email");
        } catch (error: any) {
            toast.error(formatError(error));
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background p-4">
                <div className="w-full max-w-md space-y-8 text-center">
                    <div className="flex justify-center">
                        <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                            <Mail className="h-8 w-8" />
                        </div>
                    </div>
                    <h1 className="text-3xl font-bold">Check your email</h1>
                    <p className="text-muted-foreground">
                        We've sent a password reset code to <span className="font-semibold text-foreground">{email}</span>.
                        Please enter the code on the next page to reset your password.
                    </p>
                    <div className="pt-4">
                        <Link href={`/auth/reset-password?email=${encodeURIComponent(email)}`}>
                            <Button className="w-full h-12 text-lg">Enter Reset Code</Button>
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen w-full lg:grid lg:grid-cols-2 bg-muted/30">
            {/* Left side: Hero Section (Desktop only) */}
            <div className="hidden bg-muted lg:block relative">
                <Image
                    src="/bac.jpg"
                    alt="Forgot Password Background"
                    fill
                    className="object-cover"
                    priority
                />
                <div className="absolute inset-0 bg-primary/30 backdrop-blur-[3px] flex flex-col items-center justify-center p-12 text-white">
                    {/* <div className="mb-12">
                        <Image src="/logo.ico" alt="Logo" width={240} height={80} className="object-contain brightness-0 invert" />
                    </div> */}
                    <h2 className="text-5xl font-extrabold mb-6 text-center leading-tight">Recover Your <br />Account</h2>
                    <p className="text-xl text-center max-w-md opacity-90 font-medium">
                        Don't worry, we'll help you get back into your POS system in no time.
                    </p>
                </div>
                <div className="absolute bottom-8 left-0 right-0 text-center text-white/60 text-sm">
                    Tiens Uganda Support Team • Secure Recovery
                </div>
            </div>

            {/* Right side: Form */}
            <div className="flex items-center justify-center py-12 px-6 sm:px-12 lg:px-8 bg-background relative overflow-hidden">
                {/* Subtle decorative elements for mobile */}
                <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-primary/5 rounded-full blur-3xl lg:hidden" />
                <div className="absolute bottom-[-10%] left-[-10%] w-64 h-64 bg-secondary/10 rounded-full blur-3xl lg:hidden" />

                <div className="w-full max-w-[420px] space-y-10 relative z-10">
                    <div className="flex flex-col items-center text-center">
                        {/* Back Link */}
                        <div className="w-full text-left mb-6">
                            <Link href="/auth/login" className="inline-flex items-center text-sm font-bold text-muted-foreground hover:text-primary transition-colors group">
                                <ArrowLeft className="mr-2 h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
                                Back to Sign In
                            </Link>
                        </div>


                        <div className="space-y-3">
                            <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl lg:text-5xl">Forgot Password</h1>
                            <p className="text-sm sm:text-base text-muted-foreground font-medium max-w-xs mx-auto">
                                We'll send a 6-digit code to your email
                            </p>
                        </div>
                    </div>

                    <div className="bg-card border shadow-xl rounded-2xl p-6 sm:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-5">
                                <div className="space-y-2.5">
                                    <Label htmlFor="email" className="text-sm font-bold uppercase tracking-wider text-muted-foreground/80">Registered Email</Label>
                                    <div className="relative group">
                                        <Input
                                            id="email"
                                            type="email"
                                            required
                                            placeholder="admin@pos.com"
                                            className="h-14 pl-4 pr-4 border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all rounded-xl text-lg"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <Button
                                disabled={loading}
                                type="submit"
                                className="w-full h-14 text-lg font-bold shadow-xl shadow-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all rounded-xl relative overflow-hidden group"
                            >
                                <span className="relative z-10">{loading ? "Sending Code..." : "Send Reset Code"}</span>
                                <div className="absolute inset-0 bg-white/10 group-hover:translate-x-full transition-transform duration-500 skew-x-12" />
                            </Button>
                        </form>
                    </div>

                    <div className="pt-4 text-center">
                        <p className="text-sm font-medium text-muted-foreground/60">
                            Need help? Contact Tiens Uganda IT Support
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
