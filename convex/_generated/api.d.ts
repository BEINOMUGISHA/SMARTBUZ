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
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authJwks from "../authJwks.js";
import type * as banking from "../banking.js";
import type * as branches from "../branches.js";
import type * as businesses from "../businesses.js";
import type * as categories from "../categories.js";
import type * as crypto from "../crypto.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as debug from "../debug.js";
import type * as defaults from "../defaults.js";
import type * as employees from "../employees.js";
import type * as expenses from "../expenses.js";
import type * as http from "../http.js";
import type * as jwks from "../jwks.js";
import type * as loans from "../loans.js";
import type * as migration from "../migration.js";
import type * as platform from "../platform.js";
import type * as promotions from "../promotions.js";
import type * as purchasing from "../purchasing.js";
import type * as rbac from "../rbac.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as seed from "../seed.js";
import type * as serverSecret from "../serverSecret.js";
import type * as shops from "../shops.js";
import type * as stocks from "../stocks.js";
import type * as suppliers from "../suppliers.js";
import type * as tenancy from "../tenancy.js";
import type * as userTypes from "../userTypes.js";
import type * as users from "../users.js";
import type * as utils from "../utils.js";
import type * as verticals_batches from "../verticals/batches.js";
import type * as verticals_members from "../verticals/members.js";
import type * as verticals_operations from "../verticals/operations.js";
import type * as verticals_scheduling from "../verticals/scheduling.js";
import type * as verticals_tax from "../verticals/tax.js";
import type * as warehouses from "../warehouses.js";
import type * as whoami from "../whoami.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityLogs: typeof activityLogs;
  audit: typeof audit;
  auth: typeof auth;
  authJwks: typeof authJwks;
  banking: typeof banking;
  branches: typeof branches;
  businesses: typeof businesses;
  categories: typeof categories;
  crypto: typeof crypto;
  customers: typeof customers;
  dashboard: typeof dashboard;
  debug: typeof debug;
  defaults: typeof defaults;
  employees: typeof employees;
  expenses: typeof expenses;
  http: typeof http;
  jwks: typeof jwks;
  loans: typeof loans;
  migration: typeof migration;
  platform: typeof platform;
  promotions: typeof promotions;
  purchasing: typeof purchasing;
  rbac: typeof rbac;
  reports: typeof reports;
  sales: typeof sales;
  seed: typeof seed;
  serverSecret: typeof serverSecret;
  shops: typeof shops;
  stocks: typeof stocks;
  suppliers: typeof suppliers;
  tenancy: typeof tenancy;
  userTypes: typeof userTypes;
  users: typeof users;
  utils: typeof utils;
  "verticals/batches": typeof verticals_batches;
  "verticals/members": typeof verticals_members;
  "verticals/operations": typeof verticals_operations;
  "verticals/scheduling": typeof verticals_scheduling;
  "verticals/tax": typeof verticals_tax;
  warehouses: typeof warehouses;
  whoami: typeof whoami;
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
