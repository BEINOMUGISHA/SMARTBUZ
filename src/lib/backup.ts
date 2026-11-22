/**
 * SMARTBUZ — the backup file, and what is done to it.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The file
 *
 * A backup is one JSON document:
 *
 *   {
 *     "format": "smartbuz-backup/1",
 *     "takenAt": "2026-11-21T18:00:00.000Z",
 *     "businessId": "...",
 *     "business": { ...the business's own settings... },
 *     "tables": { "stocks": [ ... ], "sales": [ ... ], ... }
 *   }
 *
 * It is a plain file: it can be kept on a disk, put in a drawer, or
 * copied to another machine, and it can be read without SMARTBUZ.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The one hard part: ids
 *
 * Convex does not let a document keep an id it was given elsewhere. So a
 * row that comes back from a backup gets a *new* id, and every reference
 * to it — a sale's customer, a payment's loan, the product inside a
 * sale's line — has to be rewritten to the new id.
 *
 * Convex ids are unique across the whole database, so the rewrite does not
 * have to know what an id points at: any string that is one of the ids
 * that were restored is replaced by the id it was restored as. The
 * references inside a document — the ones that are not fields but values
 * in an array of objects — are found by the same walk.
 */

/** The format marker. A file without it is not a backup. */
export const BACKUP_FORMAT = "smartbuz-backup/1";

/** A backup file, as it is read from disk. */
export interface BackupFile {
    format: string;
    takenAt: string;
    businessId: string;
    business?: Record<string, unknown>;
    tables: Record<string, Array<Record<string, unknown>>>;
}

/**
 * Is this a backup file?
 *
 * The check is on the marker and the shape, not on the contents: a file
 * that claims to be a backup but names a table that is not backed up is
 * refused when it is restored, not here.
 */
export function isBackupFile(value: unknown): value is BackupFile {
    if (!value || typeof value !== "object") return false;
    const file = value as Partial<BackupFile>;
    if (file.format !== BACKUP_FORMAT) return false;
    if (typeof file.businessId !== "string") return false;
    if (!file.tables || typeof file.tables !== "object") return false;
    return Object.values(file.tables).every((rows) => Array.isArray(rows));
}

/**
 * The old id of every restored row, and the new id it was restored as.
 */
export type IdMap = Map<string, string>;

/**
 * Rewrite the references in a document.
 *
 * Every string in the document is looked up in the map, at any depth, and
 * replaced when it is one of the ids that were restored. The walk covers
 * the values in arrays and in nested objects, because a reference is
 * often just a string in a list — a sale's lines each carry a stock id.
 */
export function remapDocument(value: unknown, map: IdMap): unknown {
    if (typeof value === "string") {
        return map.get(value) ?? value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => remapDocument(entry, map));
    }
    if (value && typeof value === "object") {
        const source = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(source)) {
            result[key] = remapDocument(entry, map);
        }
        return result;
    }
    return value;
}

/**
 * A document with its system fields taken off.
 *
 * The system fields belong to the deployment the row came from, so they
 * are not written back.
 */
export function withoutSystemFields(
    row: Record<string, unknown>
): Record<string, unknown> {
    const { _id, _creationTime, ...rest } = row;
    void _id;
    void _creationTime;
    return rest;
}

/** The name a backup file is downloaded under. */
export function backupFilename(takenAt: string): string {
    const stamp = takenAt.replace(/[:.]/g, "-").replace(/Z$/, "");
    return `smartbuz-backup-${stamp}.json`;
}
