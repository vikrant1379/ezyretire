import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { usersTable } from "./auth.js";
import { defaultIstNow, istTimestamp } from "./ist-timestamp.js";

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 8, scale: 4 });

export type StoredUiPreferences = {
  investmentOrder?: string[];
  loanOrder?: string[];
  incomeOrder?: string[];
  archivedPlanningCategories?: string[];
  investmentSort?: { by?: string; direction?: string };
  loanSort?: { by?: string; direction?: string };
  incomeSort?: { by?: string; direction?: string };
};

export type StoredFundAllocation = {
  id: string;
  sourceId: string;
  opportunityDate: string;
  investmentDate: string;
  amount: number;
  createdAt: string;
};
export type StoredInvestmentDisposal = {
  id: string;
  name: string;
  purchaseDate?: string;
  saleDate?: string;
  costBasis?: number;
  proceeds?: number;
  assetType?: string;
  eligibleExemption?: number;
};
export const userProfilesTable = pgTable("user_profiles", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  riskPreference: varchar("risk_preference", { length: 24 }).notNull().default("Balanced"),
  uiPreferences: jsonb("ui_preferences")
    .$type<StoredUiPreferences>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  preferredCurrency: varchar("preferred_currency", { length: 3 }).notNull().default("INR"),
  country: varchar("country", { length: 2 }).notNull().default("IN"),
  pan: varchar("pan", { length: 10 }),
  maritalStatus: varchar("marital_status", { length: 32 }),
  city: varchar("city", { length: 80 }),
  state: varchar("state", { length: 80 }),
  pincode: varchar("pincode", { length: 12 }),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  updatedAt: istTimestamp("updated_at")
    .notNull()
    .default(defaultIstNow)
    .$onUpdate(() => new Date()),
});

export const dependentsTable = pgTable(
  "dependents",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    relationship: varchar("relationship", { length: 32 }).notNull(),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    dependentUntilAge: integer("dependent_until_age"),
    notes: text("notes").notNull().default(""),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    updatedAt: istTimestamp("updated_at")
      .notNull()
      .default(defaultIstNow)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("dependents_user_id_idx").on(table.userId)],
);

export const financialAccountsTable = pgTable(
  "financial_accounts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    accountType: varchar("account_type", { length: 24 }).notNull().default("bank"),
    name: varchar("name", { length: 160 }).notNull(),
    institution: varchar("institution", { length: 160 }).notNull().default(""),
    accountLast4: varchar("account_last4", { length: 4 }),
    ifsc: varchar("ifsc", { length: 16 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    updatedAt: istTimestamp("updated_at")
      .notNull()
      .default(defaultIstNow)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("financial_accounts_user_id_idx").on(table.userId)],
);

export const retirementPlansTable = pgTable("retirement_plans", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  targetRetirementAge: integer("target_retirement_age").notNull().default(55),
  lifeExpectancy: integer("life_expectancy").notNull().default(85),
  generalInflationPct: rate("general_inflation_pct").notNull().default("6"),
  salaryGrowthPct: rate("salary_growth_pct").notNull().default("8"),
  monthlyContributionOverride: money("monthly_contribution_override"),
  investSurplus: boolean("invest_surplus").notNull().default(false),
  createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
  updatedAt: istTimestamp("updated_at")
    .notNull()
    .default(defaultIstNow)
    .$onUpdate(() => new Date()),
});

export const incomeSourcesTable = pgTable(
  "income_sources",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    accountId: varchar("account_id").references(() => financialAccountsTable.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 160 }).notNull().default(""),
    type: varchar("type", { length: 40 }).notNull().default("Other"),
    frequency: varchar("frequency", { length: 24 }).notNull().default("Monthly"),
    amount: money("amount").notNull().default("0"),
    date: varchar("date", { length: 40 }).notNull().default(""),
    recurring: boolean("recurring").notNull().default(true),
    annualGrowthRate: rate("annual_growth_rate"),
    incomeEndMode: varchar("income_end_mode", { length: 16 })
      .notNull()
      .default("retirement"),
    incomeEndDate: date("income_end_date", { mode: "string" }),
    notes: text("notes").notNull().default(""),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    updatedAt: istTimestamp("updated_at")
      .notNull()
      .default(defaultIstNow)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("income_sources_user_id_idx").on(table.userId)],
);

export const salaryDetailsTable = pgTable("salary_details", {
  incomeSourceId: varchar("income_source_id")
    .primaryKey()
    .references(() => incomeSourcesTable.id, { onDelete: "cascade" }),
  grossCtc: money("gross_ctc").notNull().default("0"),
  grossCtcMode: varchar("gross_ctc_mode", { length: 16 }).notNull().default("manual"),
  basicPay: money("basic_pay").notNull().default("0"),
  hra: money("hra").notNull().default("0"),
  allowances: money("allowances").notNull().default("0"),
  employeePf: money("employee_pf").notNull().default("0"),
  professionalTax: money("professional_tax").notNull().default("0"),
  tds: money("tds").notNull().default("0"),
  tdsMode: varchar("tds_mode", { length: 16 }).notNull().default("manual"),
  taxRegime: varchar("tax_regime", { length: 8 }),
  financialYear: varchar("financial_year", { length: 16 }),
  taxRuleVersion: varchar("tax_rule_version", { length: 64 }),
  otherDeductions: money("other_deductions").notNull().default("0"),
});

