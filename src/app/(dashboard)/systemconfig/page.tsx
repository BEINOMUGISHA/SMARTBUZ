"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Search, Edit, Trash2, MoreHorizontal, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatError, cn } from "@/lib/utils";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SystemConfigPage() {
    const [activeTab, setActiveTab] = useState("users");

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4">
                <h1 className="text-3xl font-black tracking-tight text-foreground">System Configuration</h1>
                <p className="text-muted-foreground">Manage global system settings, users, and product configurations.</p>
            </div>

            <Tabs defaultValue="users" value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 lg:w-[600px] h-auto p-1 bg-muted/50 border shadow-sm">
                    <TabsTrigger value="users" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Users</TabsTrigger>
                    <TabsTrigger value="packages" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Packages</TabsTrigger>
                    <TabsTrigger value="distributors" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Distributors</TabsTrigger>
                    <TabsTrigger value="shops" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Shops</TabsTrigger>
                </TabsList>

                <TabsContent value="users" className="mt-6">
                    <UserManager />
                </TabsContent>
                <TabsContent value="packages" className="mt-6">
                    <PackageManager />
                </TabsContent>
                <TabsContent value="distributors" className="mt-6">
                    <DistributorManager />
                </TabsContent>
                <TabsContent value="shops" className="mt-6">
                    <ShopManager />
                </TabsContent>
            </Tabs>
        </div>
    );
}

