"use client";

/**
 * SMART_BUZ — business management.
 *
 * Everything an administrator of a business needs to run it:
 *
 *   • the business profile (name, currency, timezone, address)
 *   • the team (who works here, in what role)
 *   • branches (the sales points)
 *   • warehouses (where stock is kept)
 *   • employees (the staff list)
 *
 * Every call is tenant-scoped on the server: the business these screens
 * act on is the caller's active business, and the server refuses any
 * request for a business the caller does not belong to.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Building2, Loader2, Plus, Trash2, Users, Warehouse, Store, UserCog } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

const ROLES = [
    { value: "admin", label: "Administrator" },
    { value: "manager", label: "Manager" },
    { value: "cashier", label: "Cashier" },
    { value: "stock", label: "Stock" },
    { value: "viewer", label: "Viewer (read only)" },
];

const CURRENCIES = ["UGX", "USD", "RWF", "KES", "TZS", "EUR", "GBP"];

const TIMEZONES = [
    "Africa/Kampala",
    "Africa/Kigali",
    "Africa/Nairobi",
    "Africa/Dar_es_Salaam",
    "Europe/London",
    "Europe/Paris",
    "America/New_York",
];

export function BusinessManagement() {
    const business = useQuery(api.businesses.getActive, {});
    const summary = useQuery(api.businesses.getSetupSummary, {});

    if (business === undefined) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="animate-spin" />
            </div>
        );
    }

    if (!business) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>No business selected</CardTitle>
                    <CardDescription>
                        You do not belong to a business yet. Register one to get started.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <Card className="border-sidebar-border/40 shadow-xl bg-card/30 backdrop-blur-sm overflow-hidden">
                <div className="h-1.5 bg-linear-to-r from-emerald-500 to-teal-400" />
                <CardHeader>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <Building2 className="h-5 w-5" /> {business.name}
                    </CardTitle>
                    <CardDescription className="font-medium text-muted-foreground">
                        {summary?.onboardingComplete
                            ? "Your business is set up. Manage it below."
                            : "Finish setting up your business to unlock every module."}
                    </CardDescription>
                </CardHeader>
            </Card>

            <Tabs defaultValue="team">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-5 h-11 bg-muted/50 p-1.5 rounded-xl">
                    <TabsTrigger value="team" className="rounded-lg font-bold text-sm">
                        <Users className="h-4 w-4 mr-2" /> Team
                    </TabsTrigger>
                    <TabsTrigger value="branches" className="rounded-lg font-bold text-sm">
                        <Store className="h-4 w-4 mr-2" /> Branches
                    </TabsTrigger>
                    <TabsTrigger value="warehouses" className="rounded-lg font-bold text-sm">
                        <Warehouse className="h-4 w-4 mr-2" /> Warehouses
                    </TabsTrigger>
                    <TabsTrigger value="employees" className="rounded-lg font-bold text-sm">
                        <UserCog className="h-4 w-4 mr-2" /> Employees
                    </TabsTrigger>
                    <TabsTrigger value="profile" className="rounded-lg font-bold text-sm">
                        <Building2 className="h-4 w-4 mr-2" /> Profile
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="team" className="mt-6">
                    <TeamPanel />
                </TabsContent>
                <TabsContent value="branches" className="mt-6">
                    <BranchesPanel />
                </TabsContent>
                <TabsContent value="warehouses" className="mt-6">
                    <WarehousesPanel />
                </TabsContent>
                <TabsContent value="employees" className="mt-6">
                    <EmployeesPanel />
                </TabsContent>
                <TabsContent value="profile" className="mt-6">
                    <ProfilePanel />
                </TabsContent>
            </Tabs>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────
 * Team
 * ──────────────────────────────────────────────────────────────────── */

