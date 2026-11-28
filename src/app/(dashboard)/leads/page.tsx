"use client";

/**
 * SMART_BUZ — Sales pipeline.
 *
 * A lead is somebody who might buy, before they are a customer. This screen
 * is where those people are kept while the business works out whether they
 * are worth having: who they are, where they came from, what they asked for
 * and what the deal is worth.
 *
 * The figures are the server's. The weighted pipeline in particular is not a
 * sum done on the screen — it is what the server says the open leads are
 * worth once each stage is given the chance it usually closes at.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { toast } from "sonner";
import {
    CircleDollarSign,
    Percent,
    Search,
    Target,
    TrendingUp,
    UserPlus,
    Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    ActionButton,
    CountBadge,
    PageContainer,
    PageHeader,
    SectionCard,
    StatCard,
    StatGrid,
    Toolbar,
    ToolbarGroup,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import {
    ConfirmDeleteDialog,
    FormDialog,
    RecordActions,
    RecordDetail,
    type FormField,
    shortDate,
    today,
} from "@/components/vertical/ui-kit";
import { reportError } from "@/components/error-feedback";
import { statusLabel, statusTone } from "@/lib/status-tone";
import { useCurrency } from "@/hooks/use-currency";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useT } from "@/i18n/provider";

/* ────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────── */

type Lead = {
    _id: Id<"leads">;
    name: string;
    contact?: string;
    email?: string;
    source?: string;
    stage: string;
    value?: number;
    requirement?: string;
    notes?: string;
    customerId?: Id<"customers">;
    lostReason?: string;
    createdAt: string;
    updatedAt: string;
};

type LeadStage = "new" | "contacted" | "quoted" | "won" | "lost";

/* ────────────────────────────────────────────────────────────────────────
 * The vocabulary of the screen
 * ──────────────────────────────────────────────────────────────────────── */

const STAGES: LeadStage[] = ["new", "contacted", "quoted", "won", "lost"];

const STAGE_FILTERS = [
    { value: "all", label: "All stages" },
    ...STAGES.map((stage) => ({ value: stage, label: statusLabel(stage) })),
];

/**
 * The colours of the pipeline's stages.
 *
 * The shared status map knows the states the whole product shares; the
 * stages of a pipeline are the commercial ones, so they are named here
 * rather than guessed at differently on every screen.
 */
const LEAD_TONES: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
    new: "info",
    contacted: "info",
    quoted: "warning",
    won: "success",
    lost: "danger",
};

function leadTone(stage: string) {
    return LEAD_TONES[stage] ?? statusTone(stage);
}

/** `StatCard` speaks a narrower tone vocabulary than the badge set. */
function leadStatTone(stage: string): "default" | "success" | "warning" | "danger" | "info" {
    const tone = leadTone(stage);
    return tone === "neutral" ? "default" : tone;
}

const SOURCES = [
    { value: "walk-in", label: "Walk-in" },
    { value: "referral", label: "Referral" },
    { value: "campaign", label: "Campaign" },
    { value: "social", label: "Social media" },
    { value: "phone", label: "Phone enquiry" },
    { value: "other", label: "Other" },
];

/* ────────────────────────────────────────────────────────────────────────
 * The page
 * ──────────────────────────────────────────────────────────────────────── */

