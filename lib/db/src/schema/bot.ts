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