function TeamPanel() {
    const members = useQuery(api.businesses.listMembers, {});
    const invitations = useQuery(api.businesses.listInvitations, {});
    const addMember = useMutation(api.businesses.addMember);
    const updateRole = useMutation(api.businesses.updateMemberRole);
    const removeMember = useMutation(api.businesses.removeMember);

    const [email, setEmail] = useState("");
    const [role, setRole] = useState("cashier");
    const [jobTitle, setJobTitle] = useState("");
    const [saving, setSaving] = useState(false);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await addMember({ email, role, jobTitle: jobTitle || undefined });
            toast.success(`${email} added to the business`);
            setEmail("");
            setJobTitle("");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    const handleRole = async (userId: any, newRole: string) => {
        try {
            await updateRole({ userId, role: newRole });
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const handleRemove = async (userId: any) => {
        try {
            await removeMember({ userId });
            toast.success("Member removed");
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-bold">Team</CardTitle>
                <CardDescription>
                    Everyone who can sign in to this business. A role decides what they may do
                    here — and only here.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <form onSubmit={handleAdd} className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
                    <div className="space-y-2">
                        <Label htmlFor="member-email">Email</Label>
                        <Input
                            id="member-email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="staff@example.com"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="member-role">Role</Label>
                        <Select value={role} onValueChange={setRole}>
                            <SelectTrigger id="member-role">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ROLES.map((r) => (
                                    <SelectItem key={r.value} value={r.value}>
                                        {r.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="member-title">Job title</Label>
                        <Input
                            id="member-title"
                            value={jobTitle}
                            onChange={(e) => setJobTitle(e.target.value)}
                            placeholder="Cashier"
                        />
                    </div>
                    <Button type="submit" disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        Add
                    </Button>
                </form>

                <div className="space-y-2">
                    {(members ?? []).map((m) => (
                        <div
                            key={m._id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                        >
                            <div className="min-w-0">
                                <div className="truncate font-semibold">{m.name}</div>
                                <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                {m.role === "owner" ? (
                                    <Badge>Owner</Badge>
                                ) : (
                                    <Select
                                        value={m.role}
                                        onValueChange={(value) => handleRole(m.userId, value)}
                                    >
                                        <SelectTrigger className="w-44">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {ROLES.map((r) => (
                                                <SelectItem key={r.value} value={r.value}>
                                                    {r.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                {m.role !== "owner" && (
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleRemove(m.userId)}
                                        aria-label={`Remove ${m.email}`}
                                    >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                    {members !== undefined && members.length === 0 && (
                        <p className="text-sm text-muted-foreground">No team members yet.</p>
                    )}
                </div>

                {invitations && invitations.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Pending invitations
                        </div>
                        {invitations.map((i) => (
                            <div
                                key={i._id}
                                className="flex items-center justify-between rounded-lg border border-dashed p-3"
                            >
                                <span className="text-sm">{i.email}</span>
                                <Badge variant="secondary">{i.role}</Badge>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/* ────────────────────────────────────────────────────────────────────
 * Branches
 * ──────────────────────────────────────────────────────────────────── */

function BranchesPanel() {
    const branches = useQuery(api.branches.list, {});
    const create = useMutation(api.branches.create);
    const update = useMutation(api.branches.update);
    const remove = useMutation(api.branches.remove);
    const setDefault = useMutation(api.branches.setDefault);

    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [address, setAddress] = useState("");
    const [saving, setSaving] = useState(false);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await create({ name, code: code || undefined, address: address || undefined });
            toast.success("Branch added");
            setName("");
            setCode("");
            setAddress("");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-bold">Branches</CardTitle>
                <CardDescription>
                    The sales points of this business. Each one can hold its own stock.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-[2fr_1fr_2fr_auto] md:items-end">
                    <div className="space-y-2">
                        <Label htmlFor="branch-name">Name</Label>
                        <Input id="branch-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Kampala Main" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="branch-code">Code</Label>
                        <Input id="branch-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="KLA-001" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="branch-address">Address</Label>
                        <Input id="branch-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Kampala Central" />
                    </div>
                    <Button type="submit" disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        Add branch
                    </Button>
                </form>

                <div className="space-y-2">
                    {(branches ?? []).map((b) => (
                        <div key={b._id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 font-semibold">
                                    {b.name}
                                    {b.isDefault && <Badge variant="secondary">Default</Badge>}
                                    {!b.isActive && <Badge variant="outline">Inactive</Badge>}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {b.code ?? "—"} {b.address ? `• ${b.address}` : ""}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {!b.isDefault && (
                                    <Button size="sm" variant="outline" onClick={() => setDefault({ id: b._id })}>
                                        Make default
                                    </Button>
                                )}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={`Delete ${b.name}`}
                                    onClick={async () => {
                                        try {
                                            await remove({ id: b._id });
                                            toast.success("Branch deleted");
                                        } catch (err) {
                                            toast.error(formatError(err));
                                        }
                                    }}
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </div>
                    ))}
                    {branches !== undefined && branches.length === 0 && (
                        <p className="text-sm text-muted-foreground">No branches yet.</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

/* ────────────────────────────────────────────────────────────────────
 * Warehouses
 * ──────────────────────────────────────────────────────────────────── */

function WarehousesPanel() {
    const warehouses = useQuery(api.warehouses.list, {});
    const create = useMutation(api.warehouses.create);
    const remove = useMutation(api.warehouses.remove);
    const setDefault = useMutation(api.warehouses.setDefault);

    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [type, setType] = useState("main");
    const [saving, setSaving] = useState(false);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await create({ name, code: code || undefined, type });
            toast.success("Warehouse added");
            setName("");
            setCode("");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-bold">Warehouses</CardTitle>
                <CardDescription>Where this business keeps its stock.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
                    <div className="space-y-2">
                        <Label htmlFor="wh-name">Name</Label>
                        <Input id="wh-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Warehouse" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="wh-code">Code</Label>
                        <Input id="wh-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="WH-MAIN" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="wh-type">Type</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger id="wh-type">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="main">Main</SelectItem>
                                <SelectItem value="branch">Branch</SelectItem>
                                <SelectItem value="transit">Transit</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button type="submit" disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        Add warehouse
                    </Button>
                </form>

                <div className="space-y-2">
                    {(warehouses ?? []).map((w) => (
                        <div key={w._id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 font-semibold">
                                    {w.name}
                                    {w.isDefault && <Badge variant="secondary">Default</Badge>}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {w.code ?? "—"} • {w.type}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {!w.isDefault && (
                                    <Button size="sm" variant="outline" onClick={() => setDefault({ id: w._id })}>
                                        Make default
                                    </Button>
                                )}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={`Delete ${w.name}`}
                                    onClick={async () => {
                                        try {
                                            await remove({ id: w._id });
                                            toast.success("Warehouse deleted");
                                        } catch (err) {
                                            toast.error(formatError(err));
                                        }
                                    }}
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </div>
                    ))}
                    {warehouses !== undefined && warehouses.length === 0 && (
                        <p className="text-sm text-muted-foreground">No warehouses yet.</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

/* ────────────────────────────────────────────────────────────────────
 * Employees
 * ──────────────────────────────────────────────────────────────────── */

function EmployeesPanel() {
    const employees = useQuery(api.employees.list, {});
    const branches = useQuery(api.branches.list, {});
    const create = useMutation(api.employees.create);
    const remove = useMutation(api.employees.remove);

    const [fullName, setFullName] = useState("");
    const [jobTitle, setJobTitle] = useState("");
    const [phone, setPhone] = useState("");
    const [branchId, setBranchId] = useState<string>("");
    const [saving, setSaving] = useState(false);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            await create({
                fullName,
                jobTitle: jobTitle || undefined,
                phone: phone || undefined,
                branchId: (branchId || undefined) as any,
            });
            toast.success("Employee added");
            setFullName("");
            setJobTitle("");
            setPhone("");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-bold">Employees</CardTitle>
                <CardDescription>
                    The staff list of this business. An employee may or may not have a sign-in.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-end">
                    <div className="space-y-2">
                        <Label htmlFor="emp-name">Name</Label>
                        <Input id="emp-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="emp-title">Job title</Label>
                        <Input id="emp-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="emp-phone">Phone</Label>
                        <Input id="emp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="emp-branch">Branch</Label>
                        <Select value={branchId} onValueChange={setBranchId}>
                            <SelectTrigger id="emp-branch">
                                <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                                {(branches ?? []).map((b) => (
                                    <SelectItem key={b._id} value={b._id}>
                                        {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button type="submit" disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        Add
                    </Button>
                </form>

                <div className="space-y-2">
                    {(employees ?? []).map((emp) => (
                        <div key={emp._id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                            <div className="min-w-0">
                                <div className="font-semibold">{emp.fullName}</div>
                                <div className="text-xs text-muted-foreground">
                                    {emp.jobTitle ?? emp.role ?? "—"}
                                    {emp.employeeCode ? ` • ${emp.employeeCode}` : ""}
                                    {emp.email ? ` • ${emp.email}` : ""}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {emp.role && <Badge variant="secondary">{emp.role}</Badge>}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={`Delete ${emp.fullName}`}
                                    onClick={async () => {
                                        try {
                                            await remove({ id: emp._id });
                                            toast.success("Employee removed");
                                        } catch (err) {
                                            toast.error(formatError(err));
                                        }
                                    }}
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </div>
                    ))}
                    {employees !== undefined && employees.length === 0 && (
                        <p className="text-sm text-muted-foreground">No employees yet.</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

/* ────────────────────────────────────────────────────────────────────
 * Business profile
 * ──────────────────────────────────────────────────────────────────── */

function ProfilePanel() {
    const business = useQuery(api.businesses.getActive, {});
    const update = useMutation(api.businesses.updateSettings);
    const [saving, setSaving] = useState(false);

    if (!business) return null;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaving(true);
        const form = new FormData(e.currentTarget);
        try {
            await update({
                name: (form.get("name") as string) || undefined,
                currency: (form.get("currency") as string) || undefined,
                timezone: (form.get("timezone") as string) || undefined,
                country: (form.get("country") as string) || undefined,
                businessAddress: (form.get("businessAddress") as string) || undefined,
                businessPhone: (form.get("businessPhone") as string) || undefined,
                tin: (form.get("tin") as string) || undefined,
            });
            toast.success("Business settings saved");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-bold">Business settings</CardTitle>
                <CardDescription>
                    Money and time are set per business — a business in Kampala can bill in
                    shillings while another bills in dollars.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="name">Business name</Label>
                        <Input id="name" name="name" defaultValue={business.name} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="currency">Currency</Label>
                        <Select name="currency" defaultValue={business.currency ?? "UGX"}>
                            <SelectTrigger id="currency">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CURRENCIES.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {c}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="timezone">Timezone</Label>
                        <Select name="timezone" defaultValue={business.timezone ?? "Africa/Kampala"}>
                            <SelectTrigger id="timezone">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TIMEZONES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {t}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="country">Country</Label>
                        <Input id="country" name="country" defaultValue={business.country ?? "Uganda"} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="tin">Taxpayer number</Label>
                        <Input id="tin" name="tin" defaultValue={business.tin ?? ""} />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="businessAddress">Address</Label>
                        <Input id="businessAddress" name="businessAddress" defaultValue={business.businessAddress ?? ""} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="businessPhone">Phone</Label>
                        <Input id="businessPhone" name="businessPhone" defaultValue={business.businessPhone ?? ""} />
                    </div>
                    <div className="flex items-end justify-end md:col-span-2">
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save settings
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
