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
import { Plus, Search, Edit, Trash2, MoreHorizontal, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Minus } from "lucide-react";
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
import { AuditLogsManager } from "./audit-logs";
import { useAuth } from "@/context/auth-context";

export default function SystemConfigPage() {
    const [activeTab, setActiveTab] = useState("users");

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4">
                <h1 className="text-3xl font-black tracking-tight text-foreground">System Configuration</h1>
                <p className="text-muted-foreground">Manage global system settings, users, and product configurations.</p>
            </div>

            <Tabs defaultValue="users" value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-6 lg:w-[720px] h-auto p-1 bg-muted/50 border shadow-sm">
                    <TabsTrigger value="business" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Business</TabsTrigger>
                    <TabsTrigger value="users" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Users</TabsTrigger>
                    <TabsTrigger value="promotions" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Promotions</TabsTrigger>
                    <TabsTrigger value="distributors" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Distributors</TabsTrigger>
                    <TabsTrigger value="shops" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Shops</TabsTrigger>
                    <TabsTrigger value="audit" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Audit Logs</TabsTrigger>
                </TabsList>

                <TabsContent value="business" className="mt-6">
                    <BusinessProfileManager />
                </TabsContent>
                <TabsContent value="users" className="mt-6">
                    <UserManager />
                </TabsContent>
                <TabsContent value="promotions" className="mt-6">
                    <PromotionManager />
                </TabsContent>
                <TabsContent value="distributors" className="mt-6">
                    <DistributorManager />
                </TabsContent>
                <TabsContent value="shops" className="mt-6">
                    <ShopManager />
                </TabsContent>
                <TabsContent value="audit" className="mt-6">
                    <AuditLogsManager />
                </TabsContent>
            </Tabs>
        </div>
    );
}

