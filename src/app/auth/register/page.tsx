"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { Eye, EyeOff, ArrowLeft, MailCheck } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const registerMutation = useMutation(api.users.register);
  const verifyEmailMutation = useMutation(api.users.verifyEmail);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone_number: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  /**
   * The account exists but cannot sign in until the address is proven.
   * This is the second step of registration.
   */
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleChange = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  /**
   * Ask the server to email a verification code.
   *
   * The code never reaches the browser — only the inbox.
   */
  const sendVerificationCode = async (email: string) => {
    setSending(true);
    try {
      const response = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error("Could not send the verification code.");
    } catch {
      // The account is created either way; the user can ask for another
      // code from the sign-in screen.
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters long");
      return;
    }

    setLoading(true);
    try {
      await registerMutation({
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        password: form.password,
        phone_number: form.phone_number || undefined,
      });

      // The account now exists. It cannot sign in until the address is
      // verified, so send the code and show the verification step.
      await sendVerificationCode(form.email.trim().toLowerCase());

      toast.success("Account created. Check your email for the verification code.");
      setAwaitingVerification(true);
    } catch (error: any) {
      toast.error(formatError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!/^\d{6}$/.test(code.trim())) {
      toast.error("Enter the 6-digit code from your email");
      return;
    }

    setVerifying(true);
    try {
      await verifyEmailMutation({
        email: form.email.trim().toLowerCase(),
        code: code.trim(),
      });
      toast.success("Email verified. You can sign in now.");
      router.push("/auth/login");
    } catch (error: any) {
      toast.error(formatError(error));
    } finally {
      setVerifying(false);
    }
  };

  if (awaitingVerification) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-xl">
          <Card className="shadow-xl border">
            <CardHeader className="space-y-1">
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                <MailCheck className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-3xl font-black">Verify your email</CardTitle>
              <CardDescription>
                We sent a 6-digit code to {form.email}. Enter it below to activate
                your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVerify} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="code">Verification code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="text-center text-2xl font-bold tracking-[0.5em]"
                  />
                </div>

                <Button type="submit" className="w-full" disabled={verifying}>
                  {verifying ? "Verifying..." : "Verify email"}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={sending}
                  onClick={() =>
                    sendVerificationCode(form.email.trim().toLowerCase())
                  }
                >
                  {sending ? "Sending..." : "Send a new code"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-xl">
        <div className="mb-4">
          <Link href="/auth/login" className="inline-flex items-center text-sm font-bold text-muted-foreground hover:text-primary transition-colors group">
            <ArrowLeft className="mr-2 h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
            Back to Login
          </Link>
        </div>

        <Card className="shadow-xl border">
          <CardHeader className="space-y-1">
            <CardTitle className="text-3xl font-black">Create your account</CardTitle>
            <CardDescription>Register a new SMART_BUZ user to get started.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="first_name">First name</Label>
                  <Input
                    id="first_name"
                    required
                    value={form.first_name}
                    onChange={(e) => handleChange("first_name", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">Last name</Label>
                  <Input
                    id="last_name"
                    required
                    value={form.last_name}
                    onChange={(e) => handleChange("last_name", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone_number">Phone number</Label>
                <Input
                  id="phone_number"
                  type="tel"
                  value={form.phone_number}
                  onChange={(e) => handleChange("phone_number", e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={form.password}
                    onChange={(e) => handleChange("password", e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={form.confirmPassword}
                    onChange={(e) => handleChange("confirmPassword", e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating account..." : "Register"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
