"use client";

import * as React from "react";

/**
 * A value that only changes after the person stops typing.
 *
 * The command palette searches the server, so every keystroke would be a
 * request. This waits until the typing pauses.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
    const [debounced, setDebounced] = React.useState(value);

    React.useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}
