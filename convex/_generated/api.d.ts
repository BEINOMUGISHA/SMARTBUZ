/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityLogs from "../activityLogs.js";
import type * as banking from "../banking.js";
import type * as categories from "../categories.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as debug from "../debug.js";
import type * as expenses from "../expenses.js";
import type * as loans from "../loans.js";
import type * as packages from "../packages.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as seed from "../seed.js";
import type * as shops from "../shops.js";
import type * as stocks from "../stocks.js";
import type * as userTypes from "../userTypes.js";
import type * as users from "../users.js";
import type * as utils from "../utils.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLogs: typeof activityLogs;
  banking: typeof banking;
  categories: typeof categories;
  customers: typeof customers;
  dashboard: typeof dashboard;
  debug: typeof debug;
  expenses: typeof expenses;
  loans: typeof loans;
  packages: typeof packages;
  reports: typeof reports;
  sales: typeof sales;
  seed: typeof seed;
  shops: typeof shops;
  stocks: typeof stocks;
  userTypes: typeof userTypes;
  users: typeof users;
  utils: typeof utils;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