export const loansTable = pgTable(
  "loans",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    accountId: varchar("account_id").references(() => financialAccountsTable.id, {
      onDelete: "set null",
    }),
    type: varchar("type", { length: 32 }).notNull().default("Other"),
    name: varchar("name", { length: 160 }).notNull().default(""),
    sanctionedPrincipal: money("sanctioned_principal").notNull().default("0"),
    outstandingPrincipal: money("outstanding_principal").notNull().default("0"),
    annualInterestRate: rate("annual_interest_rate").notNull().default("0"),
    interestType: varchar("interest_type", { length: 16 }).notNull().default("Floating"),
    totalTenureMonths: integer("total_tenure_months").notNull().default(0),
    startDate: varchar("start_date", { length: 40 }).notNull().default(""),
    emi: money("emi").notNull().default("0"),
    prepayments: money("prepayments").notNull().default("0"),
    notes: text("notes").notNull().default(""),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    updatedAt: istTimestamp("updated_at")
      .notNull()
      .default(defaultIstNow)
      .$onUpdate(() => new Date()),
  },
  (table) => [index("loans_user_id_idx").on(table.userId)],
);

export const expensesTable = pgTable(
  "expenses",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    loanId: varchar("loan_id").references(() => loansTable.id, { onDelete: "set null" }),
    accountId: varchar("account_id").references(() => financialAccountsTable.id, {
      onDelete: "set null",
    }),
    date: varchar("date", { length: 40 }).notNull().default(""),
    amount: money("amount").notNull().default("0"),
    category: varchar("category", { length: 80 }).notNull().default(""),
    merchant: varchar("merchant", { length: 160 }).notNull().default(""),
    paymentMethod: varchar("payment_method", { length: 80 }).notNull().default(""),
    note: text("note").notNull().default(""),
    reimbursable: boolean("reimbursable").notNull().default(false),
    recurring: boolean("recurring").notNull().default(false),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    updatedAt: istTimestamp("updated_at")
      .notNull()
      .default(defaultIstNow)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("expenses_user_date_idx").on(table.userId, table.date),
    index("expenses_user_category_idx").on(table.userId, table.category),
  ],
);

export type StoredBudgetSchedule = {
  id: string;
  amount: number;
  startMonth: string;
  endMode: "custom" | "retirement" | "lifelong";
  endMonth?: string;
  note?: string;
};

export type StoredBudgetDetails = {
  schedules?: StoredBudgetSchedule[];
};

export const budgetsTable = pgTable(
  "budgets",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 80 }).notNull(),
    monthlyLimit: money("monthly_limit").notNull().default("0"),
    details: jsonb("details")
      .$type<StoredBudgetDetails>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: istTimestamp("updated_at")
      .notNull()
      .default(defaultIstNow)
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("budgets_user_category_unique").on(table.userId, table.category)],
);

export const investmentsTable = pgTable(
  "investments",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    accountId: varchar("account_id").references(() => financialAccountsTable.id, {
      onDelete: "set null",
    }),
    linkedIncomeSourceId: varchar("linked_income_source_id").references(
      () => incomeSourcesTable.id,
      { onDelete: "set null" },
    ),
    name: varchar("name", { length: 160 }).notNull().default(""),
    assetClass: varchar("asset_class", { length: 40 }).notNull().default("Other"),
    investedAmount: money("invested_amount").notNull().default("0"),
    currentValue: money("current_value").notNull().default("0"),
    quantity: rate("quantity"),
    averageBuyPrice: money("average_buy_price"),
    monthlyContribution: money("monthly_contribution"),
    contributionStartDate: date("contribution_start_date", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_DATE`),
    contributionEndMode: varchar("contribution_end_mode", { length: 16 })
      .notNull()
      .default("retirement"),
    contributionEndDate: date("contribution_end_date", { mode: "string" }),
    autoManagedContribution: boolean("auto_managed_contribution").notNull().default(false),
    expectedReturn: rate("expected_return").notNull().default("0"),
    ticker: varchar("ticker", { length: 40 }),
    folio: varchar("folio", { length: 80 }),
    institution: varchar("institution", { length: 160 }),
    interestRate: rate("interest_rate"),
    accountNumber: varchar("account_number", { length: 80 }),
    maturityDate: varchar("maturity_date", { length: 40 }),
    notes: text("notes").notNull().default(""),
    details: jsonb("details")
      .$type<StoredInvestmentDetails>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: istTimestamp("created_at").notNull().default(defaultIstNow),
    updatedAt: istTimestamp("updated_at")
      .notNull()
      .default(defaultIstNow)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("investments_user_id_idx").on(table.userId),
    index("investments_user_asset_class_idx").on(table.userId, table.assetClass),
  ],
);

export type StoredInvestmentDetails = {
  unit?: string;
  location?: string;
  area?: string;
  fundAllocations?: StoredFundAllocation[];
  disposals?: StoredInvestmentDisposal[];
};
