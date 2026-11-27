import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const marketTimestamp = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const price = (name: string) => numeric(name, { precision: 30, scale: 12 });
const quantity = (name: string) => numeric(name, { precision: 36, scale: 18 });

/** User identity for authenticated workspaces. Passwords are scrypt hashes only. */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  trialUsedAt: marketTimestamp("trial_used_at"),
  createdAt: marketTimestamp("created_at").notNull().defaultNow(),
  updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  check("users_role_check", sql`${table.role} in ('owner', 'admin', 'user')`),
  uniqueIndex("users_email_uidx").on(table.email),
]);

/** Opaque bearer tokens are stored as SHA-256 digests and can be revoked per session. */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: marketTimestamp("expires_at").notNull(),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("user_sessions_user_id_idx").on(table.userId), index("user_sessions_expires_at_idx").on(table.expiresAt)],
);

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    currency: text("currency").notNull().default("NGN"),
    amountMinor: integer("amount_minor").notNull(),
    interval: text("interval").notNull().default("month"),
    trialDays: integer("trial_days").notNull().default(0),
    features: jsonb("features").$type<Record<string, boolean | number>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
    updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("subscription_plans_amount_check", sql`${table.amountMinor} >= 0`),
    check("subscription_plans_interval_check", sql`${table.interval} = 'month'`),
    check("subscription_plans_trial_days_check", sql`${table.trialDays} between 0 and 30`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull().references(() => subscriptionPlans.id),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("free"),
    currentPeriodStart: marketTimestamp("current_period_start"),
    currentPeriodEnd: marketTimestamp("current_period_end"),
    trialEndsAt: marketTimestamp("trial_ends_at"),
    graceEndsAt: marketTimestamp("grace_ends_at"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: marketTimestamp("canceled_at"),
    providerCustomerCode: text("provider_customer_code"),
    providerSubscriptionCode: text("provider_subscription_code"),
    providerEmailTokenCiphertext: text("provider_email_token_ciphertext"),
    providerEmailTokenNonce: text("provider_email_token_nonce"),
    providerEmailTokenTag: text("provider_email_token_tag"),
    pendingPlanId: text("pending_plan_id").references(() => subscriptionPlans.id),
    pendingPlanEffectiveAt: marketTimestamp("pending_plan_effective_at"),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
    updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("subscriptions_status_check", sql`${table.status} in ('trialing', 'active', 'past_due', 'canceled', 'expired')`),
    check("subscriptions_source_check", sql`${table.source} in ('free', 'paystack', 'trial')`),
    uniqueIndex("subscriptions_user_uidx").on(table.userId),
    uniqueIndex("subscriptions_provider_subscription_uidx").on(table.providerSubscriptionCode),
    index("subscriptions_status_period_end_idx").on(table.status, table.currentPeriodEnd),
    index("subscriptions_plan_status_idx").on(table.planId, table.status),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    planId: text("plan_id").notNull().references(() => subscriptionPlans.id),
    provider: text("provider").notNull().default("paystack"),
    reference: text("reference").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("pending"),
    paidAt: marketTimestamp("paid_at"),
    receiptUrl: text("receipt_url"),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
    updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("payments_status_check", sql`${table.status} in ('pending', 'success', 'failed', 'refunded')`),
    check("payments_amount_check", sql`${table.amountMinor} >= 0`),
    uniqueIndex("payments_reference_uidx").on(table.reference),
    uniqueIndex("payments_provider_transaction_uidx").on(table.provider, table.providerTransactionId),
    index("payments_user_created_idx").on(table.userId, table.createdAt),
    index("payments_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull().default("paystack"),
    eventKey: text("event_key").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: marketTimestamp("received_at").notNull().defaultNow(),
    processedAt: marketTimestamp("processed_at"),
  },
  (table) => [
    uniqueIndex("payment_webhook_events_provider_key_uidx").on(table.provider, table.eventKey),
    index("payment_webhook_events_received_idx").on(table.receivedAt),
  ],
);

export const complimentarySlots = pgTable(
  "complimentary_slots",
  {
    slotNumber: integer("slot_number").primaryKey(),
    founderSlot: boolean("founder_slot").notNull().default(false),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    assignedAt: marketTimestamp("assigned_at"),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("complimentary_slots_number_check", sql`${table.slotNumber} between 1 and 5`),
    check("complimentary_slots_founder_check", sql`(${table.slotNumber} = 1 and ${table.founderSlot}) or (${table.slotNumber} between 2 and 5 and not ${table.founderSlot})`),
    uniqueIndex("complimentary_slots_user_uidx").on(table.userId),
  ],
);

export const complimentaryAccountEvents = pgTable(
  "complimentary_account_events",
  {
    id: serial("id").primaryKey(),
    slotNumber: integer("slot_number").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetEmail: text("target_email").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("complimentary_account_events_action_check", sql`${table.action} in ('founder_provisioned', 'assigned', 'revoked')`),
    index("complimentary_account_events_created_idx").on(table.createdAt),
    index("complimentary_account_events_slot_created_idx").on(table.slotNumber, table.createdAt),
  ],
);

export const revenueLedger = pgTable(
  "revenue_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    revenueType: text("revenue_type").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("verified"),
    realizedProfit: numeric("realized_profit", { precision: 30, scale: 12 }),
    highWaterMarkBefore: numeric("high_water_mark_before", { precision: 30, scale: 12 }),
    highWaterMarkAfter: numeric("high_water_mark_after", { precision: 30, scale: 12 }),
    userConsentAt: marketTimestamp("user_consent_at"),
    auditDetails: jsonb("audit_details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("revenue_ledger_type_check", sql`${table.revenueType} in ('subscription', 'performance_fee')`),
    check("revenue_ledger_status_check", sql`${table.status} in ('verified', 'pending', 'reversed')`),
    check("revenue_ledger_amount_check", sql`${table.amountMinor} >= 0`),
    uniqueIndex("revenue_ledger_payment_uidx").on(table.paymentId),
    index("revenue_ledger_type_created_idx").on(table.revenueType, table.createdAt),
  ],
);

/** Exchange credentials are encrypted by the application before persistence. */
export const exchangeConnections = pgTable(
  "exchange_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    exchange: text("exchange").notNull(),
    label: text("label").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    apiSecretCiphertext: text("api_secret_ciphertext").notNull(),
    // The existing nonce/tag pair protects the API key; the second pair protects the secret.
    encryptionNonce: text("encryption_nonce").notNull(),
    encryptionTag: text("encryption_tag").notNull(),
    apiSecretNonce: text("api_secret_nonce").notNull(),
    apiSecretTag: text("api_secret_tag").notNull(),
    encryptionVersion: integer("encryption_version").notNull().default(1),
    permissions: text("permissions").notNull().default("read_only"),
    status: text("status").notNull().default("pending"),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
    updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("exchange_connections_read_only_permissions_check", sql`${table.permissions} = 'read_only'`),
    index("exchange_connections_user_id_idx").on(table.userId),
    uniqueIndex("exchange_connections_user_exchange_label_uidx").on(table.userId, table.exchange, table.label),
  ],
);