// --- Shared Pagination Component ---
export function PaginationControls({
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

function BusinessProfileManager() {
    const { user } = useAuth();
    const currentProfile = useQuery((api as any).businessProfiles.getActive, {});
    const businessProfiles = useQuery((api as any).businessProfiles.list, {});
    const createProfile = useMutation((api as any).businessProfiles.create);
    const updateProfile = useMutation((api as any).businessProfiles.update);

    const [businessName, setBusinessName] = useState("SMART_BUZ");
    const [businessType, setBusinessType] = useState("Retail");
    const [industry, setIndustry] = useState("Retail");
    const [currency, setCurrency] = useState("UGX");
    const [country, setCountry] = useState("Uganda");
    const [taxEnabled, setTaxEnabled] = useState(false);
    const [selectedModules, setSelectedModules] = useState<string[]>([
        "sales",
        "inventory",
        "customers",
        "reports",
    ]);

    const moduleOptions = [
        "sales",
        "inventory",
        "customers",
        "reports",
        "payments",
        "loans",
        "promotions",
        "bookings",
        "appointments",
        "projects",
        "inventory-tracking",
        "crm",
    ];

    const businessTypeOptions = [
        "Retail",
        "Hospitality",
        "Travel",
        "Salon & Wellness",
        "Education",
        "Healthcare",
        "Real Estate",
        "Construction",
        "Automotive",
        "Logistics",
        "Professional Services",
        "General Business",
    ];

    const industryOptions = [
        "Retail",
        "Restaurant",
        "Hotel",
        "Travel Agency",
        "Salon",
        "School",
        "Clinic",
        "Pharmacy",
        "Construction",
        "Garage",
        "Transport",
        "Agency",
        "Manufacturing",
        "Fashion",
        "Agriculture",
        "Other",
    ];

    const toggleModule = (moduleName: string) => {
        setSelectedModules((current) =>
            current.includes(moduleName)
                ? current.filter((item) => item !== moduleName)
                : [...current, moduleName]
        );
    };

    const loadProfile = (profile: any) => {
        if (!profile) return;
        setBusinessName(profile.businessName || "SMART_BUZ");
        setBusinessType(profile.businessType || "Retail");
        setIndustry(profile.industry || "Retail");
        setCurrency(profile.currency || "UGX");
        setCountry(profile.country || "Uganda");
        setTaxEnabled(Boolean(profile.taxEnabled));
        setSelectedModules(Array.isArray(profile.modules) ? profile.modules : []);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!user) {
            toast.error("You must be logged in to configure business settings.");
            return;
        }

        try {
            if (currentProfile) {
                await updateProfile({
                    id: currentProfile._id,
                    businessName,
                    businessType,
                    industry,
                    modules: selectedModules,
                    currency,
                    country,
                    taxEnabled,
                    updatedBy: user._id,
                });
                toast.success("Business profile updated");
            } else {
                await createProfile({
                    businessName,
                    businessType,
                    industry,
                    modules: selectedModules,
                    currency,
                    country,
                    taxEnabled,
                    createdBy: user._id,
                });
                toast.success("Business profile created");
            }
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Business Profile Configuration</CardTitle>
                <CardDescription>Configure the system for the business type and modules you need.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Business Name</Label>
                                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="SMART_BUZ" required />
                            </div>
                            <div className="space-y-2">
                                <Label>Business Type</Label>
                                <Select value={businessType} onValueChange={setBusinessType}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select business type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {businessTypeOptions.map((type) => (
                                            <SelectItem key={type} value={type}>{type}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Industry</Label>
                                <Select value={industry} onValueChange={setIndustry}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select industry" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {industryOptions.map((option) => (
                                            <SelectItem key={option} value={option}>{option}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Currency</Label>
                                <Select value={currency} onValueChange={setCurrency}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Currency" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="UGX">UGX</SelectItem>
                                        <SelectItem value="USD">USD</SelectItem>
                                        <SelectItem value="KES">KES</SelectItem>
                                        <SelectItem value="TZS">TZS</SelectItem>
                                        <SelectItem value="RWF">RWF</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Country</Label>
                                <Select value={country} onValueChange={setCountry}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Country" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Uganda">Uganda</SelectItem>
                                        <SelectItem value="Kenya">Kenya</SelectItem>
                                        <SelectItem value="Tanzania">Tanzania</SelectItem>
                                        <SelectItem value="Rwanda">Rwanda</SelectItem>
                                        <SelectItem value="Global">Global</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2 flex items-center justify-start pt-8">
                                <div className="flex items-center space-x-2">
                                    <Switch checked={taxEnabled} onCheckedChange={setTaxEnabled} />
                                    <Label>Tax enabled</Label>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Label className="text-sm font-semibold">Enabled Modules</Label>
                            <div className="flex flex-wrap gap-2">
                                {moduleOptions.map((moduleName) => {
                                    const selected = selectedModules.includes(moduleName);
                                    return (
                                        <Button
                                            type="button"
                                            key={moduleName}
                                            variant={selected ? "default" : "outline"}
                                            className="rounded-full capitalize"
                                            onClick={() => toggleModule(moduleName)}
                                        >
                                            {moduleName}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <Button type="submit">{currentProfile ? "Save profile" : "Create profile"}</Button>
                            {currentProfile && (
                                <Button type="button" variant="outline" onClick={() => loadProfile(currentProfile)}>Reset</Button>
                            )}
                        </div>
                    </form>

                    <Card className="bg-muted/20">
                        <CardHeader>
                            <CardTitle className="text-base">Current profile</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            {currentProfile ? (
                                <>
                                    <div><strong>Name:</strong> {currentProfile.businessName}</div>
                                    <div><strong>Type:</strong> {currentProfile.businessType}</div>
                                    <div><strong>Industry:</strong> {currentProfile.industry || "General"}</div>
                                    <div><strong>Currency:</strong> {currentProfile.currency}</div>
                                    <div><strong>Country:</strong> {currentProfile.country}</div>
                                    <div><strong>Modules:</strong> {currentProfile.modules?.join(", ") || "No modules selected"}</div>
                                </>
                            ) : (
                                <div className="text-muted-foreground">No active business profile configured yet.</div>
                            )}

                            {businessProfiles && businessProfiles.length > 0 && (
                                <div className="pt-3 border-t">
                                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Saved profiles</div>
                                    <div className="space-y-2">
                                        {businessProfiles.map((profile: any) => (
                                            <button
                                                key={profile._id}
                                                type="button"
                                                onClick={() => loadProfile(profile)}
                                                className="w-full text-left rounded-md border bg-background p-2 hover:bg-muted/40"
                                            >
                                                <div className="font-medium">{profile.businessName}</div>
                                                <div className="text-xs text-muted-foreground">{profile.businessType} • {profile.industry || "General"}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </CardContent>
        </Card>
    );
}

// --- USER MANAGER ---
function UserManager() {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Doc<"users"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"users"> | null>(null);

    // Pagination [TRUE]
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const paginatedResult = useQuery(api.users.getPaginated, {
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage,
        searchTerm: search || undefined
    });

    const createUser = useMutation(api.users.create);
    const updateUser = useMutation(api.users.update);
    const deleteUser = useMutation(api.users.remove);

    const users = paginatedResult?.page;
    const totalItems = paginatedResult?.totalCount || 0;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentItems = users || [];

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
                adminUserId: user!._id,
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
                adminUserId: user!._id,
            });
            toast.success("User updated");
            setEditingItem(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deleteUser({ id: deletingId, adminUserId: user!._id });
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

// --- PROMOTION MANAGER ---
function PromotionManager() {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Doc<"promotions"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"promotions"> | null>(null);
    const [managingProductsId, setManagingProductsId] = useState<Id<"promotions"> | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Filter state for dialogs
    const [addTriggerType, setAddTriggerType] = useState("Product");
    const [editTriggerType, setEditTriggerType] = useState("Product");

    const paginatedResult = useQuery(api.promotions.getPaginated, {
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage,
        searchTerm: search || undefined
    });

    const createPromo = useMutation(api.promotions.add);
    const updatePromo = useMutation(api.promotions.update);
    const deletePromo = useMutation(api.promotions.remove);

    const promotions = paginatedResult?.page;
    const totalItems = paginatedResult?.totalCount || 0;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentItems = promotions || [];

    const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        try {
            await createPromo({
                name: formData.get("name") as string,
                prize: formData.get("prize") as string,
                triggerType: formData.get("triggerType") as string,
                threshold: formData.get("threshold") ? parseFloat(formData.get("threshold") as string) : undefined,
                isActive: true,
                userId: user!._id,
            });
            toast.success("Promotion created");
            setIsAddOpen(false);
            setAddTriggerType("Product"); // Reset
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!editingItem) return;
        const formData = new FormData(e.currentTarget);
        try {
            await updatePromo({
                id: editingItem._id,
                name: formData.get("name") as string,
                prize: formData.get("prize") as string,
                triggerType: formData.get("triggerType") as string,
                threshold: formData.get("threshold") ? parseFloat(formData.get("threshold") as string) : undefined,
                isActive: formData.get("isActive") === "on",
                userId: user!._id,
            });
            toast.success("Promotion updated");
            setEditingItem(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deletePromo({ id: deletingId, userId: user!._id });
            toast.success("Promotion deleted");
            setDeletingId(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Promotion Management</CardTitle>
                <CardDescription>Setup promotional offers and prize triggers.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-4 space-y-4">
                    <ConfirmDeleteModal isOpen={!!deletingId} onClose={() => setDeletingId(null)} onConfirm={handleDelete} title="Delete Promotion?" />

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-2 bg-muted/30 p-2 rounded-lg border w-full sm:max-w-sm">
                            <Search className="h-4 w-4 text-muted-foreground ml-2" />
                            <Input placeholder="Search promotions..." value={search} onChange={(e) => setSearch(e.target.value)} className="border-0 bg-transparent h-8 focus-visible:ring-0 w-full" />
                        </div>
                        <Button onClick={() => { setIsAddOpen(true); setAddTriggerType("Product"); }} className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4" /> Add Promotion</Button>
                    </div>

                    <div className="rounded-md border overflow-x-auto">
                        <div className="min-w-[800px] lg:min-w-0">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>Promotion Name</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Prize (What you win)</TableHead>
                                        <TableHead className="text-center">Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {!promotions ? <TableRow><TableCell colSpan={5}><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow> : currentItems.map((promo) => (
                                        <TableRow key={promo._id}>
                                            <TableCell className="font-medium">
                                                <div className="flex flex-col">
                                                    <span>{promo.name}</span>
                                                    {(promo.triggerType === "TotalPV" || promo.triggerType === "TotalBV") && (
                                                        <span className="text-[10px] text-muted-foreground font-mono">
                                                            Target: {promo.threshold} {promo.triggerType.replace("Total", "")}
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                                                    {promo.triggerType || "Product"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-bold text-primary">{promo.prize}</TableCell>
                                            <TableCell className="text-center">
                                                {promo.isActive ? <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        {(promo.triggerType === "Product" || !promo.triggerType) && (
                                                            <DropdownMenuItem onClick={() => setManagingProductsId(promo._id)}><Plus className="mr-2 h-4 w-4" /> Manage Products</DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuItem onClick={() => { setEditingItem(promo); setEditTriggerType(promo.triggerType || "Product"); }}><Edit className="mr-2 h-4 w-4" /> Edit</DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(promo._id)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
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
                    <DialogHeader><DialogTitle>Add Promotion</DialogTitle></DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="space-y-2"><Label>Promotion Name</Label><Input name="name" required /></div>
                        <div className="space-y-2"><Label>Prize (What you win)</Label><Input name="prize" required placeholder="e.g. Free T-Shirt, UGX 10,000" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Trigger Type</Label>
                                <Select name="triggerType" value={addTriggerType} onValueChange={setAddTriggerType}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Product">Product Specific</SelectItem>
                                        <SelectItem value="TotalPV">Total PV Sum</SelectItem>
                                        <SelectItem value="TotalBV">Total BV Sum</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {addTriggerType !== "Product" && (
                                <div className="space-y-2">
                                    <Label>Threshold ({addTriggerType.replace("Total", "")})</Label>
                                    <Input name="threshold" type="number" required placeholder="e.g. 50" />
                                </div>
                            )}
                        </div>
                        <DialogFooter><Button type="submit">Create</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Edit Promotion</DialogTitle></DialogHeader>
                    {editingItem && (
                        <form onSubmit={handleUpdate} className="space-y-4">
                            <div className="space-y-2"><Label>Promotion Name</Label><Input name="name" defaultValue={editingItem.name} required /></div>
                            <div className="space-y-2"><Label>Prize (What you win)</Label><Input name="prize" defaultValue={editingItem.prize} required /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Trigger Type</Label>
                                    <Select name="triggerType" value={editTriggerType} onValueChange={setEditTriggerType}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Product">Product Specific</SelectItem>
                                            <SelectItem value="TotalPV">Total PV Sum</SelectItem>
                                            <SelectItem value="TotalBV">Total BV Sum</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {editTriggerType !== "Product" && (
                                    <div className="space-y-2">
                                        <Label>Threshold ({editTriggerType.replace("Total", "")})</Label>
                                        <Input name="threshold" type="number" defaultValue={editingItem.threshold} required placeholder="e.g. 50" />
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center space-x-2"><Switch name="isActive" defaultChecked={editingItem.isActive} /><Label>Active</Label></div>
                            <DialogFooter><Button type="submit">Update</Button></DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={!!managingProductsId} onOpenChange={(o) => !o && setManagingProductsId(null)}>
                <DialogContent className="max-w-full w-[95vw]">
                    <DialogHeader><DialogTitle>Manage Trigger Products</DialogTitle></DialogHeader>
                    {managingProductsId && <PromotionProductManager promotionId={managingProductsId} />}
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function PromotionProductManager({ promotionId }: { promotionId: Id<"promotions"> }) {
    const { user } = useAuth();
    const promotionProducts = useQuery(api.promotions.getPromotionProducts, { promotionId });
    const stocks = useQuery(api.stocks.listAll, {});
    const addProduct = useMutation(api.promotions.addProduct);
    const removeProduct = useMutation(api.promotions.removeProduct);
    const updateQuantity = useMutation(api.promotions.updateProductQuantity);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const stockId = formData.get("stockId") as Id<"stocks">;
        const quantity = Number(formData.get("quantity"));

        if (!stockId || !quantity) return;

        // Check for duplicate
        const isDuplicate = promotionProducts?.some(p => p.stockId === stockId);
        if (isDuplicate) {
            toast.error("Product already added to this promotion! Please edit the existing entry instead.");
            return;
        }

        try {
            setIsSubmitting(true);
            await addProduct({
                promotionId,
                stockId,
                requiredQuantity: quantity,
                userId: user!._id,
            });
            toast.success("Product updated in trigger");
            e.currentTarget.reset();
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <form onSubmit={handleAdd} className="bg-muted/20 p-2 rounded-lg border grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                <div className="col-span-1 md:col-span-7 space-y-2 min-w-0">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-auto flex">Product</Label>
                    <Select name="stockId" required>
                        <SelectTrigger className="bg-background w-full">
                            <span className="truncate block w-full text-left">
                                <SelectValue placeholder="Select product" />
                            </span>
                        </SelectTrigger>
                        <SelectContent>
                            {stocks?.map(s => (
                                <SelectItem key={s._id} value={s._id}>
                                    <span className="truncate block w-full max-w-[500px]">
                                        {s.name} ({s.productCode})
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="col-span-1 md:col-span-2 space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-auto flex">Qty to Trigger</Label>
                    <Input
                        name="quantity"
                        type="number"
                        min="1"
                        required
                        defaultValue="1"
                        className="bg-background"
                    />
                </div>
                <div className="col-span-2 md:col-span-3">
                    <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full font-bold bg-green-600 hover:bg-green-700 text-white"
                    >
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="mr-2 h-4 w-4" />}
                        Add
                    </Button>
                </div>
            </form>

            <div className="rounded-xl border border-muted-foreground/10 overflow-hidden shadow-sm">
                <Table>
                    <TableHeader className="bg-muted/50 text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                        <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-6">Product Details</TableHead>
                            <TableHead className="text-center">Required Qty</TableHead>
                            <TableHead className="text-right pr-6">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!promotionProducts ? (
                            <TableRow><TableCell colSpan={3} className="text-center py-12"><Loader2 className="animate-spin mx-auto h-6 w-6 text-primary" /></TableCell></TableRow>
                        ) : promotionProducts.length === 0 ? (
                            <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground italic text-sm">No products connected yet.</TableCell></TableRow>
                        ) : promotionProducts.map((pp) => (
                            <TableRow key={pp._id} className="hover:bg-muted/20 transition-colors">
                                <TableCell className="pl-6 py-4">
                                    <div className="flex flex-col">
                                        <span className="font-bold text-sm text-foreground">{pp.stockName}</span>
                                        <span className="text-[10px] font-mono text-muted-foreground">{pp.productCode}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => updateQuantity({ id: pp._id, quantity: pp.requiredQuantity - 1, userId: user!._id })}
                                            disabled={pp.requiredQuantity <= 1}
                                        >
                                            <Minus className="h-3 w-3" />
                                        </Button>
                                        <span className="font-black text-lg text-primary w-8 text-center">{pp.requiredQuantity}</span>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => updateQuantity({ id: pp._id, quantity: pp.requiredQuantity + 1, userId: user!._id })}
                                        >
                                            <Plus className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right pr-6">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => removeProduct({ id: pp._id, userId: user!._id })}
                                        className="text-destructive hover:bg-destructive/10 hover:text-destructive h-9 w-9 rounded-full transition-all"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

// --- DISTRIBUTOR MANAGER ---
function DistributorManager() {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Doc<"customers"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"customers"> | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const paginatedResult = useQuery(api.customers.getPaginated, {
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage,
        searchTerm: search || undefined
    });

    const packageList = useQuery(api.promotions.listAll); // No longer strictly needed for dist, but keeping for reference if needed
    // const packageMap = new Map(packageList?.map(p => [p._id, p.name]) || []);

    const createDistributor = useMutation(api.customers.add);
    const updateDistributor = useMutation(api.customers.update);
    const deleteDistributor = useMutation(api.customers.remove);

    const totalItems = paginatedResult?.totalCount || 0;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentItems = paginatedResult?.page || [];

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
                userId: user!._id,
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
                userId: user!._id,
            });
            toast.success("Distributor updated");
            setEditingItem(null);
        } catch (error) { toast.error(formatError(error)); }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deleteDistributor({ id: deletingId, userId: user!._id });
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
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedResult === undefined ? <TableRow><TableCell colSpan={4}><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow> : currentItems.map((dist) => (
                                        <TableRow key={dist._id}>
                                            <TableCell className="font-medium">{dist.name}</TableCell>
                                            <TableCell className="font-mono text-xs">{dist.distributorId || "-"}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col text-sm">
                                                    <span>{dist.phone}</span>
                                                    <span className="text-muted-foreground text-xs">{dist.email}</span>
                                                </div>
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
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Doc<"shops"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"shops"> | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const paginatedResult = useQuery(api.shops.getPaginated, {
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage,
        searchTerm: search || undefined
    });

    const userList = useQuery(api.users.listAll);
    const userMap = new Map(userList?.map(u => [u._id, `${u.first_name} ${u.last_name}`]) || []);

    const createShop = useMutation(api.shops.create);
    const updateShop = useMutation(api.shops.update);
    const deleteShop = useMutation(api.shops.remove);

    const totalItems = paginatedResult?.totalCount || 0;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentItems = paginatedResult?.page || [];

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
            await deleteShop({ id: deletingId, userId: user!._id });
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
                                {paginatedResult === undefined ? <TableRow><TableCell colSpan={4}><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow> : currentItems.map((shop) => (
                                    <TableRow key={shop._id}>
                                        <TableCell className="font-medium">
                                            <div>{shop.name}</div>
                                            <div className="text-xs text-muted-foreground">{shop.serialNumber}</div>
                                        </TableCell>
                                        <TableCell>{shop.location}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-normal">
                                                {userMap.get(shop.userId) || "Unknown"}
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
                                    {userList?.map((u: any) => <SelectItem key={u._id} value={u._id}>{u.first_name} {u.last_name}</SelectItem>)}
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
                                        {userList?.map((u: any) => <SelectItem key={u._id} value={u._id}>{u.first_name} {u.last_name}</SelectItem>)}
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

