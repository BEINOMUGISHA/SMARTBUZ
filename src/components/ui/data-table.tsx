"use client";

/**
 * SMART_BUZ — the data table.
 *
 * The product had four different table styles, no sorting anywhere, no bulk
 * selection anywhere, and pagination written out about twenty times by hand.
 * This is the one table.
 *
 * It is deliberately client-side: it receives the rows it is going to show
 * and sorts, filters and pages them itself. Pages that read from the server
 * in pages (Convex's `usePaginatedQuery`) pass `manual` and keep control of
 * the page number.
 *
 * What it gives every list screen for free:
 *
 *   • sorting, with the sort state announced to assistive technology
 *   • row selection, with a select-all that reflects the page
 *   • pagination with a page-size control and a "showing X of Y" count
 *   • a sticky header, a hover row, zebra-free quiet borders
 *   • money and numbers aligned and tabular, so the digits line up
 *   • loading, empty and error states that look the same everywhere
 */

import * as React from "react";
import {
    ArrowDown,
    ArrowUp,
    ChevronLeft,
    ChevronRight,
    ChevronsUpDown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

/* ────────────────────────────── column type ──────────────────────────── */

export interface DataTableColumn<T> {
    /** Stable id. Used for the sort key, so it must be unique in the table. */
    id: string;
    /** The column heading. */
    header: React.ReactNode;
    /**
     * How the column's raw value is read for sorting and for searching.
     * Omit it when the column is not sortable and holds no plain value.
     */
    accessor?: (row: T) => unknown;
    /** How the cell is rendered. Defaults to the accessor's value. */
    cell?: (row: T) => React.ReactNode;
    /** Sorting is on by default when an accessor is present. */
    sortable?: boolean;
    /** "right" for money and quantities, "center" for status. */
    align?: "left" | "center" | "right";
    /** A fixed width, e.g. "9rem". */
    width?: string;
    /** Hides the column below the given breakpoint. */
    hideBelow?: "sm" | "md" | "lg" | "xl";
    /** Excluded from the text used to search the table. */
    excludeFromSearch?: boolean;
}

export type SortDirection = "asc" | "desc";

export interface DataTableProps<T> {
    data: T[];
    columns: DataTableColumn<T>[];
    /** A stable id per row. Used as the React key and for selection. */
    getRowId: (row: T, index: number) => string;
    /** Shows the row count and the "showing X of Y" line under the table. */
    caption?: React.ReactNode;
    isLoading?: boolean;
    /** Rows of skeleton to show while loading. */
    loadingRows?: number;
    isEmpty?: boolean;
    emptyTitle?: string;
    emptyHint?: React.ReactNode;
    emptyAction?: React.ReactNode;
    error?: unknown;
    onRetry?: () => void;

    /** Enables the checkbox column and bulk actions. */
    selectable?: boolean;
    /** The selected row ids. */
    selectedIds?: string[];
    onSelectedIdsChange?: (ids: string[]) => void;
    /** Rendered above the table, next to the selection count. */
    bulkActions?: (selectedIds: string[]) => React.ReactNode;

    /** Rows per page. 0 turns pagination off. */
    pageSize?: number;
    /** The server already paged the data, so the table must not page it again. */
    manual?: boolean;
    /** The page the server is on, when `manual` is set. */
    manualPage?: number;
    /** How many pages the server has, when `manual` is set. */
    manualPageCount?: number;
    /** Total rows the server has, when `manual` is set. */
    manualTotal?: number;
    onManualPageChange?: (page: number) => void;

    /** The initial sort. */
    defaultSort?: { id: string; direction: SortDirection };
    /** Rows are searchable through this term. */
    searchTerm?: string;
    /** Called when the user picks a page size. */
    onPageSizeChange?: (size: number) => void;

    /** Clicking a row calls this. */
    onRowClick?: (row: T) => void;
    /** Sticks the header to the top of the scrolling container. */
    stickyHeader?: boolean;
    /** Compact rows. */
    dense?: boolean;
    /** A caption for assistive technology. */
    ariaLabel?: string;
    className?: string;
}

const ALIGN_CLASS = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
} as const;

const HIDE_BELOW = {
    sm: "hidden sm:table-cell",
    md: "hidden md:table-cell",
    lg: "hidden lg:table-cell",
    xl: "hidden xl:table-cell",
} as const;

/* ─────────────────────────────── helpers ──────────────────────────────── */

function compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;

    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "boolean" && typeof b === "boolean") {
        return Number(a) - Number(b);
    }

    const asString = String(a).toLowerCase();
    const bsString = String(b).toLowerCase();

    // A column that holds dates should sort by date, not by the text of it.
    const aTime = Date.parse(asString);
    const bTime = Date.parse(bsString);
    const aIsDate = !Number.isNaN(aTime) && /\d{4}-\d{2}-\d{2}/.test(asString);
    const bIsDate = !Number.isNaN(bTime) && /\d{4}-\d{2}-\d{2}/.test(bsString);
    if (aIsDate && bIsDate) return aTime - bTime;

    return asString.localeCompare(bsString, undefined, { numeric: true });
}

/* ────────────────────────────── the table ─────────────────────────────── */

export function DataTable<T>({
    data,
    columns,
    getRowId,
    caption,
    isLoading,
    loadingRows = 6,
    isEmpty,
    emptyTitle = "No records to show",
    emptyHint,
    emptyAction,
    error,
    onRetry,
    selectable = false,
    selectedIds,
    onSelectedIdsChange,
    bulkActions,
    pageSize = 25,
    manual = false,
    manualPage = 1,
    manualPageCount,
    manualTotal,
    onManualPageChange,
    defaultSort,
    searchTerm,
    onPageSizeChange,
    onRowClick,
    stickyHeader = true,
    dense = false,
    ariaLabel,
    className,
}: DataTableProps<T>) {
    
    const t = useT();const [sort, setSort] = React.useState<{
        id: string;
        direction: SortDirection;
    } | null>(defaultSort ?? null);
    const [page, setPage] = React.useState(1);
    const [rowsPerPage, setRowsPerPage] = React.useState(pageSize);

    React.useEffect(() => {
        setRowsPerPage(pageSize);
    }, [pageSize]);

    // ── Selection ──────────────────────────────────────────────────────
    const [internalSelected, setInternalSelected] = React.useState<string[]>([]);
    const isControlled = selectedIds !== undefined;
    const selection = isControlled ? selectedIds : internalSelected;

    const setSelection = React.useCallback(
        (ids: string[]) => {
            if (!isControlled) setInternalSelected(ids);
            onSelectedIdsChange?.(ids);
        },
        [isControlled, onSelectedIdsChange]
    );

    const rowIds = React.useMemo(
        () => data.map((row, i) => getRowId(row, i)),
        [data, getRowId]
    );

    const allOnPageSelected =
        rowIds.length > 0 && rowIds.every((id) => selection.includes(id));
    const someOnPageSelected = rowIds.some((id) => selection.includes(id));

    const toggleAllOnPage = (checked: boolean) => {
        if (checked) {
            setSelection(Array.from(new Set([...selection, ...rowIds])));
        } else {
            const onPage = new Set(rowIds);
            setSelection(selection.filter((id) => !onPage.has(id)));
        }
    };

    const toggleRow = (id: string, checked: boolean) => {
        if (checked) {
            setSelection([...selection, id]);
        } else {
            setSelection(selection.filter((x) => x !== id));
        }
    };

    // ── Sorting ────────────────────────────────────────────────────────
    const sortedData = React.useMemo(() => {
        if (!sort) return data;
        const column = columns.find((c) => c.id === sort.id);
        if (!column?.accessor) return data;

        const factor = sort.direction === "asc" ? 1 : -1;
        return [...data].sort((a, b) => {
            const result = compareValues(column.accessor!(a), column.accessor!(b));
            return result === 0 ? 0 : result * factor;
        });
    }, [data, columns, sort]);

    const toggleSort = (column: DataTableColumn<T>) => {
        if (column.sortable === false || !column.accessor) return;
        setSort((current) => {
            if (current?.id !== column.id) {
                return { id: column.id, direction: "asc" };
            }
            if (current.direction === "asc") {
                return { id: column.id, direction: "desc" };
            }
            return null;
        });
    };

    // ── Searching ──────────────────────────────────────────────────────
    const searchedData = React.useMemo(() => {
        const term = searchTerm?.trim().toLowerCase();
        if (!term) return sortedData;

        return sortedData.filter((row) =>
            columns.some((column) => {
                if (column.excludeFromSearch) return false;
                if (!column.accessor) return false;
                const value = column.accessor(row);
                if (value === null || value === undefined) return false;
                return String(value).toLowerCase().includes(term);
            })
        );
    }, [sortedData, columns, searchTerm]);

    // ── Pagination ─────────────────────────────────────────────────────
    const totalRows = manual ? (manualTotal ?? data.length) : searchedData.length;
    const totalPages = manual
        ? (manualPageCount ?? 1)
        : rowsPerPage > 0
          ? Math.max(1, Math.ceil(searchedData.length / rowsPerPage))
          : 1;
    const currentPage = manual ? manualPage : page;

    React.useEffect(() => {
        if (!manual && page > totalPages) setPage(1);
    }, [page, totalPages, manual]);

    const pagedData = manual
        ? searchedData
        : rowsPerPage > 0
          ? searchedData.slice(
                (currentPage - 1) * rowsPerPage,
                currentPage * rowsPerPage
            )
          : searchedData;

    const goToPage = (next: number) => {
        const clamped = Math.min(Math.max(next, 1), totalPages);
        if (manual) {
            onManualPageChange?.(clamped);
        } else {
            setPage(clamped);
        }
    };

    const from = totalRows === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1;
    const to = manual
        ? Math.min(currentPage * rowsPerPage, totalRows)
        : Math.min(currentPage * rowsPerPage, totalRows);

    // ── Render ─────────────────────────────────────────────────────────
    const showEmpty = !isLoading && !error && (isEmpty ?? searchedData.length === 0);

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            {selectable && selection.length > 0 && bulkActions ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
                    <p className="text-sm font-medium text-foreground">
                        {selection.length}{" "}
                        {selection.length === 1 ? "row" : "rows"} selected
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        {bulkActions(selection)}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelection([])}
                        >
                            {t("Clear")}
                        </Button>
                    </div>
                </div>
            ) : null}

            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs">
                <div className="overflow-x-auto">
                    <Table aria-label={ariaLabel}>
                        <TableHeader
                            className={cn(
                                stickyHeader && "sticky top-0 z-sticky bg-card"
                            )}
                        >
                            <TableRow className="hover:bg-transparent">
                                {selectable ? (
                                    <TableHead className="w-10 pl-4">
                                        <Checkbox
                                            checked={
                                                allOnPageSelected
                                                    ? true
                                                    : someOnPageSelected
                                                      ? "indeterminate"
                                                      : false
                                            }
                                            onCheckedChange={(checked) =>
                                                toggleAllOnPage(checked === true)
                                            }
                                            aria-label={t("Select all rows on this page")}
                                        />
                                    </TableHead>
                                ) : null}

                                {columns.map((column) => {
                                    const isSorted = sort?.id === column.id;
                                    const canSort =
                                        column.sortable !== false &&
                                        Boolean(column.accessor);

                                    return (
                                        <TableHead
                                            key={column.id}
                                            style={column.width ? { width: column.width } : undefined}
                                            className={cn(
                                                ALIGN_CLASS[column.align ?? "left"],
                                                column.hideBelow &&
                                                    HIDE_BELOW[column.hideBelow],
                                                canSort && "cursor-pointer select-none"
                                            )}
                                            aria-sort={
                                                isSorted
                                                    ? sort.direction === "asc"
                                                        ? "ascending"
                                                        : "descending"
                                                    : canSort
                                                      ? "none"
                                                      : undefined
                                            }
                                            onClick={
                                                canSort
                                                    ? () => toggleSort(column)
                                                    : undefined
                                            }
                                        >
                                            <span
                                                className={cn(
                                                    "inline-flex items-center gap-1.5",
                                                    column.align === "right" &&
                                                        "flex-row-reverse"
                                                )}
                                            >
                                                {typeof column.header === "string"
                                                    ? t(column.header)
                                                    : column.header}
                                                {canSort ? (
                                                    isSorted ? (
                                                        sort.direction === "asc" ? (
                                                            <ArrowUp className="size-3.5 text-primary" />
                                                        ) : (
                                                            <ArrowDown className="size-3.5 text-primary" />
                                                        )
                                                    ) : (
                                                        <ChevronsUpDown className="size-3.5 text-muted-foreground/50" />
                                                    )
                                                ) : null}
                                            </span>
                                        </TableHead>
                                    );
                                })}
                            </TableRow>
                        </TableHeader>

                        <TableBody>
                            {isLoading
                                ? Array.from({ length: loadingRows }).map((_, i) => (
                                      <TableRow key={`skeleton-${i}`}>
                                          {selectable ? (
                                              <TableCell className="pl-4">
                                                  <Skeleton className="size-4" />
                                              </TableCell>
                                          ) : null}
                                          {columns.map((column) => (
                                              <TableCell
                                                  key={column.id}
                                                  className={cn(
                                                      column.hideBelow &&
                                                          HIDE_BELOW[column.hideBelow]
                                                  )}
                                              >
                                                  <Skeleton className="h-4 w-full max-w-[8rem]" />
                                              </TableCell>
                                          ))}
                                      </TableRow>
                                  ))
                                : error
                                  ? null
                                  : pagedData.map((row, index) => {
                                        const id = getRowId(row, index);
                                        const isSelected = selection.includes(id);

                                        return (
                                            <TableRow
                                                key={id}
                                                data-state={
                                                    isSelected ? "selected" : undefined
                                                }
                                                className={cn(
                                                    onRowClick &&
                                                        "cursor-pointer hover:bg-muted/50",
                                                    isSelected && "bg-primary/5"
                                                )}
                                                onClick={
                                                    onRowClick
                                                        ? (event) => {
                                                              // A click on the checkbox or on a
                                                              // button inside the row belongs to
                                                              // that control, not to the row.
                                                              const target =
                                                                  event.target as HTMLElement;
                                                              if (
                                                                  target.closest(
                                                                      "button, a, input, [role=checkbox], [role=button]"
                                                              )
                                                                  ) {
                                                                  return;
                                                              }
                                                              onRowClick(row);
                                                          }
                                                        : undefined
                                                }
                                            >
                                                {selectable ? (
                                                    <TableCell className="pl-4">
                                                        <Checkbox
                                                            checked={isSelected}
                                                            onCheckedChange={(checked) =>
                                                                toggleRow(
                                                                    id,
                                                                    checked === true
                                                                )
                                                            }
                                                            aria-label={t("Select row {0}", {
            0: id,
        })}
                                                        />
                                                    </TableCell>
                                                ) : null}

                                                {columns.map((column) => (
                                                    <TableCell
                                                        key={column.id}
                                                        className={cn(
                                                            ALIGN_CLASS[
                                                                column.align ?? "left"
                                                            ],
                                                            column.hideBelow &&
                                                                HIDE_BELOW[
                                                                    column.hideBelow
                                                                ],
                                                            column.align === "right" &&
                                                                "tabular-nums"
                                                        )}
                                                    >
                                                        {column.cell
                                                            ? column.cell(row)
                                                            : (() => {
                                                                  const value =
                                                                      column.accessor?.(
                                                                          row
                                                                      );
                                                                  if (
                                                                      value === null ||
                                                                      value === undefined
                                                                  ) {
                                                                      return "—";
                                                                  }
                                                                  if (
                                                                      typeof value ===
                                                                      "boolean"
                                                                  ) {
                                                                      return value
                                                                          ? "Yes"
                                                                          : "No";
                                                                  }
                                                                  if (
                                                                      typeof value ===
                                                                      "object"
                                                                  ) {
                                                                      return String(
                                                                          JSON.stringify(
                                                                              value
                                                                          )
                                                                      );
                                                                  }
                                                                  return String(
                                                                      value
                                                                  );
                                                              })()}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        );
                                    })}
                        </TableBody>
                    </Table>
                </div>

                {showEmpty ? (
                    <div className="flex flex-col items-center justify-center gap-3 border-t border-border/60 px-6 py-14 text-center">
                        <p className="text-sm font-semibold text-foreground">
                            {emptyTitle}
                        </p>
                        {emptyHint ? (
                            <p className="max-w-md text-sm text-muted-foreground">
                                {emptyHint}
                            </p>
                        ) : null}
                        {emptyAction}
                    </div>
                ) : null}

                {error ? (
                    <div
                        role="alert"
                        className="flex flex-col items-start gap-3 border-t border-border/60 p-4"
                    >
                        <p className="text-sm font-semibold text-danger">
                            {t("This could not be loaded")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {error instanceof Error
                                ? error.message
                                : "Something went wrong."}
                        </p>
                        {onRetry ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onRetry}
                            >
                                {t("Try again")}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {caption ? (
                <p className="text-xs text-muted-foreground">{caption}</p>
            ) : null}

            {!isLoading && !error && (manual ? totalPages > 1 : searchedData.length > 0) ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground tabular-nums">
                        {t("Showing")} <span className="font-medium text-foreground">{from}</span>–
                        <span className="font-medium text-foreground">{to}</span> of{" "}
                        <span className="font-medium text-foreground">{totalRows}</span>
                    </p>

                    <div className="flex items-center gap-3">
                        {!manual && onPageSizeChange ? (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                    {t("Rows")}
                                </span>
                                <Select
                                    value={String(rowsPerPage)}
                                    onValueChange={(value) => {
                                        const size = Number(value);
                                        setRowsPerPage(size);
                                        setPage(1);
                                        onPageSizeChange(size);
                                    }}
                                >
                                    <SelectTrigger className="h-8 w-[4.5rem] text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[10, 25, 50, 100].map((size) => (
                                            <SelectItem
                                                key={size}
                                                value={String(size)}
                                            >
                                                {size}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}

                        {totalPages > 1 ? (
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => goToPage(currentPage - 1)}
                                    disabled={currentPage <= 1}
                                    aria-label={t("Previous page")}
                                >
                                    <ChevronLeft className="size-4" />
                                </Button>
                                <span className="min-w-[6.5rem] text-center text-xs text-muted-foreground tabular-nums">
                                    {t("Page")} {currentPage} of {totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => goToPage(currentPage + 1)}
                                    disabled={currentPage >= totalPages}
                                    aria-label={t("Next page")}
                                >
                                    <ChevronRight className="size-4" />
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
