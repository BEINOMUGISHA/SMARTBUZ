"use client";

import Link from "next/link";
import { Compass, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The page shown for a URL that does not exist.
 *
 * Without it the server answers with its own generic 404 page, which looks
 * nothing like the rest of the product and offers the operator nowhere to go.
 */
export default function NotFound() {
    return (
        <div
            role="alert"
            className="flex min-h-[70vh] w-full items-center justify-center p-6"
        >
            <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Compass className="h-6 w-6" />
                </div>

                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Page not found
                </p>

                <h1 className="mt-2 text-xl font-bold tracking-tight">
                    There is nothing at this address
                </h1>

                <p className="mt-2 text-sm text-muted-foreground">
                    The screen you asked for does not exist — it may have been
                    renamed, or the link that brought you here may be out of
                    date.
                </p>

                <div className="mt-6 flex justify-center">
                    <Button asChild>
                        <Link href="/">
                            <Home className="mr-2 h-4 w-4" />
                            Go to the dashboard
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
