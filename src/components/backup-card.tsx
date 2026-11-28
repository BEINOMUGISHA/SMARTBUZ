"use client";

/**
 * SMARTBUZ — backing the business up, and putting it back.
 *
 * The business's data can be taken out as a file and put back again.
 * Nothing leaves the machine the file is written to, and nothing is
 * written to the server unless somebody with the right role asks for it.
 */

import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

interface BackupCardProps {
    /** The business being backed up. */
    businessId: string;
    /** The business's name, for the file and the messages. */
    businessName: string;
}

export function BackupCard({ businessId, businessName }: BackupCardProps) {
    
    const t = useT();const fileInput = useRef<HTMLInputElement>(null);
    const [isRestoring, setIsRestoring] = useState(false);

    const startBackup = () => {
        // The route answers with a file, so this is a download and not a
        // page: the browser keeps what it is given.
        window.location.href = `/api/backup/export?businessId=${encodeURIComponent(businessId)}`;
        toast.success("Your backup is being prepared", {
            description: "It will download as a JSON file. Keep it somewhere safe.",
        });
    };

    const restoreFromFile = async (file: File) => {
        setIsRestoring(true);
        try {
            const text = await file.text();
            const backup = JSON.parse(text) as unknown;

            const response = await fetch("/api/backup/restore", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ businessId, backup }),
            });
            const result = (await response.json().catch(() => null)) as
                | { error?: string; inserted?: number; rewritten?: number; failed?: number }
                | null;

            if (!response.ok) {
                toast.error(result?.error ?? "The backup could not be restored.");
                return;
            }

            toast.success("The backup has been restored", {
                description: `${result?.inserted ?? 0} row(s) restored into ${businessName}.`,
            });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? `That file could not be read: ${error.message}`
                    : "That file could not be read."
            );
        } finally {
            setIsRestoring(false);
            if (fileInput.current) fileInput.current.value = "";
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-xl font-bold">{t("Backup &amp; Restore")}</CardTitle>
                <CardDescription className="font-medium text-muted-foreground">
                    {t("Take")} {businessName}{t("&apos;s data out as a file, and put a file back into it.")}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                            {t("A restore adds the rows in the file to this business. It does not remove anything, and it does not overwrite a row that is already here — so restore into a business you are happy to add to.")}
                        </p>
                    </div>
                </div>

                <input
                    ref={fileInput}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void restoreFromFile(file);
                    }}
                />
            </CardContent>
            <CardFooter className="gap-2">
                <Button onClick={startBackup}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("Download a backup")}
                </Button>
                <Button
                    variant="outline"
                    disabled={isRestoring}
                    onClick={() => fileInput.current?.click()}
                >
                    {isRestoring ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Upload className="mr-2 h-4 w-4" />
                    )}
                    {t("Restore from a file")}
                </Button>
            </CardFooter>
        </Card>
    );
}
