"use client";

/**
 * SMART_BUZ — Clinical records
 *
 * The two records a clinic, a pharmacy or an agro-clinic has to keep
 * whether it sells anything or not:
 *
 *   • the **controlled-drug register** — every entry of a controlled drug
 *     in and out, and the balance those entries add up to; and
 *   • **vaccinations** — the campaigns, the animals, the patients, and the
 *     dates the next dose falls due.
 *
 * The balances on this screen are worked out by the server from the
 * entries themselves, so the register here and the register in the book
 * can never disagree. Nothing on this screen is a number the browser
 * keeps.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { toast } from "sonner";
import { Pill, Plus, Stethoscope, Syringe } from "lucide-react";

import {
    ActionButton,
    CountBadge,
    DataState,
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
    FormDialog,
    SearchBox,
    shortDate,
    today,
    type FormField,
} from "@/components/vertical/ui-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { reportError } from "@/components/error-feedback";
import { useAuth } from "@/context/auth-context";
import { useCurrency } from "@/hooks/use-currency";
import { statusLabel } from "@/lib/status-tone";
import { useT } from "@/i18n/provider";

/* ────────────────────────────────────────────────────────────────────────
 * The states the clinical records are shown in
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The tone each register entry is shown in.
 *
 * The shared status map does not know the register's four entry types yet,
 * so they are mapped here rather than invented a second time on every
 * screen. The owner of `src/lib/status-tone.ts` should fold these into the
 * one map, and this table can go with them.
 */
const ENTRY_TONE: Record<
    string,
    "success" | "warning" | "danger" | "info" | "neutral"
> = {
    receipt: "success",
    dispense: "info",
    write_off: "danger",
    adjustment: "warning",
};

/** The tone each vaccination state is shown in. */
const VACCINATION_TONE: Record<
    string,
    "success" | "warning" | "danger" | "info" | "neutral"
> = {
    done: "success",
    booked: "info",
    missed: "danger",
};

/** The states a vaccination can be in, for the filter. */
const VACCINATION_STATES = [
    { value: "all", label: "All states" },
    { value: "done", label: "Done" },
    { value: "booked", label: "Booked" },
    { value: "missed", label: "Missed" },
];

/** The ways a subject can be recorded, for the form. */
const SUBJECT_TYPES = [
    { value: "livestock", label: "Livestock" },
    { value: "pet", label: "Pet" },
    { value: "human", label: "Human" },
];

/** The ways a controlled drug can move, for the form. */
const ENTRY_TYPES = [
    { value: "receipt", label: "Receipt — into the register" },
    { value: "dispense", label: "Dispense — out to a patient" },
    { value: "write_off", label: "Write-off — out of the register" },
    { value: "adjustment", label: "Adjustment — a correction" },
];

