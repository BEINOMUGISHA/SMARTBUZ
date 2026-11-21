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
import type * as analytics from "../analytics.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authJwks from "../authJwks.js";
import type * as banking from "../banking.js";
import type * as billing from "../billing.js";
import type * as branches from "../branches.js";
import type * as businesses from "../businesses.js";
import type * as categories from "../categories.js";
import type * as crypto from "../crypto.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as debug from "../debug.js";
import type * as defaults from "../defaults.js";
import type * as emailThrottle from "../emailThrottle.js";
import type * as employees from "../employees.js";
import type * as entitlements from "../entitlements.js";
import type * as expenses from "../expenses.js";
import type * as finance from "../finance.js";
import type * as financeCore from "../financeCore.js";
import type * as http from "../http.js";
import type * as integrations_config from "../integrations/config.js";
import type * as integrations_engine from "../integrations/engine.js";
import type * as integrations_hardware from "../integrations/hardware.js";
import type * as integrations_internal from "../integrations/internal.js";
import type * as integrations_manage from "../integrations/manage.js";
import type * as integrations_messaging from "../integrations/messaging.js";
import type * as integrations_payments from "../integrations/payments.js";
import type * as integrations_providers_cards from "../integrations/providers/cards.js";
import type * as integrations_providers_messaging from "../integrations/providers/messaging.js";
import type * as integrations_providers_mobileMoney from "../integrations/providers/mobileMoney.js";
import type * as integrations_providers_types from "../integrations/providers/types.js";
import type * as integrations_reconciliation from "../integrations/reconciliation.js";
import type * as integrations_registry from "../integrations/registry.js";
import type * as integrations_templates from "../integrations/templates.js";
import type * as integrations_types from "../integrations/types.js";
import type * as integrations_webhooks from "../integrations/webhooks.js";
import type * as jwks from "../jwks.js";
import type * as license from "../license.js";
import type * as loans from "../loans.js";
import type * as loginThrottle from "../loginThrottle.js";
import type * as migration from "../migration.js";
import type * as packages_manage from "../packages/manage.js";
import type * as packages_pharmacy from "../packages/pharmacy.js";
import type * as packages_registry from "../packages/registry.js";
import type * as packages_restaurant from "../packages/restaurant.js";
import type * as packages_supermarket from "../packages/supermarket.js";
import type * as packages_wholesaler from "../packages/wholesaler.js";
import type * as paymentRules from "../paymentRules.js";
import type * as plans from "../plans.js";
import type * as platform from "../platform.js";
import type * as promotions from "../promotions.js";
import type * as purchasing from "../purchasing.js";
import type * as rbac from "../rbac.js";
import type * as reports from "../reports.js";
import type * as saleCompensation from "../saleCompensation.js";
import type * as sales from "../sales.js";
import type * as salesCore from "../salesCore.js";
import type * as seed from "../seed.js";
import type * as serverSecret from "../serverSecret.js";
import type * as shops from "../shops.js";
import type * as stocks from "../stocks.js";
import type * as subscriptionState from "../subscriptionState.js";
import type * as subscriptions from "../subscriptions.js";
import type * as suppliers from "../suppliers.js";
import type * as sync from "../sync.js";
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
  analytics: typeof analytics;
  audit: typeof audit;
  auth: typeof auth;
  authJwks: typeof authJwks;
  banking: typeof banking;
  billing: typeof billing;
  branches: typeof branches;
  businesses: typeof businesses;
  categories: typeof categories;
  crypto: typeof crypto;
  customers: typeof customers;
  dashboard: typeof dashboard;
  debug: typeof debug;
  defaults: typeof defaults;
  emailThrottle: typeof emailThrottle;
  employees: typeof employees;
  entitlements: typeof entitlements;
  expenses: typeof expenses;
  finance: typeof finance;
  financeCore: typeof financeCore;
  http: typeof http;
  "integrations/config": typeof integrations_config;
  "integrations/engine": typeof integrations_engine;
  "integrations/hardware": typeof integrations_hardware;
  "integrations/internal": typeof integrations_internal;
  "integrations/manage": typeof integrations_manage;
  "integrations/messaging": typeof integrations_messaging;
  "integrations/payments": typeof integrations_payments;
  "integrations/providers/cards": typeof integrations_providers_cards;
  "integrations/providers/messaging": typeof integrations_providers_messaging;
  "integrations/providers/mobileMoney": typeof integrations_providers_mobileMoney;
  "integrations/providers/types": typeof integrations_providers_types;
  "integrations/reconciliation": typeof integrations_reconciliation;
  "integrations/registry": typeof integrations_registry;
  "integrations/templates": typeof integrations_templates;
  "integrations/types": typeof integrations_types;
  "integrations/webhooks": typeof integrations_webhooks;
  jwks: typeof jwks;
  license: typeof license;
  loans: typeof loans;
  loginThrottle: typeof loginThrottle;
  migration: typeof migration;
  "packages/manage": typeof packages_manage;
  "packages/pharmacy": typeof packages_pharmacy;
  "packages/registry": typeof packages_registry;
  "packages/restaurant": typeof packages_restaurant;
  "packages/supermarket": typeof packages_supermarket;
  "packages/wholesaler": typeof packages_wholesaler;
  paymentRules: typeof paymentRules;
  plans: typeof plans;
  platform: typeof platform;
  promotions: typeof promotions;
  purchasing: typeof purchasing;
  rbac: typeof rbac;
  reports: typeof reports;
  saleCompensation: typeof saleCompensation;
  sales: typeof sales;
  salesCore: typeof salesCore;
  seed: typeof seed;
  serverSecret: typeof serverSecret;
  shops: typeof shops;
  stocks: typeof stocks;
  subscriptionState: typeof subscriptionState;
  subscriptions: typeof subscriptions;
  suppliers: typeof suppliers;
  sync: typeof sync;
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
