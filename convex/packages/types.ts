/**
 * SMARTBUZ — the shape of an industry package.
 *
 * These types are the contract between the catalogue (what a package says
 * about itself) and everything else in the product (what the business
 * switches on, and what the screens then do).
 *
 * They live in their own file, with no Convex imports, so that:
 *
 *   • the catalogue can be split into files by trade and worked on
 *     independently, and
 *   • a package can be described and tested without pulling the server in.
 */

/** The kind of value a setting holds. */
export type PackageConfigType =
    | "string"
    | "number"
    | "boolean"
    | "enum";

/** One feature inside a package. */
export interface IndustryFeature {
    /** The stable machine name, e.g. `bulk_sales`. */
    key: string;
    label: string;
    /** One sentence on what the feature does for the business. */
    summary: string;
    /** Whether it is on when the package is first enabled. */
    defaultEnabled: boolean;
}

/** One setting a package understands. */
export interface IndustrySetting {
    key: string;
    label: string;
    type: PackageConfigType;
    default?: string | number | boolean;
    /** A sentence of help, shown under the control. */
    help?: string;
    /** The choices, for an `enum` setting. */
    options?: { value: string; label: string }[];
}

/** One industry package. */
export interface IndustryPackageDescriptor {
    /** The stable machine name, e.g. `supermarket`. */
    key: string;
    label: string;
    /** One sentence on what the package is for. */
    summary: string;
    /** The vertical catalogue id this package lines up with. */
    categoryId: string;
    /**
     * The screens this package brings.
     *
     * A package is not a description of a trade — it is the set of things
     * a business can do once it is on. These are the module ids of the
     * screens it adds to the sidebar, and they are the reason a business
     * switches a package on.
     */
    modules: string[];
    /** What the package does for the business. */
    features: IndustryFeature[];
    /** The settings the package understands. */
    settings: IndustrySetting[];
    /** What the package does not do today. */
    limitations: string[];
}