/** A Windows MT5 bridge is provisioned out-of-band; only its token digest is stored. */
export const mt5Bridges = pgTable(
  "mt5_bridges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("offline"),
    terminalVersion: text("terminal_version"),
    lastHeartbeatAt: marketTimestamp("last_heartbeat_at"),
    lastError: text("last_error"),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
    updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("mt5_bridges_status_check", sql`${table.status} in ('online', 'offline', 'degraded')`),
    uniqueIndex("mt5_bridges_token_hash_uidx").on(table.tokenHash),
    uniqueIndex("mt5_bridges_owner_name_uidx").on(table.ownerUserId, table.name),
    index("mt5_bridges_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);

/** Broker login identifiers are private backend data and are never returned by account APIs. */
export const mt5Accounts = pgTable(
  "mt5_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bridgeId: uuid("bridge_id").notNull().references(() => mt5Bridges.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    login: text("login").notNull(),
    server: text("server").notNull(),
    broker: text("broker").notNull().default(""),
    accountType: text("account_type").notNull().default("unknown"),
    currency: text("currency").notNull().default(""),
    leverage: integer("leverage").notNull().default(0),
    balance: numeric("balance", { precision: 30, scale: 12 }).notNull().default("0"),
    equity: numeric("equity", { precision: 30, scale: 12 }).notNull().default("0"),
    freeMargin: numeric("free_margin", { precision: 30, scale: 12 }).notNull().default("0"),
    usedMargin: numeric("used_margin", { precision: 30, scale: 12 }).notNull().default("0"),
    marginLevel: numeric("margin_level", { precision: 30, scale: 12 }),
    floatingProfit: numeric("floating_profit", { precision: 30, scale: 12 }).notNull().default("0"),
    dayStartEquity: numeric("day_start_equity", { precision: 30, scale: 12 }).notNull().default("0"),
    dayStartDate: text("day_start_date").notNull().default(""),
    peakEquity: numeric("peak_equity", { precision: 30, scale: 12 }).notNull().default("0"),
    tradingAllowed: boolean("trading_allowed").notNull().default(false),
    expertAllowed: boolean("expert_allowed").notNull().default(false),
    connected: boolean("connected").notNull().default(false),
    lastSyncAt: marketTimestamp("last_sync_at"),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
    updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("mt5_accounts_type_check", sql`${table.accountType} in ('demo', 'live', 'contest', 'unknown')`),
    uniqueIndex("mt5_accounts_bridge_server_login_uidx").on(table.bridgeId, table.server, table.login),
    index("mt5_accounts_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
  ],
);

/** One broker symbol mapping per connected account; broker symbols are not globally stable. */
export const mt5Instruments = pgTable(
  "mt5_instruments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull().references(() => mt5Accounts.id, { onDelete: "cascade" }),
    brokerSymbol: text("broker_symbol").notNull(),
    canonicalSymbol: text("canonical_symbol").notNull(),
    assetClass: text("asset_class").notNull().default("other"),
    description: text("description").notNull().default(""),
    baseCurrency: text("base_currency"),
    quoteCurrency: text("quote_currency"),
    digits: integer("digits").notNull(),
    point: numeric("point", { precision: 30, scale: 18 }).notNull(),
    tickSize: numeric("tick_size", { precision: 30, scale: 18 }).notNull(),
    tickValue: numeric("tick_value", { precision: 30, scale: 12 }).notNull(),
    contractSize: numeric("contract_size", { precision: 30, scale: 12 }).notNull(),
    volumeMin: numeric("volume_min", { precision: 30, scale: 12 }).notNull(),
    volumeMax: numeric("volume_max", { precision: 30, scale: 12 }).notNull(),
    volumeStep: numeric("volume_step", { precision: 30, scale: 12 }).notNull(),
    stopsLevelPoints: integer("stops_level_points").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: marketTimestamp("updated_at").notNull(),
  },
  (table) => [
    check("mt5_instruments_asset_class_check", sql`${table.assetClass} in ('forex', 'metal', 'index', 'commodity', 'crypto', 'other')`),
    uniqueIndex("mt5_instruments_account_symbol_uidx").on(table.accountId, table.brokerSymbol),
    index("mt5_instruments_canonical_symbol_idx").on(table.canonicalSymbol),
  ],
);

/** Tick prices retain the source instrument and broker timestamp for reconciliation. */
export const mt5MarketTicks = pgTable(
  "mt5_market_ticks",
  {
    id: serial("id").primaryKey(),
    instrumentId: uuid("instrument_id").notNull().references(() => mt5Instruments.id, { onDelete: "cascade" }),
    sourceTickId: text("source_tick_id").notNull(),
    tickTime: marketTimestamp("tick_time").notNull(),
    bid: numeric("bid", { precision: 30, scale: 12 }).notNull(),
    ask: numeric("ask", { precision: 30, scale: 12 }).notNull(),
    last: numeric("last", { precision: 30, scale: 12 }),
    volume: quantity("volume"),
    receivedAt: marketTimestamp("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("mt5_market_ticks_instrument_source_uidx").on(table.instrumentId, table.sourceTickId),
    index("mt5_market_ticks_instrument_time_idx").on(table.instrumentId, table.tickTime),
  ],
);

/** MT5 candles use MT5 timeframe labels and cannot collide with Binance candle keys. */
export const mt5MarketCandles = pgTable(
  "mt5_market_candles",
  {
    id: serial("id").primaryKey(),
    instrumentId: uuid("instrument_id").notNull().references(() => mt5Instruments.id, { onDelete: "cascade" }),
    timeframe: text("timeframe").notNull(),
    openTime: marketTimestamp("open_time").notNull(),
    closeTime: marketTimestamp("close_time").notNull(),
    open: price("open").notNull(),
    high: price("high").notNull(),
    low: price("low").notNull(),
    close: price("close").notNull(),
    tickVolume: quantity("tick_volume").notNull(),
    realVolume: quantity("real_volume").notNull(),
    spreadPoints: integer("spread_points").notNull().default(0),
    isClosed: boolean("is_closed").notNull(),
    receivedAt: marketTimestamp("received_at").notNull(),
  },
  (table) => [
    check("mt5_market_candles_timeframe_check", sql`${table.timeframe} in ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1')`),
    uniqueIndex("mt5_market_candles_instrument_tf_open_uidx").on(table.instrumentId, table.timeframe, table.openTime),
    index("mt5_market_candles_instrument_tf_close_idx").on(table.instrumentId, table.timeframe, table.closeTime),
  ],
);

/** Demo-only order intents are idempotent and transition before bridge execution. */
export const mt5OrderIntents = pgTable(
  "mt5_order_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull().references(() => mt5Accounts.id, { onDelete: "cascade" }),
    bridgeId: uuid("bridge_id").notNull().references(() => mt5Bridges.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    clientOrderId: text("client_order_id").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    brokerSymbol: text("broker_symbol"),
    side: text("side"),
    orderType: text("order_type"),
    requestedVolume: quantity("requested_volume"),
    filledVolume: quantity("filled_volume").notNull().default("0"),
    price: price("price"),
    stopLoss: price("stop_loss"),
    takeProfit: price("take_profit"),
    estimatedMargin: numeric("estimated_margin", { precision: 30, scale: 12 }),
    riskChecks: jsonb("risk_checks").$type<Array<{ name: string; passed: boolean; detail: string }>>().notNull().default([]),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    brokerResult: jsonb("broker_result").$type<Record<string, unknown> | null>(),
    error: text("error"),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
    updatedAt: marketTimestamp("updated_at").notNull().defaultNow(),
    submittedAt: marketTimestamp("submitted_at"),
    completedAt: marketTimestamp("completed_at"),
  },
  (table) => [
    check("mt5_order_intents_operation_check", sql`${table.operation} in ('place_order', 'modify_position', 'close_position', 'cancel_pending')`),
    check("mt5_order_intents_status_check", sql`${table.status} in ('preflight', 'validated', 'submitted', 'accepted', 'partially_filled', 'filled', 'rejected', 'unknown', 'cancelled', 'closed')`),
    check("mt5_order_intents_side_check", sql`${table.side} is null or ${table.side} in ('buy', 'sell')`),
    uniqueIndex("mt5_order_intents_account_client_uidx").on(table.accountId, table.clientOrderId),
    index("mt5_order_intents_bridge_status_created_idx").on(table.bridgeId, table.status, table.createdAt),
    index("mt5_order_intents_owner_created_idx").on(table.ownerUserId, table.createdAt),
  ],
);

/** Broker positions are periodically reconciled from the terminal, not inferred from requests. */
export const mt5Positions = pgTable(
  "mt5_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull().references(() => mt5Accounts.id, { onDelete: "cascade" }),
    brokerTicket: text("broker_ticket").notNull(),
    brokerSymbol: text("broker_symbol").notNull(),
    side: text("side").notNull(),
    volume: quantity("volume").notNull(),
    openPrice: price("open_price").notNull(),
    currentPrice: price("current_price").notNull(),
    stopLoss: price("stop_loss"),
    takeProfit: price("take_profit"),
    profit: numeric("profit", { precision: 30, scale: 12 }).notNull().default("0"),
    swap: numeric("swap", { precision: 30, scale: 12 }).notNull().default("0"),
    openedAt: marketTimestamp("opened_at").notNull(),
    updatedAt: marketTimestamp("updated_at").notNull(),
    closedAt: marketTimestamp("closed_at"),
  },
  (table) => [
    check("mt5_positions_side_check", sql`${table.side} in ('buy', 'sell')`),
    uniqueIndex("mt5_positions_account_ticket_uidx").on(table.accountId, table.brokerTicket),
    index("mt5_positions_account_open_idx").on(table.accountId, table.closedAt),
  ],
);

/** Current broker pending orders; terminal reconciliation marks removed tickets inactive. */
export const mt5PendingOrders = pgTable(
  "mt5_pending_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull().references(() => mt5Accounts.id, { onDelete: "cascade" }),
    brokerTicket: text("broker_ticket").notNull(),
    brokerSymbol: text("broker_symbol").notNull(),
    orderType: text("order_type").notNull(),
    side: text("side").notNull(),
    volume: quantity("volume").notNull(),
    price: price("price").notNull(),
    stopLoss: price("stop_loss"),
    takeProfit: price("take_profit"),
    createdAt: marketTimestamp("created_at").notNull(),
    updatedAt: marketTimestamp("updated_at").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    check("mt5_pending_orders_side_check", sql`${table.side} in ('buy', 'sell')`),
    uniqueIndex("mt5_pending_orders_account_ticket_uidx").on(table.accountId, table.brokerTicket),
    index("mt5_pending_orders_account_active_idx").on(table.accountId, table.active),
  ],
);

