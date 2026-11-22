"use client";

/**
 * SMARTBUZ — telling the person where they are.
 *
 * Two things happen on every client-side navigation that do not happen on
 * a full page load:
 *
 *   - the document title stays whatever it was, so two browser tabs both
 *     say "SMART_BUZ - Smart Inventory & Sales";
 *   - the focus stays where it was, so a person who cannot see the screen
 *     is still on the previous screen while the content has changed.
 *
 * Both are wrong. This component fixes them: the title names the screen
 * that has just arrived, and the focus moves to that screen's heading, so
 * a screen reader reads out the new page instead of silently changing it.
 *
 * The focus is moved after the browser has painted the new page — the
 * heading has to exist before it can be focused.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * The name each screen is known by.
 *
 * A path turned into words is usually wrong — "/purchase-orders" is not
 * "Purchase Orders" as a person would say it, and "/" is not "Dashboard".
 * So the screens that have a name of their own are named here, and the
 * rest fall back to the last segment of the path.
 */
const ROUTE_NAMES: Record<string, string> = {
    "/": "Dashboard",
    "/sales": "Sales",
    "/inventory": "Inventory",
    "/stock": "Products",
    "/customers": "Customers",
    "/suppliers": "Suppliers",
    "/purchase-orders": "Purchase Orders",
    "/reports": "Reports",
    "/finance": "Finance",
    "/loans": "Loans",
    "/expenditures": "Expenditures",
    "/members": "Members",
    "/appointments": "Appointments",
    "/rentals": "Rentals",
    "/rooms": "Rooms",
    "/classes": "Classes",
    "/assets": "Assets",
    "/menu": "Menu",
    "/production": "Production",
    "/batches": "Batches",
    "/deliveries": "Deliveries",
    "/fuel": "Fuel",
    "/shops": "Shops",
    "/service-tickets": "Service Tickets",
    "/prescriptions": "Prescriptions",
    "/attendance": "Attendance",
    "/devices": "Devices",
    "/integrations": "Integrations",
    "/settings": "Settings",
    "/platform": "Platform Console",
    "/subscription": "Subscription",
};

/**
 * The name of the screen a path leads to.
 *
 * A path with a part after the known one — "/reports/sales" — is named
 * after its last segment, because that is the part that tells one screen
 * from another.
 */
function routeName(pathname: string): string {
    if (ROUTE_NAMES[pathname]) return ROUTE_NAMES[pathname];

    const segment = pathname.split("/").filter(Boolean).pop() ?? "";
    if (!segment) return ROUTE_NAMES["/"];

    return segment
        .replace(/-/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function RouteAnnouncer() {
    const pathname = usePathname();

    // The first render is not a navigation. Taking the focus on load would
    // take it away from wherever the browser had put it, which is a
    // courtesy the browser extends and this component should not revoke.
    const isFirstRender = useRef(true);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }

        document.title = `${routeName(pathname)} · SMART_BUZ`;

        // The heading of the new page has to be on the screen before it can
        // be focused, so the work waits for the next frame.
        const frame = requestAnimationFrame(() => {
            const main = document.querySelector("main");
            const heading = main?.querySelector("h1");
            const target = heading ?? main;
            if (!target) return;

            // A heading is not focusable by itself. It is made focusable —
            // but only programmatically, so it is not in the tab order —
            // so that the focus can be placed on it.
            if (!target.hasAttribute("tabindex")) {
                target.setAttribute("tabindex", "-1");
            }
            target.focus({ preventScroll: true });
        });

        return () => cancelAnimationFrame(frame);
    }, [pathname]);

    return null;
}
