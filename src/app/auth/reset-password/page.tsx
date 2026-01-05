"use client";

import { useState, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

// Form component is defined below ResetPasswordPage

export default function ResetPasswordPage() {
    return (
        <div className="flex min-h-screen w-full lg:grid lg:grid-cols-2 bg-muted/30">
            {/* Left side: Hero Section (Desktop only) */}
            <div className="hidden bg-muted lg:block relative">
                <Image
                    src="/bac.jpg"
                    alt="Reset Password Background"
                    fill
                    className="object-cover"
                    priority
                />
                <div className="absolute inset-0 bg-primary/30 backdrop-blur-[3px] flex flex-col items-center justify-center p-12 text-white">
                    {/* <div className="mb-12">
                        <Image src="/logo.ico" alt="Logo" width={240} height={80} className="object-contain brightness-0 invert" />
                    </div> */}
                    <h2 className="text-5xl font-extrabold mb-6 text-center leading-tight">Secure Your <br />Account</h2>
                    <p className="text-xl text-center max-w-md opacity-90 font-medium">
                        Create a strong password to protect your sales data and customer records.
                    </p>
                </div>
                <div className="absolute bottom-8 left-0 right-0 text-center text-white/60 text-sm">
                    Tiens Uganda Security Standards • Trusted Systems
                </div>
            </div>

            {/* Right side: Form */}
            <div className="flex items-center justify-center py-12 px-6 sm:px-12 lg:px-8 bg-background relative overflow-hidden">
                {/* Subtle decorative elements for mobile */}
                <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-primary/5 rounded-full blur-3xl lg:hidden" />
                <div className="absolute bottom-[-10%] left-[-10%] w-64 h-64 bg-secondary/10 rounded-full blur-3xl lg:hidden" />

                <div className="w-full max-w-[420px] space-y-10 relative z-10">
                    <Suspense fallback={
                        <div className="flex flex-col items-center justify-center space-y-4">
                            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                            <p className="text-muted-foreground font-medium animate-pulse">Initializing security...</p>
                        </div>
                    }>
                        <ResetPasswordFormLayout />
                    </Suspense>

                    <div className="pt-4 text-center">
                        <p className="text-sm font-medium text-muted-foreground/60">
                            Questions? Contact Tiens Uganda IT Support
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ResetPasswordFormLayout() {
    return <ResetPasswordForm />;
}

// Update the inner ResetPasswordForm component as well
function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const email = searchParams.get("email") || "";

    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    const resetPasswordMutation = useMutation(api.users.resetPassword);


    // ...

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (newPassword !== confirmPassword) {
            toast.error("Passwords do not match");
            return;
        }

        setLoading(true);
        try {
            await resetPasswordMutation({ email, code, newPassword });
            setSuccess(true);
            toast.success("Password reset successfully");
        } catch (error: any) {
            toast.error(formatError(error));
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="bg-card border shadow-xl rounded-2xl p-8 text-center space-y-8 animate-in zoom-in-95 duration-500">
                <div className="flex justify-center">
                    <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center text-primary shadow-inner">
                        <CheckCircle2 className="h-10 w-10 animate-pulse" />
                    </div>
                </div>
                <div className="space-y-2">
                    <h1 className="text-3xl font-black text-foreground">Success!</h1>
                    <p className="text-muted-foreground font-medium px-4">
                        Your password has been successfully reset. You can now access your dashboard.
                    </p>
                </div>
                <div className="pt-2">
                    <Link href="/auth/login" className="block w-full">
                        <Button className="w-full h-14 text-lg font-bold shadow-xl shadow-primary/25 hover:scale-[1.02] transition-transform rounded-xl">
                            Sign In Now
                        </Button>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="flex flex-col items-center text-center">
                {/* Back Link */}
                <div className="w-full text-left mb-6">
                    <Link href="/auth/forgot-password" className="inline-flex items-center text-sm font-bold text-muted-foreground hover:text-primary transition-colors group">
                        <ArrowLeft className="mr-2 h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
                        Back to Code Request
                    </Link>
                </div>


                <div className="space-y-3">
                    <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl lg:text-5xl">Set New Password</h1>
                    <p className="text-sm sm:text-base text-muted-foreground font-medium max-w-xs mx-auto">
                        Verifying for <span className="text-foreground font-bold">{email}</span>
                    </p>
                </div>
            </div>

            <div className="bg-card border shadow-xl rounded-2xl p-6 sm:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-5">
                        <div className="space-y-2.5">
                            <Label htmlFor="code" className="text-sm font-bold uppercase tracking-wider text-muted-foreground/80">Verification Code</Label>
                            <Input
                                id="code"
                                required
                                placeholder="123456"
                                className="h-14 text-center text-3xl tracking-[0.6em] font-black border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all rounded-xl"
                                maxLength={6}
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2.5">
                            <Label htmlFor="password" className="text-sm font-bold uppercase tracking-wider text-muted-foreground/80">New Password</Label>
                            <Input
                                id="password"
                                type="password"
                                required
                                placeholder="••••••••"
                                className="h-14 pl-4 pr-4 border-muted-foreground/20 focus:border-primary transition-all rounded-xl text-lg"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2.5">
                            <Label htmlFor="confirmPassword" className="text-sm font-bold uppercase tracking-wider text-muted-foreground/80">Confirm Password</Label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                required
                                placeholder="••••••••"
                                className="h-14 pl-4 pr-4 border-muted-foreground/20 focus:border-primary transition-all rounded-xl text-lg"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    <Button disabled={loading} type="submit" className="w-full h-14 text-lg font-bold shadow-xl shadow-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all rounded-xl relative overflow-hidden group">
                        <span className="relative z-10">{loading ? "Updating..." : "Reset Password"}</span>
                        <div className="absolute inset-0 bg-white/10 group-hover:translate-x-full transition-transform duration-500 skew-x-12" />
                    </Button>
                </form>
            </div>
        </>
    );
}