export default function ClinicalRecordsPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { permissions } = useAuth();

    // The server decides what this person may read and write. The screen
    // only decides what is offered, so the buttons follow the same
    // permissions the backend will check.
    const canView = permissions.includes("members.view");
    const canManage = permissions.includes("members.manage");

    const [search, setSearch] = useState("");
    const [vaccinationSearch, setVaccinationSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [campaignFilter, setCampaignFilter] = useState("all");
    const [registerView, setRegisterView] = useState<"balances" | "entries">(
        "balances",
    );
    const [entryOpen, setEntryOpen] = useState(false);
    const [vaccinationOpen, setVaccinationOpen] = useState(false);

    const drugs = useQuery(
        api.packages.clinical.listControlledDrugs,
        canView ? {} : "skip",
    );
    const entries = useQuery(
        api.packages.clinical.listControlledEntries,
        canView ? {} : "skip",
    );
    const vaccinations = useQuery(
        api.packages.clinical.listVaccinations,
        canView ? {} : "skip",
    );
    const summary = useQuery(
        api.packages.clinical.getClinicalSummary,
        canView ? {} : "skip",
    );

    const recordEntry = useMutation(
        api.packages.clinical.recordControlledDrugEntry,
    );
    const recordVaccination = useMutation(
        api.packages.clinical.recordVaccination,
    );

    type DrugRow = NonNullable<typeof drugs>[number];
    type EntryRow = NonNullable<typeof entries>[number];
    type VaccinationRow = NonNullable<typeof vaccinations>[number];

    const drugRows: DrugRow[] = drugs ?? [];
    const entryRows: EntryRow[] = entries ?? [];
    const vaccinationRows: VaccinationRow[] = vaccinations ?? [];

    // The campaigns that appear in the records — the filter offers the
    // campaigns that exist rather than a free-text guess.
    const campaigns = Array.from(
        new Set(vaccinationRows.map((row) => row.campaignName)),
    ).sort((a, b) => a.localeCompare(b));

    const visibleVaccinations = vaccinationRows.filter((row) => {
        if (statusFilter !== "all" && row.status !== statusFilter) return false;
        if (campaignFilter !== "all" && row.campaignName !== campaignFilter) {
            return false;
        }
        return true;
    });

    const drugColumns: DataTableColumn<DrugRow>[] = [
        {
            id: "drug",
            header: "Drug",
            accessor: (row) => row.drugName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.drugName}</p>
                    {row.strength ? (
                        <p className="text-xs text-muted-foreground">
                            {row.strength}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "unit",
            header: "Unit",
            accessor: (row) => row.unit,
        },
        {
            id: "balance",
            header: "Balance",
            align: "right",
            accessor: (row) => row.balance,
            cell: (row) => (
                <span
                    className={
                        row.balance === 0
                            ? "font-semibold tabular-nums text-muted-foreground"
                            : "font-semibold tabular-nums"
                    }
                >
                    {row.balance}
                </span>
            ),
        },
        {
            id: "entries",
            header: "Entries",
            align: "right",
            accessor: (row) => row.entryCount,
            cell: (row) => <span className="tabular-nums">{row.entryCount}</span>,
        },
        {
            id: "lastEntry",
            header: "Last entry",
            accessor: (row) => row.lastEntryDate ?? "",
            cell: (row) => shortDate(row.lastEntryDate),
        },
    ];

    const entryColumns: DataTableColumn<EntryRow>[] = [
        {
            id: "date",
            header: "Date",
            accessor: (row) => row.date,
            cell: (row) => shortDate(row.date),
        },
        {
            id: "drug",
            header: "Drug",
            accessor: (row) => row.drugName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.drugName}</p>
                    {row.strength ? (
                        <p className="text-xs text-muted-foreground">
                            {row.strength}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "entryType",
            header: "Entry",
            accessor: (row) => row.entryType,
            cell: (row) => (
                <Badge variant={ENTRY_TONE[row.entryType] ?? "neutral"}>
                    {statusLabel(row.entryType)}
                </Badge>
            ),
        },
        {
            id: "quantity",
            header: "Quantity",
            align: "right",
            accessor: (row) => row.quantity,
            cell: (row) => (
                <span className="tabular-nums">
                    {row.direction === "in" ? "+" : "−"}
                    {Math.abs(row.quantity)} {row.unit}
                </span>
            ),
        },
        {
            id: "balance",
            header: "Balance after",
            align: "right",
            accessor: (row) => row.balanceAfter,
            cell: (row) => (
                <span className="font-medium tabular-nums">
                    {row.balanceAfter} {row.unit}
                </span>
            ),
        },
        {
            id: "patient",
            header: "Patient / source",
            accessor: (row) => row.patientName,
        },
        {
            id: "prescriber",
            header: "Prescriber",
            accessor: (row) => row.prescriberName ?? "",
        },
        {
            id: "reason",
            header: "Reason",
            accessor: (row) => row.reason ?? "",
        },
    ];

    const vaccinationColumns: DataTableColumn<VaccinationRow>[] = [
        {
            id: "date",
            header: "Date",
            accessor: (row) => row.date,
            cell: (row) => shortDate(row.date),
        },
        {
            id: "subject",
            header: "Subject",
            accessor: (row) => row.subjectName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.subjectName}</p>
                    <p className="text-xs text-muted-foreground">
                        {statusLabel(row.subjectType)}
                        {row.ownerName ? ` · ${row.ownerName}` : ""}
                    </p>
                </div>
            ),
        },
        {
            id: "vaccine",
            header: "Vaccine",
            accessor: (row) => row.vaccineName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate">{row.vaccineName}</p>
                    {row.dose ? (
                        <p className="text-xs text-muted-foreground">
                            {row.dose}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "campaign",
            header: "Campaign",
            accessor: (row) => row.campaignName,
        },
        {
            id: "status",
            header: "Status",
            accessor: (row) => row.status,
            cell: (row) => (
                <Badge variant={VACCINATION_TONE[row.status] ?? "neutral"}>
                    {statusLabel(row.status)}
                </Badge>
            ),
        },
        {
            id: "nextDue",
            header: "Next due",
            accessor: (row) => row.nextDueDate ?? "",
            cell: (row) => shortDate(row.nextDueDate),
        },
        {
            id: "amount",
            header: "Fee",
            align: "right",
            accessor: (row) => row.amount ?? 0,
            cell: (row) =>
                row.amount === undefined ? (
                    <span className="text-muted-foreground">—</span>
                ) : (
                    <span className="tabular-nums">
                        {currency} {row.amount.toLocaleString()}
                    </span>
                ),
        },
    ];

    const handleRecordEntry = async (values: Record<string, string>) => {
        const quantity = Number(values.quantity);
        if (!Number.isFinite(quantity)) {
            throw new Error("Enter the quantity that moved.");
        }
        try {
            const result = await recordEntry({
                entryType: values.entryType as
                    | "receipt"
                    | "dispense"
                    | "adjustment"
                    | "write_off",
                drugName: values.drugName.trim(),
                strength: values.strength.trim() || undefined,
                unit: values.unit.trim(),
                quantity,
                date: values.date,
                patientName: values.patientName.trim(),
                prescriberName: values.prescriberName.trim() || undefined,
                prescriberNumber: values.prescriberNumber.trim() || undefined,
                reason: values.reason.trim() || undefined,
                stockCode: values.stockCode.trim() || undefined,
            });
            toast.success(
                `Recorded. The register now holds ${result.balanceAfter} ${values.unit.trim()}.`,
            );
        } catch (err) {
            // The server's own sentence is the useful one — it says what was
            // refused and why. `reportError` shows that sentence and marks
            // it as shown, so the dialog does not repeat it under the toast.
            reportError(
                err,
                "The entry could not be recorded. Please try again.",
            );
            throw err;
        }
    };

    const handleRecordVaccination = async (values: Record<string, string>) => {
        const fee = values.amount.trim() === "" ? undefined : Number(values.amount);
        if (fee !== undefined && !Number.isFinite(fee)) {
            throw new Error("The fee has to be a number.");
        }
        try {
            const result = await recordVaccination({
                campaignName: values.campaignName.trim(),
                subjectName: values.subjectName.trim(),
                subjectType: values.subjectType as
                    | "livestock"
                    | "pet"
                    | "human",
                ownerName: values.ownerName.trim() || undefined,
                vaccineName: values.vaccineName.trim(),
                dose: values.dose.trim() || undefined,
                date: values.date,
                nextDueDate: values.nextDueDate.trim() || undefined,
                status: values.status as "done" | "booked" | "missed",
                amount: fee,
                notes: values.notes.trim() || undefined,
                stockCode: values.stockCode.trim() || undefined,
            });
            toast.success(
                result.nextDueDate
                    ? `Vaccination recorded. The next dose is due on ${shortDate(
                          result.nextDueDate,
                      )}.`
                    : "Vaccination recorded.",
            );
        } catch (err) {
            reportError(
                err,
                "The vaccination could not be recorded. Please try again.",
            );
            throw err;
        }
    };

    const entryFields: FormField[] = [
        {
            name: "entryType",
            label: "Entry",
            type: "select",
            required: true,
            options: ENTRY_TYPES,
            defaultValue: "receipt",
            full: true,
        },
        {
            name: "drugName",
            label: "Drug",
            required: true,
            placeholder: "e.g. Morphine",
        },
        {
            name: "strength",
            label: "Strength",
            placeholder: "e.g. 30mg",
        },
        {
            name: "unit",
            label: "Unit",
            required: true,
            placeholder: "e.g. tablet, ml, ampoule",
        },
        {
            name: "quantity",
            label: "Quantity",
            type: "number",
            required: true,
            step: 0.01,
            hint: "A receipt, a dispense and a write-off take a positive amount. An adjustment that reduces the register takes a negative one.",
        },
        {
            name: "date",
            label: "Date",
            type: "date",
            required: true,
            defaultValue: today(),
        },
        {
            name: "patientName",
            label: "Patient / source",
            required: true,
            hint: "Who the drug went to, or where it came from.",
        },
        {
            name: "prescriberName",
            label: "Prescriber",
        },
        {
            name: "prescriberNumber",
            label: "Prescriber number",
        },
        {
            name: "reason",
            label: "Reason",
            hint: "Needed for a write-off and for an adjustment.",
        },
        {
            name: "stockCode",
            label: "Product code",
            hint: "Optional. When given, the stock movement is written against that product.",
            full: true,
        },
    ];

    const vaccinationFields: FormField[] = [
        {
            name: "campaignName",
            label: "Campaign",
            required: true,
            placeholder: "e.g. FMD round 2 — Kabarole",
            full: true,
        },
        {
            name: "subjectName",
            label: "Subject",
            required: true,
            hint: "The animal or the patient the vaccine was given to.",
        },
        {
            name: "subjectType",
            label: "Subject type",
            type: "select",
            required: true,
            options: SUBJECT_TYPES,
            defaultValue: "livestock",
        },
        {
            name: "ownerName",
            label: "Owner",
        },
        {
            name: "vaccineName",
            label: "Vaccine",
            required: true,
            placeholder: "e.g. FMD vaccine",
        },
        {
            name: "dose",
            label: "Dose",
            placeholder: "e.g. 2ml",
        },
        {
            name: "date",
            label: "Date",
            type: "date",
            required: true,
            defaultValue: today(),
        },
        {
            name: "nextDueDate",
            label: "Next due",
            type: "date",
            hint: "Leave empty when there is no next dose booked.",
        },
        {
            name: "status",
            label: "Status",
            type: "select",
            required: true,
            options: [
                { value: "done", label: "Done" },
                { value: "booked", label: "Booked" },
                { value: "missed", label: "Missed" },
            ],
            defaultValue: "done",
        },
        {
            name: "amount",
            label: `Fee (${currency})`,
            type: "number",
            min: 0,
        },
        {
            name: "stockCode",
            label: "Product code",
            hint: "Optional. The vaccine's product code — one unit is issued when the vaccination is recorded as done.",
        },
        {
            name: "notes",
            label: "Notes",
            type: "textarea",
            full: true,
        },
    ];

    if (!canView) {
        return (
            <PageContainer>
                <PageHeader
                    eyebrow="Health"
                    title={t("Clinical records")}
                    description={t("The controlled-drug register and the vaccination campaigns.")}
                    icon={Stethoscope}
                />
                <SectionCard title={t("Not available")}>
                    <p className="text-sm text-muted-foreground">
                        {t("Clinical records are read by the people who look after patients and animals. This account does not hold the permission to read them.")}
                    </p>
                </SectionCard>
            </PageContainer>
        );
    }

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Health"
                title={t("Clinical records")}
                description={t("Every controlled drug that comes in or goes out, and every vaccination given — with the balances worked out from the records themselves.")}
                icon={Stethoscope}
                badge={
                    <CountBadge tone="neutral">
                        {summary?.controlledDrugCount ?? 0}
                    </CountBadge>
                }
                actions={
                    canManage ? (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => setEntryOpen(true)}
                            >
                                <Pill className="mr-2 size-4" />
                                {t("Record entry")}
                            </Button>
                            <ActionButton onClick={() => setVaccinationOpen(true)}>
                                <Syringe className="mr-2 size-4" />
                                {t("Record vaccination")}
                            </ActionButton>
                        </>
                    ) : undefined
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Controlled drugs")}
                    value={summary?.controlledDrugCount ?? 0}
                    hint={t("Drugs on the register")}
                    icon={Pill}
                    tone="info"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Due in 30 days")}
                    value={summary?.vaccinationsDueIn30Days ?? 0}
                    hint={t("Next doses falling due")}
                    icon={Syringe}
                    tone="warning"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Booked")}
                    value={summary?.vaccinationsBooked ?? 0}
                    hint={t("Vaccinations booked but not yet given")}
                    tone="default"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Campaigns this month")}
                    value={summary?.campaignsThisMonth ?? 0}
                    hint={t("Campaigns the records name")}
                    tone="success"
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <SectionCard
                title={t("Controlled drug register")}
                description={t("The balance of every controlled drug is worked out from the entries beneath it. Nothing can be dispensed that the register does not hold.")}
                icon={Pill}
                actions={
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant={
                                registerView === "balances" ? "default" : "outline"
                            }
                            onClick={() => setRegisterView("balances")}
                        >
                            {t("Balances")}
                        </Button>
                        <Button
                            size="sm"
                            variant={
                                registerView === "entries" ? "default" : "outline"
                            }
                            onClick={() => setRegisterView("entries")}
                        >
                            {t("Entries")}
                        </Button>
                    </div>
                }
            >
                <Toolbar>
                    <ToolbarGroup>
                        <SearchBox
                            value={search}
                            onChange={setSearch}
                            placeholder={t("Search by drug…")}
                        />
                        <CountBadge>
                            {registerView === "balances"
                                ? drugRows.length
                                : entryRows.length}
                        </CountBadge>
                    </ToolbarGroup>
                    <ToolbarGroup>
                        {registerView === "balances" ? (
                            <DataTableExport
                                title={t("Controlled drug register")}
                                subtitle={t("Balances worked out from the entries")}
                                rows={drugRows}
                                columns={drugColumns}
                            />
                        ) : (
                            <DataTableExport
                                title={t("Controlled drug register")}
                                subtitle={t("Every entry, newest first")}
                                rows={entryRows}
                                columns={entryColumns}
                            />
                        )}
                    </ToolbarGroup>
                </Toolbar>

                {registerView === "balances" ? (
                    <DataState
                        isLoading={drugs === undefined}
                        isEmpty={drugRows.length === 0}
                        emptyTitle={t("No controlled drugs on the register yet")}
                        emptyHint={
                            canManage
                                ? "Record a receipt when controlled stock comes in, and a dispense when it goes out. The balance is worked out from those entries."
                                : "Nothing has been entered in the controlled-drug register yet."
                        }
                        emptyAction={
                            canManage ? (
                                <Button onClick={() => setEntryOpen(true)}>
                                    <Pill className="mr-2 size-4" />
                                    {t("Record entry")}
                                </Button>
                            ) : undefined
                        }
                    >
                        <DataTable
                            data={drugRows}
                            columns={drugColumns}
                            getRowId={(row) => `${row.drugName}-${row.strength ?? ""}-${row.unit}`}
                            searchTerm={search}
                            pageSize={0}
                            ariaLabel="Controlled drug balances"
                        />
                    </DataState>
                ) : (
                    <DataState
                        isLoading={entries === undefined}
                        isEmpty={entryRows.length === 0}
                        emptyTitle={t("No entries in the register yet")}
                        emptyHint={
                            canManage
                                ? "Every receipt, dispense, write-off and adjustment is entered here, newest first."
                                : "Nothing has been entered in the controlled-drug register yet."
                        }
                        emptyAction={
                            canManage ? (
                                <Button onClick={() => setEntryOpen(true)}>
                                    <Pill className="mr-2 size-4" />
                                    {t("Record entry")}
                                </Button>
                            ) : undefined
                        }
                    >
                        <DataTable
                            data={entryRows}
                            columns={entryColumns}
                            getRowId={(row) => row._id}
                            searchTerm={search}
                            pageSize={25}
                            ariaLabel="Controlled drug entries"
                        />
                    </DataState>
                )}
            </SectionCard>

            <SectionCard
                title={t("Vaccinations")}
                description={t("The campaigns, the animals and the patients they were given to, and the dates the next doses fall due.")}
                icon={Syringe}
            >
                <Toolbar>
                    <ToolbarGroup>
                        <SearchBox
                            value={vaccinationSearch}
                            onChange={setVaccinationSearch}
                            placeholder={t("Search by subject, vaccine or campaign…")}
                        />
                        <Select
                            value={statusFilter}
                            onValueChange={setStatusFilter}
                        >
                            <SelectTrigger className="h-9 w-[150px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {VACCINATION_STATES.map((state) => (
                                    <SelectItem
                                        key={state.value}
                                        value={state.value}
                                    >
                                        {t(state.label)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select
                            value={campaignFilter}
                            onValueChange={setCampaignFilter}
                        >
                            <SelectTrigger className="h-9 w-[220px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("All campaigns")}</SelectItem>
                                {campaigns.map((campaign) => (
                                    <SelectItem key={campaign} value={campaign}>
                                        {campaign}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <CountBadge>{visibleVaccinations.length}</CountBadge>
                    </ToolbarGroup>
                    <ToolbarGroup>
                        <DataTableExport
                            title={t("Vaccinations")}
                            subtitle={t("{0} of {1} records", {
            0: visibleVaccinations.length,
            1: vaccinationRows.length,
        })}
                            rows={visibleVaccinations}
                            columns={vaccinationColumns}
                        />
                    </ToolbarGroup>
                </Toolbar>

                <DataState
                    isLoading={vaccinations === undefined}
                    isEmpty={visibleVaccinations.length === 0}
                    emptyTitle={
                        vaccinationRows.length === 0
                            ? "No vaccinations recorded yet"
                            : "No vaccinations match the filter"
                    }
                    emptyHint={
                        vaccinationRows.length === 0
                            ? canManage
                                ? "Record the first vaccination of a campaign and it will appear here, with the next dose due."
                                : "Nothing has been recorded in the vaccination records yet."
                            : "Clear the filters to see the campaigns that were recorded."
                    }
                    emptyAction={
                        canManage && vaccinationRows.length === 0 ? (
                            <Button onClick={() => setVaccinationOpen(true)}>
                                <Syringe className="mr-2 size-4" />
                                {t("Record vaccination")}
                            </Button>
                        ) : undefined
                    }
                >
                    <DataTable
                        data={visibleVaccinations}
                        columns={vaccinationColumns}
                        getRowId={(row) => row._id}
                        searchTerm={vaccinationSearch}
                        pageSize={25}
                        defaultSort={{ id: "date", direction: "desc" }}
                        ariaLabel="Vaccinations"
                    />
                </DataState>
            </SectionCard>

            <FormDialog
                open={entryOpen}
                onOpenChange={setEntryOpen}
                title={t("Record a controlled-drug entry")}
                description={t("The balance is worked out on the server from the entries already in the register, so what it says is what the register holds.")}
                submitLabel="Record it"
                fields={entryFields}
                onSubmit={handleRecordEntry}
            />

            <FormDialog
                open={vaccinationOpen}
                onOpenChange={setVaccinationOpen}
                title={t("Record a vaccination")}
                description={t("The next due date is the one you give — SMARTBUZ does not know how long a vaccine lasts.")}
                submitLabel="Record it"
                fields={vaccinationFields}
                onSubmit={handleRecordVaccination}
            />
        </PageContainer>
    );
}