// --- Shared Pagination Component ---
function PaginationControls({
    currentPage,
    totalPages,
    rowsPerPage,
    setRowsPerPage,
    setCurrentPage,
    startIndex,
    endIndex,
    totalItems
}: any) {
    return (
        <div className="flex flex-col sm:flex-row items-center justify-between border-t bg-muted/20 px-4 py-4 gap-4">
            <div className="flex items-center space-x-2">
                <p className="text-sm font-medium">Rows per page</p>
                <Select
                    value={`${rowsPerPage}`}
                    onValueChange={(value) => {
                        setRowsPerPage(Number(value));
                        setCurrentPage(1);
                    }}
                >
                    <SelectTrigger className="h-8 w-[70px]">
                        <SelectValue placeholder={rowsPerPage} />
                    </SelectTrigger>
                    <SelectContent side="top">
                        {[5, 10, 20, 30, 50, 100].map((pageSize) => (
                            <SelectItem key={pageSize} value={`${pageSize}`}>
                                {pageSize}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="flex items-center gap-4">
                <div className="text-sm font-medium">
                    Page {currentPage} of {totalPages || 1}
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                    >
                        <span className="sr-only">Go to first page</span>
                        <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage((p: number) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                    >
                        <span className="sr-only">Go to previous page</span>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage((p: number) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages || totalPages === 0}
                    >
                        <span className="sr-only">Go to next page</span>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages || totalPages === 0}
                    >
                        <span className="sr-only">Go to last page</span>
                        <ChevronsRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

// --- USER MANAGER ---
function UserManager() {
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Doc<"users"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"users"> | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const users = useQuery(api.users.listAll);
    const createUser = useMutation(api.users.create);
    const updateUser = useMutation(api.users.update);
    const deleteUser = useMutation(api.users.remove);

    const filteredItems = users?.filter(u =>
        u.first_name.toLowerCase().includes(search.toLowerCase()) ||
        u.last_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
    ) || [];

    const totalItems = filteredItems.length;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentItems = filteredItems.slice(startIndex, endIndex);

    const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        try {
            await createUser({
                first_name: formData.get("first_name") as string,
                last_name: formData.get("last_name") as string,
                email: formData.get("email") as string,
                roles: [formData.get("role") as string], // Selected role
                password: "password123", // Default password
            });
            toast.success("User created successfully");
            setIsAddOpen(false);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!editingItem) return;
        const formData = new FormData(e.currentTarget);
        try {
            await updateUser({
                id: editingItem._id,
                first_name: formData.get("first_name") as string,
                last_name: formData.get("last_name") as string,
                email: formData.get("email") as string,
                phone_number: formData.get("phone_number") as string,
                roles: [formData.get("role") as string],
            });
            toast.success("User updated");
            setEditingItem(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deleteUser({ id: deletingId });
            toast.success("User deleted");
            setDeletingId(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>Manage system users and their access.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-4 space-y-4">
                    <ConfirmDeleteModal isOpen={!!deletingId} onClose={() => setDeletingId(null)} onConfirm={handleDelete} title="Delete User?" />

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border w-full sm:max-w-sm">
                            <Search className="h-4 w-4 text-muted-foreground ml-2" />
                            <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="border-0 bg-transparent h-8 focus-visible:ring-0 w-full" />
                        </div>
                        <Button onClick={() => setIsAddOpen(true)} className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4" /> Add User</Button>
                    </div>

                    <div className="rounded-md border overflow-x-auto">
                        <div className="min-w-[800px] lg:min-w-0">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>User</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Roles</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {!users ? (
                                        <TableRow><TableCell colSpan={4} className="h-24 text-center"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                                    ) : currentItems.map((user) => (
                                        <TableRow key={user._id}>
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                                                        {user.first_name[0]}{user.last_name[0]}
                                                    </div>
                                                    {user.first_name} {user.last_name}
                                                </div>
                                            </TableCell>
                                            <TableCell>{user.email}</TableCell>
                                            <TableCell>
                                                <div className="flex gap-1">
                                                    {user.roles.map(r => (
                                                        <Badge
                                                            key={r}
                                                            variant={r === "admin" ? "default" : "secondary"}
                                                            className={cn(
                                                                "text-[10px] uppercase tracking-wider font-bold px-2 py-0.5",
                                                                r === "admin" ? "bg-primary" : "bg-orange-400 text-white"
                                                            )}
                                                        >
                                                            {r}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => setEditingItem(user)}><Edit className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(user._id)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <PaginationControls currentPage={currentPage} totalPages={totalPages} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} setCurrentPage={setCurrentPage} startIndex={startIndex} endIndex={endIndex} totalItems={totalItems} />
                    </div>
                </div>
            </CardContent>

            {/* User Dialogs */}
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>First Name</Label><Input name="first_name" required /></div>
                            <div className="space-y-2"><Label>Last Name</Label><Input name="last_name" required /></div>
                        </div>
                        <div className="space-y-2"><Label>Email</Label><Input name="email" type="email" required /></div>
                        <div className="space-y-2">
                            <Label>System Role</Label>
                            <Select name="role" defaultValue="sales" required>
                                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="admin">System Admin (All Access)</SelectItem>
                                    <SelectItem value="sales">Sales Agent (Shop Limited)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter><Button type="submit">Create User</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
                    {editingItem && (
                        <form onSubmit={handleUpdate} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2"><Label>First Name</Label><Input name="first_name" defaultValue={editingItem.first_name} required /></div>
                                <div className="space-y-2"><Label>Last Name</Label><Input name="last_name" defaultValue={editingItem.last_name} required /></div>
                            </div>
                            <div className="space-y-2"><Label>Email</Label><Input name="email" defaultValue={editingItem.email} required /></div>
                            <div className="space-y-2"><Label>Phone</Label><Input name="phone_number" defaultValue={editingItem.phone_number} /></div>
                            <div className="space-y-2">
                                <Label>System Role</Label>
                                <Select name="role" defaultValue={editingItem.roles[0] || "sales"} required>
                                    <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">System Admin (All Access)</SelectItem>
                                        <SelectItem value="sales">Sales Agent (Shop Limited)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter><Button type="submit">Save Changes</Button></DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </Card>
    );
}

// --- PACKAGE MANAGER ---
function PackageManager() {
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Doc<"packages"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"packages"> | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const packages = useQuery(api.packages.listAll);
    const createPackage = useMutation(api.packages.add);
    const updatePackage = useMutation(api.packages.update);
    const deletePackage = useMutation(api.packages.remove);

    const filteredItems = packages?.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase())
    ) || [];

    const totalItems = filteredItems.length;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentItems = filteredItems.slice(startIndex, endIndex);

    const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        try {
            await createPackage({
                name: formData.get("name") as string,
                amount: Number(formData.get("amount")),
                bv: Number(formData.get("bv")),
                pv: Number(formData.get("pv")),
                registrationFee: Number(formData.get("registrationFee")),
                isPaid: formData.get("isPaid") === "on",
            });
            toast.success("Package created");
            setIsAddOpen(false);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!editingItem) return;
        const formData = new FormData(e.currentTarget);
        try {
            await updatePackage({
                id: editingItem._id,
                name: formData.get("name") as string,
                amount: Number(formData.get("amount")),
                bv: Number(formData.get("bv")),
                pv: Number(formData.get("pv")),
                registrationFee: Number(formData.get("registrationFee")),
                isPaid: formData.get("isPaid") === "on",
            });
            toast.success("Package updated");
            setEditingItem(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deletePackage({ id: deletingId });
            toast.success("Package deleted");
            setDeletingId(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Package Management</CardTitle>
                <CardDescription>Setup product packages and pricing.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-4 space-y-4">
                    <ConfirmDeleteModal isOpen={!!deletingId} onClose={() => setDeletingId(null)} onConfirm={handleDelete} title="Delete Package?" />

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border w-full sm:max-w-sm">
                            <Search className="h-4 w-4 text-muted-foreground ml-2" />
                            <Input placeholder="Search packages..." value={search} onChange={(e) => setSearch(e.target.value)} className="border-0 bg-transparent h-8 focus-visible:ring-0 w-full" />
                        </div>
                        <Button onClick={() => setIsAddOpen(true)} className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4" /> Add Package</Button>
                    </div>

                    <div className="rounded-md border overflow-x-auto">
                        <div className="min-w-[800px] lg:min-w-0">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>Package Name</TableHead>
                                        <TableHead className="text-right">Amount (UGX)</TableHead>
                                        <TableHead className="text-center">PV</TableHead>
                                        <TableHead className="text-center">BV</TableHead>
                                        <TableHead className="text-center">Paid</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {!packages ? <TableRow><TableCell colSpan={6}><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow> : currentItems.map((pkg) => (
                                        <TableRow key={pkg._id}>
                                            <TableCell className="font-medium">{pkg.name}</TableCell>
                                            <TableCell className="text-right font-bold">{pkg.amount.toLocaleString()}</TableCell>
                                            <TableCell className="text-center text-xs text-muted-foreground">{pkg.pv}</TableCell>
                                            <TableCell className="text-center text-xs text-muted-foreground">{pkg.bv}</TableCell>
                                            <TableCell className="text-center">
                                                {pkg.isPaid ? <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Yes</Badge> : <Badge variant="outline">No</Badge>}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => setEditingItem(pkg)}><Edit className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(pkg._id)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <PaginationControls currentPage={currentPage} totalPages={totalPages} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} setCurrentPage={setCurrentPage} startIndex={startIndex} endIndex={endIndex} totalItems={totalItems} />
                    </div>
                </div>
            </CardContent>

            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Add Package</DialogTitle></DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="space-y-2"><Label>Package Name</Label><Input name="name" required /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Amount</Label><Input name="amount" type="number" required /></div>
                            <div className="space-y-2"><Label>Reg Fee</Label><Input name="registrationFee" type="number" required /></div>
                            <div className="space-y-2"><Label>PV</Label><Input name="pv" type="number" required /></div>
                            <div className="space-y-2"><Label>BV</Label><Input name="bv" type="number" required /></div>
                        </div>
                        <div className="flex items-center space-x-2"><Switch name="isPaid" /><Label>Is Paid?</Label></div>
                        <DialogFooter><Button type="submit">Create</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Edit Package</DialogTitle></DialogHeader>
                    {editingItem && (
                        <form onSubmit={handleUpdate} className="space-y-4">
                            <div className="space-y-2"><Label>Package Name</Label><Input name="name" defaultValue={editingItem.name} required /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2"><Label>Amount</Label><Input name="amount" type="number" defaultValue={editingItem.amount} required /></div>
                                <div className="space-y-2"><Label>Reg Fee</Label><Input name="registrationFee" type="number" defaultValue={editingItem.registrationFee} required /></div>
                                <div className="space-y-2"><Label>PV</Label><Input name="pv" type="number" defaultValue={editingItem.pv} required /></div>
                                <div className="space-y-2"><Label>BV</Label><Input name="bv" type="number" defaultValue={editingItem.bv} required /></div>
                            </div>
                            <div className="flex items-center space-x-2"><Switch name="isPaid" defaultChecked={editingItem.isPaid} /><Label>Is Paid?</Label></div>
                            <DialogFooter><Button type="submit">Update</Button></DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </Card>
    );
}

// --- DISTRIBUTOR MANAGER ---
function DistributorManager() {
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Doc<"customers"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"customers"> | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const distributors = useQuery(api.customers.listAll);
    const packages = useQuery(api.packages.listAll);
    const createDistributor = useMutation(api.customers.add);
    const updateDistributor = useMutation(api.customers.update);
    const deleteDistributor = useMutation(api.customers.remove);

    const filteredItems = distributors?.filter(d =>
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.phone.includes(search)
    ) || [];

    const totalItems = filteredItems.length;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentItems = filteredItems.slice(startIndex, endIndex);

    const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        try {
            await createDistributor({
                name: formData.get("name") as string,
                phone: formData.get("phone") as string,
                email: formData.get("email") as string,
                distributorId: formData.get("distributorId") as string,
                address: formData.get("address") as string,
                packageId: formData.get("packageId") as Id<"packages"> || undefined,
            });
            toast.success("Distributor added");
            setIsAddOpen(false);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!editingItem) return;
        const formData = new FormData(e.currentTarget);
        try {
            await updateDistributor({
                id: editingItem._id,
                name: formData.get("name") as string,
                phone: formData.get("phone") as string,
                email: formData.get("email") as string,
                distributorId: formData.get("distributorId") as string,
                address: formData.get("address") as string,
                packageId: formData.get("packageId") as Id<"packages"> || undefined,
            });
            toast.success("Distributor updated");
            setEditingItem(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deleteDistributor({ id: deletingId });
            toast.success("Distributor deleted");
            setDeletingId(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Distributor Management</CardTitle>
                <CardDescription>Manage your customer and distributor base.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-4 space-y-4">
                    <ConfirmDeleteModal isOpen={!!deletingId} onClose={() => setDeletingId(null)} onConfirm={handleDelete} title="Delete Distributor?" />

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border w-full sm:max-w-sm">
                            <Search className="h-4 w-4 text-muted-foreground ml-2" />
                            <Input placeholder="Search name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} className="border-0 bg-transparent h-8 focus-visible:ring-0 w-full" />
                        </div>
                        <Button onClick={() => setIsAddOpen(true)} className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4" /> Add Distributor</Button>
                    </div>

                    <div className="rounded-md border overflow-x-auto">
                        <div className="min-w-[800px] lg:min-w-0">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>ID NO</TableHead>
                                        <TableHead>Contact</TableHead>
                                        <TableHead>Package</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {!distributors ? <TableRow><TableCell colSpan={4}><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow> : currentItems.map((dist) => (
                                        <TableRow key={dist._id}>
                                            <TableCell className="font-medium">{dist.name}</TableCell>
                                            <TableCell className="font-mono text-xs">{dist.distributorId || "-"}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col text-sm">
                                                    <span>{dist.phone}</span>
                                                    <span className="text-muted-foreground text-xs">{dist.email}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="font-normal">
                                                    {packages?.find(p => p._id === dist.packageId)?.name || "—"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => setEditingItem(dist)}><Edit className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(dist._id)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <PaginationControls currentPage={currentPage} totalPages={totalPages} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} setCurrentPage={setCurrentPage} startIndex={startIndex} endIndex={endIndex} totalItems={totalItems} />
                    </div>
                </div>
            </CardContent>

            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Add Distributor</DialogTitle></DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="space-y-2"><Label>Name</Label><Input name="name" required /></div>
                        <div className="space-y-2"><Label>Distributor ID</Label><Input name="distributorId" placeholder="Optional" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Phone</Label><Input name="phone" required /></div>
                            <div className="space-y-2"><Label>Email</Label><Input name="email" type="email" /></div>
                        </div>
                        <div className="space-y-2"><Label>Address</Label><Input name="address" /></div>
                        <div className="space-y-2">
                            <Label>Package</Label>
                            <Select name="packageId">
                                <SelectTrigger><SelectValue placeholder="Select package" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {packages?.map(p => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter><Button type="submit">Create</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Edit Distributor</DialogTitle></DialogHeader>
                    {editingItem && (
                        <form onSubmit={handleUpdate} className="space-y-4">
                            <div className="space-y-2"><Label>Name</Label><Input name="name" defaultValue={editingItem.name} required /></div>
                            <div className="space-y-2"><Label>Distributor ID</Label><Input name="distributorId" defaultValue={editingItem.distributorId} /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2"><Label>Phone</Label><Input name="phone" defaultValue={editingItem.phone} required /></div>
                                <div className="space-y-2"><Label>Email</Label><Input name="email" defaultValue={editingItem.email} type="email" /></div>
                            </div>
                            <div className="space-y-2"><Label>Address</Label><Input name="address" defaultValue={editingItem.address} /></div>
                            <div className="space-y-2">
                                <Label>Package</Label>
                                <Select name="packageId" defaultValue={editingItem.packageId || "none"}>
                                    <SelectTrigger><SelectValue placeholder="Select package" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        {packages?.map(p => <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter><Button type="submit">Update</Button></DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </Card>
    )
}

// --- SHOP MANAGER ---
function ShopManager() {
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Doc<"shops"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"shops"> | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const shops = useQuery(api.shops.listAll);
    const users = useQuery(api.users.listAll);
    const createShop = useMutation(api.shops.create);
    const updateShop = useMutation(api.shops.update);
    const deleteShop = useMutation(api.shops.remove);

    const filteredItems = shops?.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.location.toLowerCase().includes(search.toLowerCase())
    ) || [];

    const totalItems = filteredItems.length;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentItems = filteredItems.slice(startIndex, endIndex);

    const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        try {
            await createShop({
                name: formData.get("name") as string,
                serialNumber: formData.get("serialNumber") as string,
                location: formData.get("location") as string,
                contact: formData.get("contact") as string,
                userId: formData.get("userId") as Id<"users">,
            });
            toast.success("Shop created");
            setIsAddOpen(false);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!editingItem) return;
        const formData = new FormData(e.currentTarget);
        try {
            await updateShop({
                id: editingItem._id,
                name: formData.get("name") as string,
                serialNumber: formData.get("serialNumber") as string,
                location: formData.get("location") as string,
                contact: formData.get("contact") as string,
                userId: formData.get("userId") as Id<"users">,
            });
            toast.success("Shop updated");
            setEditingItem(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deleteShop({ id: deletingId });
            toast.success("Shop deleted");
            setDeletingId(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Shops & Branches</CardTitle>
                <CardDescription>Manage shop locations and managers.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-4 space-y-4">
                    <ConfirmDeleteModal isOpen={!!deletingId} onClose={() => setDeletingId(null)} onConfirm={handleDelete} title="Delete Shop?" />

                    <div className="flex justify-between items-center gap-4">
                        <div className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border w-full max-w-sm">
                            <Search className="h-4 w-4 text-muted-foreground ml-2" />
                            <Input placeholder="Search shops..." value={search} onChange={(e) => setSearch(e.target.value)} className="border-0 bg-transparent h-8 focus-visible:ring-0" />
                        </div>
                        <Button onClick={() => setIsAddOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add Shop</Button>
                    </div>

                    <div className="rounded-md border">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>Shop Name</TableHead>
                                    <TableHead>Location</TableHead>
                                    <TableHead>Manager</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {!shops ? <TableRow><TableCell colSpan={4}><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow> : currentItems.map((shop) => (
                                    <TableRow key={shop._id}>
                                        <TableCell className="font-medium">
                                            <div>{shop.name}</div>
                                            <div className="text-xs text-muted-foreground">{shop.serialNumber}</div>
                                        </TableCell>
                                        <TableCell>{shop.location}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-normal">
                                                {(() => {
                                                    const u = users?.find(u => u._id === shop.userId);
                                                    return u ? `${u.first_name} ${u.last_name}` : "Unknown";
                                                })()}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => setEditingItem(shop)}><Edit className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                                                    <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(shop._id)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <PaginationControls currentPage={currentPage} totalPages={totalPages} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} setCurrentPage={setCurrentPage} startIndex={startIndex} endIndex={endIndex} totalItems={totalItems} />
                </div>
            </CardContent>

            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Add Shop</DialogTitle></DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="space-y-2"><Label>Shop Name</Label><Input name="name" required /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2"><Label>Serial Number</Label><Input name="serialNumber" required /></div>
                            <div className="space-y-2"><Label>Contact</Label><Input name="contact" required /></div>
                        </div>
                        <div className="space-y-2"><Label>Location</Label><Input name="location" required /></div>
                        <div className="space-y-2">
                            <Label>Manager (User)</Label>
                            <Select name="userId" required>
                                <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                                <SelectContent>
                                    {users?.map(u => <SelectItem key={u._id} value={u._id}>{u.first_name} {u.last_name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter><Button type="submit">Create</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Edit Shop</DialogTitle></DialogHeader>
                    {editingItem && (
                        <form onSubmit={handleUpdate} className="space-y-4">
                            <div className="space-y-2"><Label>Shop Name</Label><Input name="name" defaultValue={editingItem.name} required /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2"><Label>Serial Number</Label><Input name="serialNumber" defaultValue={editingItem.serialNumber} required /></div>
                                <div className="space-y-2"><Label>Contact</Label><Input name="contact" defaultValue={editingItem.contact} required /></div>
                            </div>
                            <div className="space-y-2"><Label>Location</Label><Input name="location" defaultValue={editingItem.location} required /></div>
                            <div className="space-y-2">
                                <Label>Manager (User)</Label>
                                <Select name="userId" defaultValue={editingItem.userId} required>
                                    <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                                    <SelectContent>
                                        {users?.map(u => <SelectItem key={u._id} value={u._id}>{u.first_name} {u.last_name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <DialogFooter><Button type="submit">Update</Button></DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </Card>
    );
}