export default function LeadsPage() {
    
    const t = useT();const { currency } = useCurrency();

    const [stageFilter, setStageFilter] = useState("all");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [viewing, setViewing] = useState<Lead | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<Lead | null>(null);

    /** The lead waiting on a question before its stage can change. */
    const [pendingStage, setPendingStage] = useState<{
        lead: Lead;
        stage: LeadStage;
        reason: "lost" | "won";
    } | null>(null);

    const summary = useQuery(api.packages.commercial.getPipelineSummary, {});
    const leads = useQuery(api.packages.commercial.listLeads, {
        stage: stageFilter === "all" ? undefined : stageFilter,
        search: debouncedSearch.trim() ? debouncedSearch.trim() : undefined,
    });

    const createLead = useMutation(api.packages.commercial.createLead);
    const updateStage = useMutation(api.packages.commercial.updateLeadStage);
    const removeLead = useMutation(api.packages.commercial.deleteLead);

    const rows: Lead[] = leads ?? [];
    const isLoading = leads === undefined;

    const stageCounts = useMemo(() => {
        const out: Record<string, { count: number; value: number }> = {};
        for (const stage of summary?.stages ?? []) {
            out[stage.stage] = { count: stage.count, value: stage.value };
        }
        return out;
    }, [summary]);

    const moveToStage = async (
        lead: Lead,
        stage: LeadStage,
        extra?: { lostReason?: string; customerPhone?: string }
    ) => {
        try {
            await updateStage({ leadId: lead._id, stage, ...extra });
            toast.success(`${lead.name} is now ${statusLabel(stage).toLowerCase()}.`);
        } catch (error) {
            reportError(error, "The lead could not be moved.");
        }
    };

    /** A stage change that needs a question asked first. */
    const chooseStage = (lead: Lead, stage: LeadStage) => {
        if (stage === lead.stage) return;

        if (stage === "lost") {
            setPendingStage({ lead, stage, reason: "lost" });
            return;
        }

        if (stage === "won" && !lead.contact) {
            // A lead with no number cannot become a customer record yet, so
            // the number is asked for before the move is made.
            setPendingStage({ lead, stage, reason: "won" });
            return;
        }

        void moveToStage(lead, stage);
    };

    const handleCreate = async (values: Record<string, string>) => {
        const value = values.value?.trim() ? Number(values.value) : undefined;

        try {
            await createLead({
                name: values.name?.trim() ?? "",
                contact: values.contact?.trim() || undefined,
                email: values.email?.trim() || undefined,
                source: values.source || undefined,
                value: value !== undefined && Number.isFinite(value) ? value : undefined,
                requirement: values.requirement?.trim() || undefined,
                notes: values.notes?.trim() || undefined,
            });
            toast.success("The lead has been added to the pipeline.");
        } catch (error) {
            reportError(error, "The lead could not be added.");
            throw error;
        }
    };

    const handlePendingStage = async (values: Record<string, string>) => {
        if (!pendingStage) return;
        try {
            if (pendingStage.reason === "lost") {
                await updateStage({
                    leadId: pendingStage.lead._id,
                    stage: "lost",
                    lostReason: values.lostReason?.trim() ?? "",
                });
                toast.success(`${pendingStage.lead.name} has been marked lost.`);
            } else {
                await updateStage({
                    leadId: pendingStage.lead._id,
                    stage: "won",
                    customerPhone: values.customerPhone?.trim() || undefined,
                });
                toast.success(
                    `${pendingStage.lead.name} has been won and is now a customer.`
                );
            }
            setPendingStage(null);
        } catch (error) {
            reportError(error, "The lead could not be moved.");
            throw error;
        }
    };

    const handleDelete = async () => {
        if (!pendingDelete) return;
        try {
            await removeLead({ leadId: pendingDelete._id });
            toast.success(`${pendingDelete.name} removed from the pipeline.`);
            setPendingDelete(null);
        } catch (error) {
            reportError(error, "The lead could not be deleted.");
            throw error;
        }
    };

    const createFields: FormField[] = [
        {
            name: "name",
            label: "Name",
            type: "text",
            required: true,
            placeholder: "Who to call",
        },
        {
            name: "contact",
            label: "Phone",
            type: "tel",
            placeholder: "Optional",
        },
        {
            name: "email",
            label: "Email",
            type: "email",
            placeholder: "Optional",
        },
        {
            name: "source",
            label: "Where they came from",
            type: "select",
            defaultValue: "walk-in",
            options: SOURCES,
        },
        {
            name: "value",
            label: "What the deal is worth",
            type: "number",
            min: 0,
            step: 0.01,
            hint: "Optional, but it is what the pipeline is measured on.",
        },
        {
            name: "requirement",
            label: "What they want",
            type: "textarea",
            full: true,
        },
        { name: "notes", label: "Notes", type: "textarea", full: true },
    ];

    const lostFields: FormField[] = [
        {
            name: "lostReason",
            label: "Why was it lost?",
            type: "textarea",
            required: true,
            hint: "So the same thing is not offered again next time.",
        },
    ];

    const wonFields: FormField[] = [
        {
            name: "customerPhone",
            label: "Phone number",
            type: "tel",
            required: true,
            hint: "The number the customer record is made with.",
        },
    ];

    const columns: DataTableColumn<Lead>[] = [
        {
            id: "name",
            header: "Lead",
            accessor: (row) => row.name,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.name}</p>
                    {row.requirement ? (
                        <p className="truncate text-xs text-muted-foreground">
                            {row.requirement}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "contact",
            header: "Contact",
            accessor: (row) => row.contact ?? "",
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate tabular-nums">{row.contact || "—"}</p>
                    {row.email ? (
                        <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "source",
            header: "Source",
            accessor: (row) => row.source ?? "",
            hideBelow: "sm",
            cell: (row) => (row.source ? statusLabel(row.source) : "—"),
        },
        {
            id: "stage",
            header: "Stage",
            accessor: (row) => row.stage,
            cell: (row) => (
                <Select
                    value={row.stage}
                    onValueChange={(value) => chooseStage(row, value as LeadStage)}
                >
                    <SelectTrigger
                        className="h-8 w-[130px]"
                        aria-label={t("Stage for {0}", {
            0: row.name,
        })}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {STAGES.map((stage) => (
                            <SelectItem key={stage} value={stage}>
                                {statusLabel(stage)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ),
        },
        {
            id: "value",
            header: `Value (${currency})`,
            accessor: (row) => row.value ?? 0,
            align: "right",
            cell: (row) => (
                <span className="font-semibold tabular-nums">
                    {row.value !== undefined ? row.value.toLocaleString() : "—"}
                </span>
            ),
        },
        {
            id: "status",
            header: "State",
            accessor: (row) => row.stage,
            cell: (row) => (
                <Badge variant={leadTone(row.stage)}>{statusLabel(row.stage)}</Badge>
            ),
            hideBelow: "md",
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            cell: (row) => (
                <div className="flex items-center justify-end">
                    <RecordActions
                        label={t("Actions for {0}", {
            0: row.name,
        })}
                        onView={() => {
                            setViewing(row);
                            setIsDetailOpen(true);
                        }}
                        onDelete={() => setPendingDelete(row)}
                    />
                </div>
            ),
        },
    ];

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Commercial"
                title={t("Sales pipeline")}
                description={t("The people who might buy — where they came from, what they asked for, and what they are worth while the business works out whether to go after them.")}
                icon={Target}
                actions={
                    <>
                        <CountBadge>{summary?.total ?? 0}</CountBadge>
                        <ActionButton onClick={() => setIsCreateOpen(true)}>
                            <UserPlus className="mr-2 size-4" />
                            {t("New lead")}
                        </ActionButton>
                    </>
                }
            />

            <StatGrid columns={5}>
                <StatCard
                    label={t("Leads")}
                    value={summary?.total ?? 0}
                    hint={t("Everybody in the pipeline")}
                    icon={Users}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Still open")}
                    value={summary?.open ?? 0}
                    hint={t("Neither won nor lost")}
                    icon={Target}
                    tone="info"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Pipeline value")}
                    value={`${currency} ${(summary?.pipelineValue ?? 0).toLocaleString()}`}
                    hint={t("What the open leads are worth")}
                    icon={CircleDollarSign}
                    tone="warning"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Weighted pipeline")}
                    value={`${currency} ${(summary?.weightedValue ?? 0).toLocaleString()}`}
                    hint={t("What they are worth if each stage closes as it usually does")}
                    icon={TrendingUp}
                    tone="success"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Win rate")}
                    value={`${summary?.winRate ?? 0}%`}
                    hint={
                        summary && summary.closed === 0
                            ? "No lead has been decided yet"
                            : `${summary?.won ?? 0} won of ${summary?.closed ?? 0} decided`
                    }
                    icon={Percent}
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <StatGrid columns={5}>
                {STAGES.map((stage) => (
                    <StatCard
                        key={stage}
                        label={statusLabel(stage)}
                        value={stageCounts[stage]?.count ?? 0}
                        hint={`${currency} ${(stageCounts[stage]?.value ?? 0).toLocaleString()}`}
                        tone={leadStatTone(stage)}
                        isLoading={summary === undefined}
                    />
                ))}
            </StatGrid>

            <SectionCard
                title={t("The pipeline")}
                description={
                    rows.length === 0
                        ? "Nobody is in the pipeline yet."
                        : `${rows.length} ${rows.length === 1 ? "lead" : "leads"} in the pipeline.`
                }
                actions={
                    <DataTableExport
                        title={t("Sales pipeline")}
                        subtitle={t("Pipeline as at {0}", {
            0: today(),
        })}
                        rows={rows}
                        columns={columns}
                    />
                }
                padded={false}
            >
                <div className="border-b border-border/60 p-4 sm:p-5">
                    <Toolbar>
                        <ToolbarGroup>
                            <Select value={stageFilter} onValueChange={setStageFilter}>
                                <SelectTrigger className="h-9 w-[170px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {STAGE_FILTERS.map((filter) => (
                                        <SelectItem key={filter.value} value={filter.value}>
                                            {t(filter.label)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </ToolbarGroup>

                        <div className="relative sm:w-72">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder={t("Search the pipeline…")}
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                className="h-9 pl-10"
                            />
                        </div>
                    </Toolbar>
                </div>

                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row) => row._id}
                    isLoading={isLoading}
                    isEmpty={!isLoading && rows.length === 0}
                    emptyTitle={t("Nobody in the pipeline")}
                    emptyHint={t("Write down the people who might buy — who they are, how to reach them and what they asked for.")}
                    emptyAction={
                        <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(true)}>
                            <UserPlus className="mr-2 size-4" />
                            {t("New lead")}
                        </Button>
                    }
                    pageSize={25}
                    ariaLabel="Sales pipeline"
                />
            </SectionCard>

            <FormDialog
                open={isCreateOpen}
                onOpenChange={setIsCreateOpen}
                title={t("New lead")}
                description={t("A lead starts at the beginning of the pipeline. Where it goes from here is decided afterwards.")}
                fields={createFields}
                submitLabel="Add lead"
                onSubmit={handleCreate}
            />

            <FormDialog
                open={pendingStage?.reason === "lost"}
                onOpenChange={(open) => {
                    if (!open) setPendingStage(null);
                }}
                title={t("Mark this lead lost")}
                description={
                    pendingStage ? `${pendingStage.lead.name} will be moved to lost.` : undefined
                }
                fields={lostFields}
                submitLabel="Mark lost"
                onSubmit={handlePendingStage}
            />

            <FormDialog
                open={pendingStage?.reason === "won"}
                onOpenChange={(open) => {
                    if (!open) setPendingStage(null);
                }}
                title={t("Win this lead")}
                description={
                    pendingStage
                        ? `${pendingStage.lead.name} will become a customer on the books.`
                        : undefined
                }
                fields={wonFields}
                submitLabel="Mark won"
                onSubmit={handlePendingStage}
            />

            <ConfirmDeleteDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDelete(null);
                }}
                entityName="lead"
                description={
                    pendingDelete
                        ? `${pendingDelete.name} is removed from the pipeline permanently. This cannot be undone.`
                        : undefined
                }
                onConfirm={handleDelete}
            />

            <RecordDetail
                open={isDetailOpen}
                onOpenChange={setIsDetailOpen}
                title={viewing?.name ?? "Lead"}
                description={viewing?.requirement}
                status={viewing?.stage}
                rows={
                    viewing
                        ? [
                              { label: "Contact", value: viewing.contact || "—" },
                              { label: "Email", value: viewing.email || "—" },
                              { label: "Source", value: viewing.source ? statusLabel(viewing.source) : "—" },
                              {
                                  label: "Stage",
                                  value: statusLabel(viewing.stage),
                              },
                              {
                                  label: "Value",
                                  value:
                                      viewing.value !== undefined
                                          ? `${currency} ${viewing.value.toLocaleString()}`
                                          : "—",
                              },
                              {
                                  label: "Customer",
                                  value: viewing.customerId ? "Won — on the books" : "—",
                              },
                              ...(viewing.lostReason
                                  ? [{ label: "Why it was lost", value: viewing.lostReason }]
                                  : []),
                              ...(viewing.notes ? [{ label: "Notes", value: viewing.notes }] : []),
                              { label: "Added", value: shortDate(viewing.createdAt) },
                          ]
                        : []
                }
            />
        </PageContainer>
    );
}
