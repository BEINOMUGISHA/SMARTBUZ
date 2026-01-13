"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, User, Lock, KeyRound, Eye, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
    const { user } = useAuth();

    // Using a query to fetch ONLY the logged in user's fresh data would be ideal, 
    // but we can use the auth context user for now or fetch by email if needed for freshness.
    // Assuming auth context user is fairly fresh.

    const updateUser = useMutation(api.users.update);
    const changePassword = useMutation(api.users.changePassword);



    const [isLoading, setIsLoading] = useState(false);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    if (!user) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    }

    const handleProfileUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        const formData = new FormData(e.currentTarget);

        try {
            await updateUser({
                id: user._id,
                first_name: formData.get("first_name") as string,
                last_name: formData.get("last_name") as string,
                phone_number: formData.get("phone_number") as string,
                // Email is intentionally omitted/disabled
            });
            toast.success("Profile updated successfully");
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        const formData = new FormData(e.currentTarget);
        const currentPassword = formData.get("currentPassword") as string;
        const newPassword = formData.get("newPassword") as string;
        const confirmPassword = formData.get("confirmPassword") as string;

        if (newPassword !== confirmPassword) {
            toast.error("New passwords do not match");
            setIsLoading(false);
            return;
        }

        if (newPassword.length < 6) {
            toast.error("Password must be at least 6 characters");
            setIsLoading(false);
            return;
        }

        try {
            await changePassword({
                userId: user._id,
                currentPassword,
                newPassword,
            });
            toast.success("Password changed successfully");
            (e.target as HTMLFormElement).reset();
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto pb-12">
            <div className="flex flex-col gap-2 bg-card/50 p-6 rounded-2xl border border-sidebar-border/50 shadow-sm backdrop-blur-md relative overflow-hidden group">
                <div className="absolute -right-8 -top-8 opacity-[0.03] group-hover:scale-110 transition-transform duration-700">
                    <User className="h-40 w-40" />
                </div>
                <div className="relative z-10">
                    <h1 className="text-3xl font-black tracking-tight text-foreground">Account Settings</h1>
                    <p className="text-muted-foreground font-medium">Manage your personal profile and security preferences.</p>
                </div>
            </div>

            <Tabs defaultValue="profile" className="w-full">
                <TabsList className="grid w-full grid-cols-2 lg:w-[400px] h-11 bg-muted/50 p-1.5 rounded-xl border border-sidebar-border/30 shadow-sm">
                    <TabsTrigger value="profile" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm font-bold text-sm">
                        <User className="h-4 w-4 mr-2" /> Profile
                    </TabsTrigger>
                    <TabsTrigger value="security" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm font-bold text-sm">
                        <Lock className="h-4 w-4 mr-2" /> Security
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Card className="border-sidebar-border/40 shadow-xl bg-card/30 backdrop-blur-sm overflow-hidden">
                        <div className="h-1.5 bg-linear-to-r from-blue-500 to-primary/50" />
                        <CardHeader>
                            <CardTitle className="text-xl font-bold">Personal Information</CardTitle>
                            <CardDescription className="font-medium text-muted-foreground">Update your personal details here.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleProfileUpdate} className="space-y-5">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="first_name" className="text-xs font-black uppercase tracking-wider text-muted-foreground ml-1">First Name</Label>
                                        <Input id="first_name" name="first_name" defaultValue={user.first_name} required className="h-11 rounded-xl bg-background shadow-sm focus:ring-primary/20" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="last_name" className="text-xs font-black uppercase tracking-wider text-muted-foreground ml-1">Last Name</Label>
                                        <Input id="last_name" name="last_name" defaultValue={user.last_name} required className="h-11 rounded-xl bg-background shadow-sm focus:ring-primary/20" />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="email" className="text-xs font-black uppercase tracking-wider text-muted-foreground ml-1">Primary Email</Label>
                                    <div className="relative group">
                                        <Input id="email" value={user.email} disabled className="h-11 rounded-xl bg-muted/50 font-medium text-muted-foreground cursor-not-allowed border-dashed" />
                                        <div className="absolute right-3 top-3.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Badge variant="outline" className="text-[10px] font-black uppercase border-muted-foreground/30 text-muted-foreground">Locked</Badge>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground font-medium pl-1 italic">Email address is managed by the central system and cannot be changed.</p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="phone" className="text-xs font-black uppercase tracking-wider text-muted-foreground ml-1">Contact Phone</Label>
                                    <Input id="phone" name="phone_number" defaultValue={user.phone_number || ""} placeholder="e.g. +256..." className="h-11 rounded-xl bg-background shadow-sm focus:ring-primary/20" />
                                </div>

                                <div className="pt-6 flex justify-end">
                                    <Button type="submit" disabled={isLoading} className="h-11 px-8 rounded-xl font-bold bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-95 transition-all">
                                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Save Changes
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="security" className="mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Card className="border-sidebar-border/40 shadow-xl bg-card/30 backdrop-blur-sm overflow-hidden">
                        <div className="h-1.5 bg-linear-to-r from-orange-500 to-amber-500/50" />
                        <CardHeader>
                            <CardTitle className="text-xl font-bold">Password & Security</CardTitle>
                            <CardDescription className="font-medium text-muted-foreground">Update your password to keep your account secure.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handlePasswordChange} className="space-y-5">
                                <div className="space-y-2">
                                    <Label htmlFor="currentPassword" title="Current Password" className="text-xs font-black uppercase tracking-wider text-muted-foreground ml-1">Current Password</Label>
                                    <div className="relative">
                                        <Input
                                            id="currentPassword"
                                            name="currentPassword"
                                            type={showCurrentPassword ? "text" : "password"}
                                            required
                                            className="h-11 rounded-xl bg-background pr-12 shadow-sm focus:ring-primary/20"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-1 top-1 h-9 w-9 rounded-lg hover:bg-muted"
                                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                        >
                                            {showCurrentPassword ? (
                                                <EyeOff className="h-4 w-4 text-muted-foreground" />
                                            ) : (
                                                <Eye className="h-4 w-4 text-muted-foreground" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                <div className="grid gap-6 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="newPassword" title="New Password" className="text-xs font-black uppercase tracking-wider text-muted-foreground ml-1">New Password</Label>
                                        <div className="relative">
                                            <Input
                                                id="newPassword"
                                                name="newPassword"
                                                type={showNewPassword ? "text" : "password"}
                                                required
                                                className="h-11 rounded-xl bg-background pr-12 shadow-sm focus:ring-primary/20"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-1 top-1 h-9 w-9 rounded-lg hover:bg-muted"
                                                onClick={() => setShowNewPassword(!showNewPassword)}
                                            >
                                                {showNewPassword ? (
                                                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="confirmPassword" title="Confirm Password" className="text-xs font-black uppercase tracking-wider text-muted-foreground ml-1">Confirm New Password</Label>
                                        <div className="relative">
                                            <Input
                                                id="confirmPassword"
                                                name="confirmPassword"
                                                type={showConfirmPassword ? "text" : "password"}
                                                required
                                                className="h-11 rounded-xl bg-background pr-12 shadow-sm focus:ring-primary/20"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-1 top-1 h-9 w-9 rounded-lg hover:bg-muted"
                                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            >
                                                {showConfirmPassword ? (
                                                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 flex justify-end">
                                    <Button type="submit" title="Submit" disabled={isLoading} className="h-11 px-8 rounded-xl font-bold bg-orange-600 hover:bg-orange-700 shadow-lg shadow-orange-200 active:scale-95 transition-all">
                                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Update Password
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