/** Deal history is keyed by the broker ticket for safe repeated synchronization. */
export const mt5Deals = pgTable(
  "mt5_deals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull().references(() => mt5Accounts.id, { onDelete: "cascade" }),
    brokerTicket: text("broker_ticket").notNull(),
    orderTicket: text("order_ticket"),
    positionTicket: text("position_ticket"),
    brokerSymbol: text("broker_symbol").notNull(),
    side: text("side").notNull(),
    entry: text("entry").notNull(),
    volume: quantity("volume").notNull(),
    price: price("price").notNull(),
    profit: numeric("profit", { precision: 30, scale: 12 }).notNull().default("0"),
    commission: numeric("commission", { precision: 30, scale: 12 }).notNull().default("0"),
    swap: numeric("swap", { precision: 30, scale: 12 }).notNull().default("0"),
    comment: text("comment").notNull().default(""),
    occurredAt: marketTimestamp("occurred_at").notNull(),
    receivedAt: marketTimestamp("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("mt5_deals_account_ticket_uidx").on(table.accountId, table.brokerTicket),
    index("mt5_deals_account_time_idx").on(table.accountId, table.occurredAt),
  ],
);

/** Explicit grants between users; account data remains private unless shared. */
export const accountShares = pgTable(
  "account_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("pending"),
    createdAt: marketTimestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("account_shares_no_self_share", sql`${table.ownerUserId} <> ${table.recipientUserId}`),
    check("account_shares_status_check", sql`${table.status} in ('pending', 'accepted', 'revoked')`),
    uniqueIndex("account_shares_owner_recipient_uidx").on(table.ownerUserId, table.recipientUserId),
    index("account_shares_recipient_user_id_idx").on(table.recipientUserId),
  ],
);

