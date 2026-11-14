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
import type * as auth from "../auth.js";
import type * as banking from "../banking.js";
import type * as businessProfiles from "../businessProfiles.js";
import type * as categories from "../categories.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as debug from "../debug.js";
import type * as expenses from "../expenses.js";
import type * as loans from "../loans.js";
import type * as promotions from "../promotions.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as seed from "../seed.js";
import type * as shops from "../shops.js";
import type * as stocks from "../stocks.js";
import type * as userTypes from "../userTypes.js";
import type * as users from "../users.js";
import type * as utils from "../utils.js";
import type * as verticals_batches from "../verticals/batches.js";
import type * as verticals_members from "../verticals/members.js";
import type * as verticals_operations from "../verticals/operations.js";
import type * as verticals_scheduling from "../verticals/scheduling.js";
import type * as verticals_tax from "../verticals/tax.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLogs: typeof activityLogs;
  auth: typeof auth;
  banking: typeof banking;
  businessProfiles: typeof businessProfiles;
  categories: typeof categories;
  customers: typeof customers;
  dashboard: typeof dashboard;
  debug: typeof debug;
  expenses: typeof expenses;
  loans: typeof loans;
  promotions: typeof promotions;
  reports: typeof reports;
  sales: typeof sales;
  seed: typeof seed;
  shops: typeof shops;
  stocks: typeof stocks;
  userTypes: typeof userTypes;
  users: typeof users;
  utils: typeof utils;
  "verticals/batches": typeof verticals_batches;
  "verticals/members": typeof verticals_members;
  "verticals/operations": typeof verticals_operations;
  "verticals/scheduling": typeof verticals_scheduling;
  "verticals/tax": typeof verticals_tax;
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
