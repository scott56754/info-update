import { pgTable, text, serial, bigint, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const guildSettings = pgTable("guild_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  logsChannel: text("logs_channel"),
  reportChannel: text("report_channel"),
  welcomeChannel: text("welcome_channel"),
  welcomeMessage: text("welcome_message"),
  welcomeImageUrl: text("welcome_image_url"),
  welcomeAutoRoleId: text("welcome_auto_role_id"),
  welcomeDmMessage: text("welcome_dm_message"),
  welcomeColor: text("welcome_color"),
  verificationRole: text("verification_role"),
  verificationChannel: text("verification_channel"),
  ticketCategory: text("ticket_category"),
  ticketLogChannel: text("ticket_log_channel"),
  muteRole: text("mute_role"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const economy = pgTable("economy", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  guildId: text("guild_id").notNull(),
  balance: integer("balance").notNull().default(0),
  bank: integer("bank").notNull().default(0),
  lastDaily: timestamp("last_daily"),
  lastWork: timestamp("last_work"),
}, (t) => [index("economy_user_guild_idx").on(t.userId, t.guildId)]);

export const warnings = pgTable("warnings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  guildId: text("guild_id").notNull(),
  moderatorId: text("moderator_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("warnings_user_guild_idx").on(t.userId, t.guildId)]);

export const mutes = pgTable("mutes", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  guildId: text("guild_id").notNull(),
  moderatorId: text("moderator_id").notNull(),
  reason: text("reason"),
  expiresAt: timestamp("expires_at"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reminders = pgTable("reminders", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  channelId: text("channel_id").notNull(),
  message: text("message").notNull(),
  remindAt: timestamp("remind_at").notNull(),
  sent: boolean("sent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const afkUsers = pgTable("afk_users", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  guildId: text("guild_id").notNull(),
  reason: text("reason").notNull().default("AFK"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("afk_user_guild_idx").on(t.userId, t.guildId)]);

export const inviteTracking = pgTable("invite_tracking", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  inviterId: text("inviter_id").notNull(),
  invitedId: text("invited_id").notNull(),
  inviteCode: text("invite_code").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("invite_guild_inviter_idx").on(t.guildId, t.inviterId)]);

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  reporterId: text("reporter_id").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ticketSettings = pgTable("ticket_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  categoryId: text("category_id"),
  title: text("title").notNull().default("TICKETS"),
  description: text("description").notNull().default("Open a ticket by clicking one of the buttons below."),
  buy1Label: text("buy1_label").notNull().default("💰 BUY SCRIPT 1"),
  buy1RoleId: text("buy1_role_id"),
  buy2Label: text("buy2_label").notNull().default("🧠 BUY SCRIPT 2"),
  buy2RoleId: text("buy2_role_id"),
  supportLabel: text("support_label").notNull().default("🎧 SUPPORT/SUGGESTIONS"),
  supportRoleId: text("support_role_id"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull().unique(),
  userId: text("user_id").notNull(),
  ticketType: text("ticket_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  closedAt: timestamp("closed_at"),
  closedBy: text("closed_by"),
}, (t) => [index("tickets_channel_idx").on(t.channelId)]);

export type TicketSettings = typeof ticketSettings.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;

export const panels = pgTable("panels", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default("This control panel is for buyers."),
  scriptContent: text("script_content"),
  roleId: text("role_id"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("panels_guild_name_idx").on(t.guildId, t.name)]);

export const panelKeys = pgTable("panel_keys", {
  id: serial("id").primaryKey(),
  panelId: integer("panel_id").notNull().references(() => panels.id, { onDelete: "cascade" }),
  keyCode: text("key_code").notNull().unique(),
  usedBy: text("used_by"),
  usedAt: timestamp("used_at"),
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("panel_keys_panel_idx").on(t.panelId)]);

export const panelWhitelist = pgTable("panel_whitelist", {
  id: serial("id").primaryKey(),
  panelId: integer("panel_id").notNull().references(() => panels.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  keyCode: text("key_code"),
  hwid: text("hwid"),
  whitelistedBy: text("whitelisted_by").notNull(),
  whitelistedAt: timestamp("whitelisted_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
}, (t) => [index("whitelist_panel_user_idx").on(t.panelId, t.userId)]);

export const panelBlacklist = pgTable("panel_blacklist", {
  id: serial("id").primaryKey(),
  panelId: integer("panel_id").notNull().references(() => panels.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  reason: text("reason").notNull().default("No reason provided"),
  blacklistedBy: text("blacklisted_by").notNull(),
  blacklistedAt: timestamp("blacklisted_at").defaultNow(),
  active: boolean("active").notNull().default(true),
}, (t) => [index("blacklist_panel_user_idx").on(t.panelId, t.userId)]);

export type Panel = typeof panels.$inferSelect;
export type PanelKey = typeof panelKeys.$inferSelect;
export type PanelWhitelist = typeof panelWhitelist.$inferSelect;
export type PanelBlacklist = typeof panelBlacklist.$inferSelect;

// ── Anti-Nuke Settings ─────────────────────────────────────────────────────

export const antiNukeSettings = pgTable("anti_nuke_settings", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  punishment: text("punishment").notNull().default("ban"),
  banThreshold: integer("ban_threshold").notNull().default(3),
  channelDeleteThreshold: integer("channel_delete_threshold").notNull().default(3),
  roleDeleteThreshold: integer("role_delete_threshold").notNull().default(3),
  botAddThreshold: integer("bot_add_threshold").notNull().default(1),
  timeWindow: integer("time_window").notNull().default(10),
  logChannelId: text("log_channel_id"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AntiNukeSettings = typeof antiNukeSettings.$inferSelect;

// ── Giveaways ──────────────────────────────────────────────────────────────

export const giveaways = pgTable("giveaways", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  hostId: text("host_id").notNull(),
  prize: text("prize").notNull(),
  winnersCount: integer("winners_count").notNull().default(1),
  endsAt: timestamp("ends_at").notNull(),
  ended: boolean("ended").notNull().default(false),
  winnerIds: text("winner_ids"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("giveaways_guild_idx").on(t.guildId)]);

export const giveawayEntries = pgTable("giveaway_entries", {
  id: serial("id").primaryKey(),
  giveawayId: integer("giveaway_id").notNull().references(() => giveaways.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  enteredAt: timestamp("entered_at").defaultNow(),
}, (t) => [index("giveaway_entries_idx").on(t.giveawayId, t.userId)]);

export type Giveaway = typeof giveaways.$inferSelect;
export type GiveawayEntry = typeof giveawayEntries.$inferSelect;

export const insertGuildSettingsSchema = createInsertSchema(guildSettings).omit({ id: true, updatedAt: true });
export const insertEconomySchema = createInsertSchema(economy).omit({ id: true });
export const insertWarningSchema = createInsertSchema(warnings).omit({ id: true, createdAt: true });
export const insertReminderSchema = createInsertSchema(reminders).omit({ id: true, sent: true, createdAt: true });

export type GuildSettings = typeof guildSettings.$inferSelect;
export type Economy = typeof economy.$inferSelect;
export type Warning = typeof warnings.$inferSelect;
export type Mute = typeof mutes.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type AfkUser = typeof afkUsers.$inferSelect;
export type InviteTracking = typeof inviteTracking.$inferSelect;
export type Report = typeof reports.$inferSelect;
