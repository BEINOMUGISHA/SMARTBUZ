"use client";

/**
 * SMART_BUZ — the measurement book.
 *
 * The screen a tailor, a carpenter, a fitter or a salon works from: the
 * sizes each customer is, so that the next job is cut without measuring
 * the person again.
 *
 * A customer has one set of measurements, and taking them again replaces
 * the set — a tailor wants the sizes as they are now, not the sizes and
 * then the sizes that were true before.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { toast } from "sonner";
import { Ruler, NotebookPen, Users, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    CountBadge,
    PageContainer,
    PageHeader,
    SectionCard,
    StatCard,
    StatGrid,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FormDialog, RecordDetail } from "@/components/vertical/ui-kit";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

/* ────────────────────────────────────────────────────────────────────────
 * The shapes the server sends back
 * ──────────────────────────────────────────────────────────────────────── */

interface MeasurementRow {
    _id: Id<"customerMeasurements">;
    customerId: Id<"customers">;
    customerName: string;
    measurements: Record<string, number>;
    notes: string | null;
    updatedAt: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * The page
 * ──────────────────────────────────────────────────────────────────────── */

export default function MeasurementsPage() {
    
    const t = useT();const { currency } = useCurrency();

    const [recordOpen, setRecordOpen] = useState(false);
    const [detailRow, setDetailRow] = useState<MeasurementRow | null>(null);
    const [customerId, setCustomerId] = useState<string>("");
    const [values, setValues] = useState<Record<string, string>>({});

    const summary = useQuery(api.packages.workforce.getMeasurementSummary, {});
    const measurements = useQuery(api.packages.workforce.listMeasurements, {});
    const customers = useQuery(api.customers.listAll, {});

    const saveMeasurement = useMutation(api.packages.workforce.saveMeasurement);

    const rows = useMemo(() => measurements ?? [], [measurements]);
    const customerRows = useMemo(() => customers ?? [], [customers]);

    /** The measurements as one line of text, for the table. */
    const summarise = (record: Record<string, number>) =>
        Object.entries(record)
            .map(([name, value]) => `${name}: ${value}`)
            .join(" · ") || "—";

    const measurementColumns: DataTableColumn<MeasurementRow>[] = [
        {
            id: "customer",
            header: "Customer",
            accessor: (row) => row.customerName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                        {Object.keys(row.measurements).length} measurement
                        {Object.keys(row.measurements).length === 1 ? "" : "s"}
                    </p>
                </div>
            ),
        },
        {
            id: "measurements",
            header: "Measurements",
            accessor: (row) => summarise(row.measurements),
            cell: (row) => (
                <p className="min-w-0 truncate text-sm text-muted-foreground">
                    {summarise(row.measurements)}
                </p>
            ),
        },
        {
            id: "updatedAt",
            header: "Taken",
            accessor: (row) => row.updatedAt,
            hideBelow: "md",
            cell: (row) => (
                <span className="text-sm text-muted-foreground">
                    {row.updatedAt.slice(0, 10)}
                </span>
            ),
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            cell: (row) => (
                <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDetailRow(row)}>
                        {t("Open")}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setCustomerId(row.customerId);
                            setValues({
                                measurements: summarise(row.measurements),
                                notes: row.notes ?? "",
                            });
                            setRecordOpen(true);
                        }}
                    >
                        {t("Take again")}
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <PageContainer>
            <PageHeader
                eyebrow="People"
                title={t("Measurements")}
                description={t("The sizes each customer is, kept against the customer so the next job is cut without measuring again.")}
                icon={Ruler}
                actions={
                    <Button
                        onClick={() => {
                            setCustomerId("");
                            setValues({ measurements: "", notes: "" });
                            setRecordOpen(true);
                        }}
                    >
                        <NotebookPen className="mr-2 size-4" />
                        {t("Record measurements")}
                    </Button>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Customers measured")}
                    value={summary ? summary.customersMeasured : "—"}
                    hint={t("Sets on the book")}
                    icon={Users}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Measurements held")}
                    value={summary ? summary.measurementCount : "—"}
                    hint={t("Individual sizes on record")}
                    icon={Ruler}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Most measured")}
                    value={
                        summary && summary.mostMeasured.length > 0
                            ? summary.mostMeasured[0].name
                            : "—"
                    }
                    hint={
                        summary && summary.mostMeasured.length > 1
                            ? `Then ${summary.mostMeasured
                                  .slice(1, 3)
                                  .map((m) => m.name)
                                  .join(", ")}`
                            : "The size the business is asked for most"
                    }
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Last taken")}
                    value={summary?.lastTakenAt ? summary.lastTakenAt.slice(0, 10) : "—"}
                    hint={summary?.lastCustomer ?? "Nothing recorded yet"}
                    icon={Clock}
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <SectionCard
                title={t("The measurement book")}
                description={t("One set of measurements per customer.")}
                icon={Ruler}
                actions={<CountBadge>{rows.length} sets</CountBadge>}
                bodyClassName="p-0"
            >
                <DataTable
                    data={rows}
                    columns={measurementColumns}
                    getRowId={(row) => row._id}
                    isLoading={measurements === undefined}
                    isEmpty={rows.length === 0}
                    emptyTitle={t("Nothing measured yet")}
                    emptyHint={t("Take a customer's measurements and they are kept here, ready for the next job.")}
                    caption={t("Measurements")}
                />
            </SectionCard>

            <FormDialog
                open={recordOpen}
                onOpenChange={(open) => {
                    setRecordOpen(open);
                    if (!open) {
                        setCustomerId("");
                        setValues({ measurements: "", notes: "" });
                    }
                }}
                title={t("Record measurements")}
                description={t("Name the sizes and give the numbers, separated by commas — for example: chest 42, waist 34.")}
                fields={[
                    {
                        name: "customerId",
                        label: "Customer",
                        type: "select",
                        required: true,
                        options: customerRows.map((customer: any) => ({
                            value: customer._id,
                            label: customer.name,
                        })),
                        hint: "The person the sizes belong to.",
                    },
                    {
                        name: "measurements",
                        label: "The sizes",
                        type: "textarea",
                        required: true,
                        full: true,
                        placeholder: "chest 42, waist 34, sleeve 24",
                        hint: "Each size is a name and a number.",
                    },
                    {
                        name: "notes",
                        label: "Notes",
                        type: "textarea",
                        full: true,
                        placeholder: "Anything worth remembering about the fit",
                    },
                ]}
                initialValues={values}
                submitLabel="Save the measurements"
                onSubmit={async (formValues) => {
                    try {
                        // The sizes are read here and turned into numbers —
                        // the server checks each one again before it saves.
                        const parsed: Record<string, number> = {};
                        for (const part of formValues.measurements.split(",")) {
                            const piece = part.trim();
                            if (!piece) continue;
                            const [rawName, rawValue] = piece.split(/\s+/);
                            if (!rawName || rawValue === undefined) {
                                throw new Error(
                                    `Could not read "${piece}" — give each size a name and a number.`
                                );
                            }
                            const value = Number(rawValue);
                            if (!Number.isFinite(value)) {
                                throw new Error(
                                    `The size "${rawName}" needs a number.`
                                );
                            }
                            parsed[rawName.toLowerCase().replace(/\s+/g, "_")] = value;
                        }

                        if (Object.keys(parsed).length === 0) {
                            throw new Error("There is nothing to record.");
                        }

                        const outcome = await saveMeasurement({
                            customerId: formValues.customerId as Id<"customers">,
                            measurements: parsed,
                            notes: formValues.notes || undefined,
                        });
                        toast.success(
                            `Saved for ${outcome.customerName}.`
                        );
                        setRecordOpen(false);
                        setCustomerId("");
                        setValues({ measurements: "", notes: "" });
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not save the measurements."
                        );
                        throw err;
                    }
                }}
            />

            <RecordDetail
                open={detailRow !== null}
                onOpenChange={(open) => {
                    if (!open) setDetailRow(null);
                }}
                title={t("Measurements")}
                description={
                    detailRow
                        ? `${detailRow.customerName} — taken ${detailRow.updatedAt.slice(0, 10)}.`
                        : undefined
                }
                rows={
                    detailRow
                        ? Object.entries(detailRow.measurements).map(
                              ([name, value]) => ({
                                  label: name.replace(/_/g, " "),
                                  value: String(value),
                              })
                          )
                        : []
                }
                footer={
                    detailRow?.notes ? (
                        <p className="text-sm text-muted-foreground">
                            {detailRow.notes}
                        </p>
                    ) : null
                }
            />
        </PageContainer>
    );
}
