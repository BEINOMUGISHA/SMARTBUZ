"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    Search, Plus, Trash2, Edit, Loader2, User, Phone, Mail, MapPin, Package, Users, ChevronLeft, ChevronRight, X
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";

export default function CustomersPage() {
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(15);

    // Modal State
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<any>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Queries
    const customersResult = useQuery(api.customers.getPaginated, {
        limit: rowsPerPage,
        offset: (page - 1) * rowsPerPage,
        searchTerm: debouncedSearch || undefined
    });

    const packages = useQuery(api.packages.listAll);
    const packageMap = useMemo(() => {
        const m = new Map();
        packages?.forEach(p => m.set(p._id, p.name));
        return m;
    }, [packages]);

    // Mutations
    const addCustomer = useMutation(api.customers.add);
    const updateCustomer = useMutation(api.customers.update);
    const removeCustomer = useMutation(api.customers.remove);

    // Effects
    useEffect(() => {
        const saved = localStorage.getItem("pos_customers_rows_per_page");
        if (saved) setRowsPerPage(Number(saved));
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    // Derived
    const customers = customersResult?.page || [];
    const totalCount = customersResult?.totalCount || 0;
    const totalPages = Math.ceil(totalCount / rowsPerPage);

    // Handlers
    const handleAddEdit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        const formData = new FormData(e.currentTarget);

        const data = {
            name: formData.get("name") as string,
            phone: formData.get("phone") as string,
            email: (formData.get("email") as string) || undefined,
            distributorId: (formData.get("distributorId") as string) || undefined,
            address: (formData.get("address") as string) || undefined,
            packageId: (formData.get("packageId") as string) || undefined,
        };

        try {
            if (editingCustomer) {
                await updateCustomer({
                    id: editingCustomer._id,
                    ...data,
                    packageId: data.packageId as Id<"packages">
                });
                toast.success("Customer updated");
            } else {
                await addCustomer({
                    ...data,
                    packageId: data.packageId as Id<"packages">
                });
                toast.success("Customer added");
            }
            setIsAddOpen(false);
            setEditingCustomer(null);
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: Id<"customers">) => {
        if (!confirm("Are you sure you want to delete this customer? This action cannot be undone.")) return;
        try {
            await removeCustomer({ id });
            toast.success("Customer deleted");
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    const openEdit = (customer: any) => {
        setEditingCustomer(customer);
        setIsAddOpen(true);
    };

    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-3xl font-black tracking-tight">Customers & Distributors</h1>
                    <p className="text-muted-foreground">Manage your client base and individual distributor memberships.</p>
                </div>
                <Button onClick={() => setIsAddOpen(true)} className="font-bold shadow-lg hover:shadow-xl transition-all">
                    <Plus className="mr-2 h-5 w-5" /> Add Customer
                </Button>
            </div>

            {/* Main Stats Summary (Optional/Premium feel) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-linear-to-br from-blue-50 to-white border-blue-100 shadow-sm">
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-100 rounded-xl">
                                <Users className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-blue-600 uppercase tracking-wider">Total Base</p>
                                <p className="text-3xl font-black">{totalCount}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                {/* Add more stats if needed, like "Active Distributors", etc. */}
            </div>

            {/* Filter Bar */}
            <div className="relative group">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                    placeholder="Search by name, phone, or distributor ID..."
                    className="pl-10 h-12 bg-card shadow-sm border-muted-foreground/20 focus-visible:ring-primary/20"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {/* Content Table */}
            <div className="flex-1 overflow-hidden border rounded-2xl bg-card shadow-xl flex flex-col">
                <div className="flex-1 overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-muted/30 sticky top-0 z-10">
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="w-[250px] font-bold py-4">Customer Info</TableHead>
                                <TableHead className="font-bold">Contact Details</TableHead>
                                <TableHead className="font-bold">Member Details</TableHead>
                                <TableHead className="font-bold">Address</TableHead>
                                <TableHead className="text-right font-bold pr-6">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {customersResult === undefined ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-64 text-center">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                            <p className="text-sm text-muted-foreground font-medium">Fetching client list...</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : customers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-64 text-center">
                                        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground opacity-50">
                                            <Search className="h-12 w-12 mb-2" />
                                            <p className="text-lg font-bold">No customers found</p>
                                            <p className="text-sm">Try adjusting your search criteria or add a new customer.</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                customers.map((c) => (
                                    <TableRow key={c._id} className="group hover:bg-muted/30 transition-colors">
                                        <TableCell className="py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                                                    {c.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm">{c.name}</div>
                                                    {c.distributorId && (
                                                        <Badge variant="outline" className="text-[10px] uppercase font-black bg-blue-50 text-blue-700 border-blue-200">
                                                            {c.distributorId}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center text-xs font-medium">
                                                    <Phone className="h-3 w-3 mr-2 text-muted-foreground" />
                                                    {c.phone}
                                                </div>
                                                {c.email && (
                                                    <div className="flex items-center text-xs text-muted-foreground">
                                                        <Mail className="h-3 w-3 mr-2" />
                                                        {c.email}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {c.packageId ? (
                                                <div className="flex items-center gap-2">
                                                    <Package className="h-4 w-4 text-orange-500" />
                                                    <span className="text-xs font-bold text-orange-700">
                                                        {packageMap.get(c.packageId) || "Loading..."}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-muted-foreground font-medium italic">Retail Client</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-start gap-2 max-w-[200px]">
                                                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                                <span className="text-xs text-muted-foreground line-clamp-2">
                                                    {c.address || "No address provided"}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-primary hover:bg-primary/10"
                                                    onClick={() => openEdit(c)}
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                                    onClick={() => handleDelete(c._id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Footer / Pagination */}
                <div className="flex flex-col sm:flex-row items-center justify-between border-t bg-muted/20 px-6 py-4 gap-4">
                    <div className="flex items-center space-x-2">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Rows</Label>
                        <Select
                            value={`${rowsPerPage}`}
                            onValueChange={(v) => {
                                const val = Number(v);
                                setRowsPerPage(val);
                                localStorage.setItem("pos_customers_rows_per_page", String(val));
                                setPage(1);
                            }}
                        >
                            <SelectTrigger className="h-8 w-[70px] bg-background">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent side="top">
                                {[10, 15, 20, 30, 50, 100].map(sz => (
                                    <SelectItem key={sz} value={`${sz}`}>{sz}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="text-xs font-bold text-muted-foreground">
                            {Math.min((page - 1) * rowsPerPage + 1, totalCount)}-{Math.min(page * rowsPerPage, totalCount)} OF {totalCount}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                disabled={page === 1}
                                onClick={() => setPage(p => p - 1)}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                disabled={page >= totalPages || totalCount === 0}
                                onClick={() => setPage(p => p + 1)}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Add/Edit Dialog */}
            <Dialog open={isAddOpen} onOpenChange={(o) => {
                if (!o) {
                    setIsAddOpen(false);
                    setEditingCustomer(null);
                }
            }}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black">{editingCustomer ? "Edit Customer" : "Add New Customer"}</DialogTitle>
                        <DialogDescription>
                            Enter the details of the customer or distributor. All membership fields are optional for retail clients.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleAddEdit} className="space-y-4 pt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="name" className="text-xs font-bold uppercase text-muted-foreground">Full Name</Label>
                                <Input id="name" name="name" defaultValue={editingCustomer?.name} required placeholder="e.g. John Doe" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="phone" className="text-xs font-bold uppercase text-muted-foreground">Phone Number</Label>
                                <Input id="phone" name="phone" defaultValue={editingCustomer?.phone} required placeholder="e.g. +256..." />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="email" className="text-xs font-bold uppercase text-muted-foreground">Email (Optional)</Label>
                                <Input id="email" name="email" type="email" defaultValue={editingCustomer?.email} placeholder="john@example.com" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="distributorId" className="text-xs font-bold uppercase text-muted-foreground">Distributor ID</Label>
                                <Input id="distributorId" name="distributorId" defaultValue={editingCustomer?.distributorId} placeholder="e.g. DIST-101" />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="packageId" className="text-xs font-bold uppercase text-muted-foreground">Package / Membership</Label>
                            <Select name="packageId" defaultValue={editingCustomer?.packageId || "none"}>
                                <SelectTrigger className="bg-background">
                                    <SelectValue placeholder="Select a package..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">None (Retail Client)</SelectItem>
                                    {packages?.map(p => (
                                        <SelectItem key={p._id} value={p._id}>{p.name} - {p.pv} PV</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="address" className="text-xs font-bold uppercase text-muted-foreground">Physical Address</Label>
                            <Input id="address" name="address" defaultValue={editingCustomer?.address} placeholder="Street, City, Country" />
                        </div>

                        <DialogFooter className="pt-6">
                            <Button type="button" variant="ghost" onClick={() => setIsAddOpen(false)} className="font-bold">Cancel</Button>
                            <Button type="submit" disabled={isSubmitting} className="font-bold min-w-[120px]">
                                {isSubmitting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : editingCustomer ? "Save Changes" : "Add Customer"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
