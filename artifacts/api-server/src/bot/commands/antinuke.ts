import {
  SlashCommandBuilder, ChatInputCommandInteraction, Client,
  EmbedBuilder, AuditLogEvent, GuildMember,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { antiNukeSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

const OWNERS = ["1417552037717086355", "1501051958629503097"];
function ownerOnly(i: ChatInputCommandInteraction) {
  if (!OWNERS.includes(i.user.id)) {
    i.reply({ content: "❌ You are not authorized to use this command.", flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

// ── In-memory rate tracker ─────────────────────────────────────────────────
// Key: "guildId:userId:action" → list of timestamps (ms)
const tracker = new Map<string, number[]>();

function track(guildId: string, userId: string, action: string, windowMs: number): number {
  const key = `${guildId}:${userId}:${action}`;
  const now = Date.now();
  const prev = (tracker.get(key) ?? []).filter((t) => now - t < windowMs);
  prev.push(now);
  tracker.set(key, prev);
  return prev.length;
}

async function punish(client: Client, guild: any, memberId: string, reason: string, punishment: string, logChannelId?: string | null) {
  // Never punish owners
  if (OWNERS.includes(memberId)) return;

  let action = "No action taken";
  try {
    const member = await guild.members.fetch(memberId).catch(() => null) as GuildMember | null;
    if (!member) {
      // Member left or is a bot that was added — try ban by ID
      if (punishment === "ban") {
        await guild.members.ban(memberId, { reason });
        action = "Banned (not in server)";
      }
    } else {
      if (punishment === "ban") {
        await member.ban({ reason });
        action = "Banned";
      } else if (punishment === "kick") {
        await member.kick(reason);
        action = "Kicked";
      } else if (punishment === "strip_roles") {
        const rolesToRemove = member.roles.cache.filter((r) => r.id !== guild.id && r.editable);
        await member.roles.remove(rolesToRemove, reason);
        action = `Stripped ${rolesToRemove.size} role(s)`;
      } else if (punishment === "timeout") {
        await member.timeout(24 * 60 * 60 * 1000, reason);
        action = "Timed out 24h";
      }
    }
  } catch (err: any) {
    action = `Failed: ${err?.message ?? "unknown"}`;
  }

  if (logChannelId) {
    try {
      const ch = await client.channels.fetch(logChannelId);
      if (ch?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🛡️ Anti-Nuke Triggered")
          .addFields(
            { name: "Target", value: `<@${memberId}> (${memberId})`, inline: true },
            { name: "Action", value: action, inline: true },
            { name: "Reason", value: reason },
          )
          .setTimestamp();
        await (ch as any).send({ embeds: [embed] });
      }
    } catch {}
  }
}

export function setupAntiNuke(client: Client) {
  // ── Mass Ban detection ─────────────────────────────────────────────────
  client.on("guildBanAdd" as any, async (ban: any) => {
    try {
      const guild = ban.guild;
      const [settings] = await db.select().from(antiNukeSettings).where(eq(antiNukeSettings.guildId, guild.id));
      if (!settings?.enabled) return;

      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
      const executor = auditLogs.entries.first()?.executor;
      if (!executor || executor.id === client.user?.id) return;

      const windowMs = settings.timeWindow * 1000;
      const count = track(guild.id, executor.id, "ban", windowMs);
      if (count >= settings.banThreshold) {
        await punish(client, guild, executor.id, `Anti-Nuke: Mass ban detected (${count} bans)`, settings.punishment, settings.logChannelId);
        tracker.delete(`${guild.id}:${executor.id}:ban`);
      }
    } catch {}
  });

  // ── Mass Channel Delete detection ──────────────────────────────────────
  client.on("channelDelete" as any, async (channel: any) => {
    try {
      if (!channel.guild) return;
      const guild = channel.guild;
      const [settings] = await db.select().from(antiNukeSettings).where(eq(antiNukeSettings.guildId, guild.id));
      if (!settings?.enabled) return;

      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
      const executor = auditLogs.entries.first()?.executor;
      if (!executor || executor.id === client.user?.id) return;

      const windowMs = settings.timeWindow * 1000;
      const count = track(guild.id, executor.id, "channelDelete", windowMs);
      if (count >= settings.channelDeleteThreshold) {
        await punish(client, guild, executor.id, `Anti-Nuke: Mass channel delete (${count} channels)`, settings.punishment, settings.logChannelId);
        tracker.delete(`${guild.id}:${executor.id}:channelDelete`);
      }
    } catch {}
  });

  // ── Mass Role Delete detection ─────────────────────────────────────────
  client.on("roleDelete" as any, async (role: any) => {
    try {
      const guild = role.guild;
      const [settings] = await db.select().from(antiNukeSettings).where(eq(antiNukeSettings.guildId, guild.id));
      if (!settings?.enabled) return;

      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 });
      const executor = auditLogs.entries.first()?.executor;
      if (!executor || executor.id === client.user?.id) return;

      const windowMs = settings.timeWindow * 1000;
      const count = track(guild.id, executor.id, "roleDelete", windowMs);
      if (count >= settings.roleDeleteThreshold) {
        await punish(client, guild, executor.id, `Anti-Nuke: Mass role delete (${count} roles)`, settings.punishment, settings.logChannelId);
        tracker.delete(`${guild.id}:${executor.id}:roleDelete`);
      }
    } catch {}
  });

  // ── Bot Add detection ──────────────────────────────────────────────────
  client.on("guildMemberAdd" as any, async (member: GuildMember) => {
    try {
      if (!member.user.bot) return;
      const guild = member.guild;
      const [settings] = await db.select().from(antiNukeSettings).where(eq(antiNukeSettings.guildId, guild.id));
      if (!settings?.enabled) return;

      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 });
      const executor = auditLogs.entries.first()?.executor;
      if (!executor || executor.id === client.user?.id) return;

      const windowMs = settings.timeWindow * 1000;
      const count = track(guild.id, executor.id, "botAdd", windowMs);
      if (count >= settings.botAddThreshold) {
        // Kick the added bot first
        try { await member.kick("Anti-Nuke: Unauthorized bot add"); } catch {}
        await punish(client, guild, executor.id, `Anti-Nuke: Unauthorized bot add`, settings.punishment, settings.logChannelId);
        tracker.delete(`${guild.id}:${executor.id}:botAdd`);
      }
    } catch {}
  });
}

export const antiNukeCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("antinuke")
      .setDescription("Anti-nuke protection settings")
      .addSubcommand((s) =>
        s.setName("setup")
          .setDescription("Configure anti-nuke settings")
          .addStringOption((o) =>
            o.setName("punishment").setDescription("Action to take on nukers").setRequired(true)
              .addChoices(
                { name: "Ban", value: "ban" },
                { name: "Kick", value: "kick" },
                { name: "Strip Roles", value: "strip_roles" },
                { name: "Timeout 24h", value: "timeout" },
              )
          )
          .addIntegerOption((o) => o.setName("ban_threshold").setDescription("Max bans before action (default 3)").setMinValue(1).setMaxValue(20))
          .addIntegerOption((o) => o.setName("channel_delete_threshold").setDescription("Max channel deletes before action (default 3)").setMinValue(1).setMaxValue(20))
          .addIntegerOption((o) => o.setName("role_delete_threshold").setDescription("Max role deletes before action (default 3)").setMinValue(1).setMaxValue(20))
          .addIntegerOption((o) => o.setName("bot_add_threshold").setDescription("Max bot adds before action (default 1)").setMinValue(1).setMaxValue(10))
          .addIntegerOption((o) => o.setName("time_window").setDescription("Time window in seconds (default 10)").setMinValue(5).setMaxValue(60))
          .addChannelOption((o) => o.setName("log_channel").setDescription("Channel to send anti-nuke logs"))
      )
      .addSubcommand((s) =>
        s.setName("enable").setDescription("Enable anti-nuke protection")
      )
      .addSubcommand((s) =>
        s.setName("disable").setDescription("Disable anti-nuke protection")
      )
      .addSubcommand((s) =>
        s.setName("status").setDescription("View current anti-nuke settings")
      ),
    async execute(interaction: ChatInputCommandInteraction, client: Client) {
      if (!ownerOnly(interaction)) return;
      const sub = interaction.options.getSubcommand();

      if (sub === "setup") {
        const punishment = interaction.options.getString("punishment", true);
        const banThreshold = interaction.options.getInteger("ban_threshold") ?? 3;
        const channelDeleteThreshold = interaction.options.getInteger("channel_delete_threshold") ?? 3;
        const roleDeleteThreshold = interaction.options.getInteger("role_delete_threshold") ?? 3;
        const botAddThreshold = interaction.options.getInteger("bot_add_threshold") ?? 1;
        const timeWindow = interaction.options.getInteger("time_window") ?? 10;
        const logChannel = interaction.options.getChannel("log_channel");

        await db.insert(antiNukeSettings).values({
          guildId: interaction.guildId!,
          punishment,
          banThreshold,
          channelDeleteThreshold,
          roleDeleteThreshold,
          botAddThreshold,
          timeWindow,
          logChannelId: logChannel?.id ?? null,
          enabled: true,
        }).onConflictDoUpdate({
          target: antiNukeSettings.guildId,
          set: {
            punishment,
            banThreshold,
            channelDeleteThreshold,
            roleDeleteThreshold,
            botAddThreshold,
            timeWindow,
            logChannelId: logChannel?.id ?? null,
            enabled: true,
            updatedAt: new Date(),
          },
        });

        const punishLabels: Record<string, string> = { ban: "Ban", kick: "Kick", strip_roles: "Strip Roles", timeout: "Timeout 24h" };
        const embed = new EmbedBuilder().setColor(0x57f287).setTitle("🛡️ Anti-Nuke Configured & Enabled")
          .addFields(
            { name: "Punishment", value: punishLabels[punishment] ?? punishment, inline: true },
            { name: "Time Window", value: `${timeWindow}s`, inline: true },
            { name: "Ban Threshold", value: `${banThreshold}`, inline: true },
            { name: "Channel Delete Threshold", value: `${channelDeleteThreshold}`, inline: true },
            { name: "Role Delete Threshold", value: `${roleDeleteThreshold}`, inline: true },
            { name: "Bot Add Threshold", value: `${botAddThreshold}`, inline: true },
            { name: "Log Channel", value: logChannel ? `<#${logChannel.id}>` : "None set", inline: true },
          );
        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (sub === "enable") {
        await db.insert(antiNukeSettings).values({ guildId: interaction.guildId!, enabled: true, punishment: "ban" })
          .onConflictDoUpdate({ target: antiNukeSettings.guildId, set: { enabled: true, updatedAt: new Date() } });
        await interaction.reply({ content: "✅ Anti-nuke protection **enabled**.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === "disable") {
        await db.insert(antiNukeSettings).values({ guildId: interaction.guildId!, enabled: false, punishment: "ban" })
          .onConflictDoUpdate({ target: antiNukeSettings.guildId, set: { enabled: false, updatedAt: new Date() } });
        await interaction.reply({ content: "🔴 Anti-nuke protection **disabled**.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === "status") {
        const [settings] = await db.select().from(antiNukeSettings).where(eq(antiNukeSettings.guildId, interaction.guildId!));
        if (!settings) return interaction.reply({ content: "⚠️ Anti-nuke not configured. Use `/antinuke setup` first.", flags: MessageFlags.Ephemeral });
        const punishLabels: Record<string, string> = { ban: "Ban", kick: "Kick", strip_roles: "Strip Roles", timeout: "Timeout 24h" };
        const embed = new EmbedBuilder()
          .setColor(settings.enabled ? 0x57f287 : 0xed4245)
          .setTitle(`🛡️ Anti-Nuke — ${settings.enabled ? "✅ Enabled" : "🔴 Disabled"}`)
          .addFields(
            { name: "Punishment", value: punishLabels[settings.punishment] ?? settings.punishment, inline: true },
            { name: "Time Window", value: `${settings.timeWindow}s`, inline: true },
            { name: "Ban Threshold", value: `${settings.banThreshold}`, inline: true },
            { name: "Channel Delete Threshold", value: `${settings.channelDeleteThreshold}`, inline: true },
            { name: "Role Delete Threshold", value: `${settings.roleDeleteThreshold}`, inline: true },
            { name: "Bot Add Threshold", value: `${settings.botAddThreshold}`, inline: true },
            { name: "Log Channel", value: settings.logChannelId ? `<#${settings.logChannelId}>` : "None", inline: true },
          );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    },
  },
];