/** Key/value operational state: trading mode, emergency shutdown, etc. */
export const systemState = pgTable("system_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Persisted activity events; no live event producer is currently configured. */
export const activityEvents = pgTable("activity_events", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  status: text("status").notNull(),
  asset: text("asset"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Immutable audit trail for sensitive operator actions. */
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  severity: text("severity").notNull().default("info"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Saved strategies from the Strategy Lab. */
export const strategies = pgTable("strategies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rules: jsonb("rules").notNull(),
  risk: jsonb("risk").notNull(),
  result: jsonb("result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Simulated orders. Every order passes through the independent risk engine. */
export const paperOrders = pgTable("paper_orders", {
  id: serial("id").primaryKey(),
  clientOrderId: text("client_order_id"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  orderType: text("order_type").notNull().default("market"),
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  limitPrice: price("limit_price"),
  stopLoss: price("stop_loss"),
  takeProfit: price("take_profit"),
  fee: doublePrecision("fee").notNull().default(0),
  slippage: doublePrecision("slippage").notNull().default(0),
  realizedPnl: doublePrecision("realized_pnl").notNull().default(0),
  status: text("status").notNull(),
  reason: text("reason"),
  strategy: text("strategy"),
  decisionId: integer("decision_id"),
  riskChecks: integer("risk_checks").notNull().default(0),
  riskDetails: jsonb("risk_details").$type<Array<{ name: string; passed: boolean; detail: string }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  executedAt: marketTimestamp("executed_at"),
}, (table) => [uniqueIndex("paper_orders_client_order_id_uidx").on(table.clientOrderId)]);

export const marketCandles = pgTable(
  "market_candles",
  {
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    openTime: marketTimestamp("open_time").notNull(),
    closeTime: marketTimestamp("close_time").notNull(),
    eventTime: marketTimestamp("event_time"),
    open: price("open").notNull(),
    high: price("high").notNull(),
    low: price("low").notNull(),
    close: price("close").notNull(),
    baseVolume: quantity("base_volume").notNull(),
    quoteVolume: quantity("quote_volume").notNull(),
    tradeCount: integer("trade_count").notNull(),
    takerBuyBaseVolume: quantity("taker_buy_base_volume").notNull(),
    takerBuyQuoteVolume: quantity("taker_buy_quote_volume").notNull(),
    isClosed: boolean("is_closed").notNull(),
    receivedAt: marketTimestamp("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("market_candles_symbol_interval_open_time_uidx").on(table.symbol, table.interval, table.openTime),
    index("market_candles_symbol_interval_close_time_idx").on(table.symbol, table.interval, table.closeTime),
  ],
);

export const marketTrades = pgTable(
  "market_trades",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    tradeId: text("trade_id").notNull(),
    price: price("price").notNull(),
    quantity: quantity("quantity").notNull(),
    tradeTime: marketTimestamp("trade_time").notNull(),
    buyerIsMaker: boolean("buyer_is_maker").notNull(),
    receivedAt: marketTimestamp("received_at").notNull(),
  },
  (table) => [
    uniqueIndex("market_trades_symbol_trade_id_uidx").on(table.symbol, table.tradeId),
    index("market_trades_symbol_trade_time_idx").on(table.symbol, table.tradeTime),
  ],
);

export const marketOrderBookUpdates = pgTable(
  "market_order_book_updates",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    firstUpdateId: text("first_update_id").notNull(),
    lastUpdateId: text("last_update_id").notNull(),
    eventTime: marketTimestamp("event_time").notNull(),
    receivedAt: marketTimestamp("received_at").notNull(),
    bids: jsonb("bids").$type<[string, string][]>().notNull(),
    asks: jsonb("asks").$type<[string, string][]>().notNull(),
    sequenceValid: boolean("sequence_valid").notNull().default(false),
  },
  (table) => [
    index("market_order_book_updates_symbol_received_at_idx").on(table.symbol, table.receivedAt),
    uniqueIndex("market_order_book_updates_symbol_last_update_uidx").on(table.symbol, table.lastUpdateId),
  ],
);

export const marketOrderBookSnapshots = pgTable(
  "market_order_book_snapshots",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    lastUpdateId: text("last_update_id").notNull(),
    capturedAt: marketTimestamp("captured_at").notNull(),
    bids: jsonb("bids").$type<[string, string][]>().notNull(),
    asks: jsonb("asks").$type<[string, string][]>().notNull(),
  },
  (table) => [index("market_order_book_snapshots_symbol_captured_at_idx").on(table.symbol, table.capturedAt)],
);

export const marketIngestionStatus = pgTable(
  "market_ingestion_status",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    symbol: text("symbol").notNull(),
    state: text("state").notNull(),
    startedAt: marketTimestamp("started_at").notNull(),
    lastMessageAt: marketTimestamp("last_message_at"),
    lastEventAt: marketTimestamp("last_event_at"),
    lastCandleAt: marketTimestamp("last_candle_at"),
    lastTradeAt: marketTimestamp("last_trade_at"),
    lastOrderBookAt: marketTimestamp("last_order_book_at"),
    orderBookSequenceHealthy: boolean("order_book_sequence_healthy").notNull().default(false),
    backfillCompletedAt: marketTimestamp("backfill_completed_at"),
    reconnectCount: integer("reconnect_count").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: marketTimestamp("updated_at").notNull(),
  },
  (table) => [index("market_ingestion_status_symbol_updated_at_idx").on(table.symbol, table.updatedAt)],
);

export const tradingStrategies = pgTable(
  "trading_strategies",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    version: integer("version").notNull().default(1),
    active: boolean("active").notNull().default(false),
    rules: jsonb("rules").$type<Record<string, unknown>>().notNull(),
    updatedAt: marketTimestamp("updated_at").notNull(),
    createdAt: marketTimestamp("created_at").notNull(),
  },
  (table) => [uniqueIndex("trading_strategies_slug_uidx").on(table.slug), index("trading_strategies_active_idx").on(table.active)],
);

export const marketAnalyses = pgTable(
  "market_analyses",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    candleOpenTime: marketTimestamp("candle_open_time").notNull(),
    observed: jsonb("observed").$type<Record<string, unknown>>().notNull(),
    indicators: jsonb("indicators").$type<Record<string, unknown>>().notNull(),
    regime: jsonb("regime").$type<Record<string, unknown>>().notNull(),
    confidence: doublePrecision("confidence").notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    createdAt: marketTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("market_analyses_symbol_interval_candle_uidx").on(table.symbol, table.interval, table.candleOpenTime),
    index("market_analyses_created_at_idx").on(table.createdAt),
  ],
);

export const tradingDecisions = pgTable(
  "trading_decisions",
  {
    id: serial("id").primaryKey(),
    strategySlug: text("strategy_slug").notNull(),
    strategyVersion: integer("strategy_version").notNull(),
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    candleOpenTime: marketTimestamp("candle_open_time").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    entryPrice: price("entry_price"),
    stopLoss: price("stop_loss"),
    takeProfit: price("take_profit"),
    riskReward: doublePrecision("risk_reward"),
    confidence: doublePrecision("confidence").notNull(),
    regime: text("regime").notNull(),
    supportingIndicators: jsonb("supporting_indicators").$type<string[]>().notNull(),
    explanation: text("explanation").notNull(),
    invalidation: jsonb("invalidation").$type<string[]>().notNull(),
    riskChecks: jsonb("risk_checks").$type<Array<{ name: string; passed: boolean; detail: string }>>(),
    orderId: integer("order_id"),
    createdAt: marketTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("trading_decisions_strategy_symbol_interval_candle_uidx").on(
      table.strategySlug,
      table.symbol,
      table.interval,
      table.candleOpenTime,
    ),
    index("trading_decisions_created_at_idx").on(table.createdAt),
  ],
);

export const paperAccounts = pgTable("paper_accounts", {
  id: text("id").primaryKey(),
  currency: text("currency").notNull().default("USDT"),
  startingBalance: numeric("starting_balance", { precision: 30, scale: 12 }).notNull(),
  cashBalance: numeric("cash_balance", { precision: 30, scale: 12 }).notNull(),
  realizedPnl: numeric("realized_pnl", { precision: 30, scale: 12 }).notNull().default("0"),
  peakEquity: numeric("peak_equity", { precision: 30, scale: 12 }).notNull(),
  dayStartEquity: numeric("day_start_equity", { precision: 30, scale: 12 }).notNull(),
  dayStartDate: text("day_start_date").notNull(),
  halted: boolean("halted").notNull().default(false),
  updatedAt: marketTimestamp("updated_at").notNull(),
});

export const paperPositions = pgTable("paper_positions", {
  symbol: text("symbol").primaryKey(),
  quantity: numeric("quantity", { precision: 36, scale: 18 }).notNull(),
  averageEntryPrice: price("average_entry_price").notNull(),
  markPrice: price("mark_price").notNull(),
  stopLoss: price("stop_loss"),
  takeProfit: price("take_profit"),
  realizedPnl: numeric("realized_pnl", { precision: 30, scale: 12 }).notNull().default("0"),
  openedAt: marketTimestamp("opened_at").notNull(),
  updatedAt: marketTimestamp("updated_at").notNull(),
});

export const backtestRuns = pgTable(
  "backtest_runs",
  {
    id: serial("id").primaryKey(),
    strategySlug: text("strategy_slug").notNull(),
    strategyVersion: integer("strategy_version").notNull(),
    symbol: text("symbol").notNull(),
    interval: text("interval").notNull(),
    fromTime: marketTimestamp("from_time").notNull(),
    toTime: marketTimestamp("to_time").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    equityCurve: jsonb("equity_curve").$type<Array<{ time: number; strategy: number; benchmark: number }>>().notNull(),
    trades: jsonb("trades").$type<Array<Record<string, unknown>>>().notNull(),
    createdAt: marketTimestamp("created_at").notNull(),
  },
  (table) => [index("backtest_runs_strategy_created_idx").on(table.strategySlug, table.createdAt)],
);

export const engineHealth = pgTable("engine_health", {
  engine: text("engine").primaryKey(),
  state: text("state").notNull(),
  lastCycleAt: marketTimestamp("last_cycle_at"),
  lastError: text("last_error"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: marketTimestamp("updated_at").notNull(),
});

export const engineLogs = pgTable(
  "engine_logs",
  {
    id: serial("id").primaryKey(),
    engine: text("engine").notNull(),
    level: text("level").notNull(),
    event: text("event").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: marketTimestamp("created_at").notNull(),
  },
  (table) => [index("engine_logs_engine_created_idx").on(table.engine, table.createdAt)],
);

export const riskConfigurations = pgTable("risk_configurations", {
  id: text("id").primaryKey(),
  maxRiskPerTradePct: doublePrecision("max_risk_per_trade_pct").notNull(),
  maxDailyLossPct: doublePrecision("max_daily_loss_pct").notNull(),
  maxDrawdownPct: doublePrecision("max_drawdown_pct").notNull(),
  maxPositionPct: doublePrecision("max_position_pct").notNull(),
  maxConcurrentPositions: integer("max_concurrent_positions").notNull(),
  minRiskReward: doublePrecision("min_risk_reward").notNull(),
  maxExposurePct: doublePrecision("max_exposure_pct").notNull(),
  feeRate: doublePrecision("fee_rate").notNull(),
  slippageRate: doublePrecision("slippage_rate").notNull(),
  startingBalance: numeric("starting_balance", { precision: 30, scale: 12 }).notNull(),
  updatedAt: marketTimestamp("updated_at").notNull(),
});
