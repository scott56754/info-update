import {
  SlashCommandBuilder, ChatInputCommandInteraction, Client,
  EmbedBuilder, PermissionFlagsBits, GuildMember,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { warnings, mutes, guildSettings } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const OWNERS = ["1417552037717086355", "1501051958629503097"];
function ownerOnly(i: ChatInputCommandInteraction) {
  if (!OWNERS.includes(i.user.id)) {
    i.reply({ content: "❌ You are not authorized to use this command.", flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

function modEmbed(color: number, title: string) {
  return new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
}

async function sendLog(interaction: ChatInputCommandInteraction, embed: EmbedBuilder) {
  try {
    const [settings] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, interaction.guildId!));
    if (settings?.logsChannel) {
      const ch = await interaction.guild!.channels.fetch(settings.logsChannel);
      if (ch && ch.isTextBased()) await (ch as any).send({ embeds: [embed] });
    }
  } catch {}
}

export const moderationCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((o) => o.setName("user").setDescription("User to ban").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false))
      .addIntegerOption((o) => o.setName("days").setDescription("Days of messages to delete (0-7)").setMinValue(0).setMaxValue(7)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getMember("user") as GuildMember;
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      const days = interaction.options.getInteger("days") ?? 0;
      if (!target) return interaction.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
      if (!target.bannable) return interaction.reply({ content: "I cannot ban this user.", flags: MessageFlags.Ephemeral });
      await target.ban({ reason, deleteMessageSeconds: days * 86400 });
      const embed = modEmbed(0xed4245, "🔨 Member Banned")
        .addFields(
          { name: "User", value: `${target.user.tag} (${target.id})`, inline: true },
          { name: "Moderator", value: interaction.user.tag, inline: true },
          { name: "Reason", value: reason }
        );
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction, embed);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((o) => o.setName("user").setDescription("User to kick").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason")),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getMember("user") as GuildMember;
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      if (!target) return interaction.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
      if (!target.kickable) return interaction.reply({ content: "I cannot kick this user.", flags: MessageFlags.Ephemeral });
      await target.kick(reason);
      const embed = modEmbed(0xffa500, "👢 Member Kicked")
        .addFields(
          { name: "User", value: `${target.user.tag} (${target.id})`, inline: true },
          { name: "Moderator", value: interaction.user.tag, inline: true },
          { name: "Reason", value: reason }
        );
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction, embed);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("mute")
      .setDescription("Timeout (mute) a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName("user").setDescription("User to mute").setRequired(true))
      .addIntegerOption((o) => o.setName("duration").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(10080))
      .addStringOption((o) => o.setName("reason").setDescription("Reason")),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getMember("user") as GuildMember;
      const duration = interaction.options.getInteger("duration", true);
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      if (!target) return interaction.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
      await target.timeout(duration * 60 * 1000, reason);
      await db.insert(mutes).values({ userId: target.id, guildId: interaction.guildId!, moderatorId: interaction.user.id, reason, expiresAt: new Date(Date.now() + duration * 60 * 1000) });
      const embed = modEmbed(0xffa500, "🔇 Member Muted")
        .addFields(
          { name: "User", value: `${target.user.tag}`, inline: true },
          { name: "Duration", value: `${duration} min`, inline: true },
          { name: "Reason", value: reason }
        );
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction, embed);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unmute")
      .setDescription("Remove timeout from a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName("user").setDescription("User to unmute").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getMember("user") as GuildMember;
      if (!target) return interaction.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
      await target.timeout(null);
      const embed = modEmbed(0x57f287, "🔊 Member Unmuted")
        .addFields({ name: "User", value: target.user.tag, inline: true }, { name: "Moderator", value: interaction.user.tag, inline: true });
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction, embed);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Warn a member")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName("user").setDescription("User to warn").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);
      await db.insert(warnings).values({ userId: target.id, guildId: interaction.guildId!, moderatorId: interaction.user.id, reason });
      const userWarns = await db.select().from(warnings).where(and(eq(warnings.userId, target.id), eq(warnings.guildId, interaction.guildId!)));
      const embed = modEmbed(0xfee75c, "⚠️ Member Warned")
        .addFields(
          { name: "User", value: `${target.tag}`, inline: true },
          { name: "Total Warnings", value: `${userWarns.length}`, inline: true },
          { name: "Reason", value: reason }
        );
      await interaction.reply({ embeds: [embed] });
      await sendLog(interaction, embed);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("View warnings for a user")
      .addUserOption((o) => o.setName("user").setDescription("User to check").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getUser("user", true);
      const userWarns = await db.select().from(warnings).where(and(eq(warnings.userId, target.id), eq(warnings.guildId, interaction.guildId!)));
      const embed = modEmbed(0xfee75c, `⚠️ Warnings for ${target.tag}`)
        .setDescription(userWarns.length === 0
          ? "No warnings."
          : userWarns.map((w, i) => `**${i + 1}.** ${w.reason} — <t:${Math.floor(new Date(w.createdAt!).getTime() / 1000)}:R>`).join("\n")
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("purge")
      .setDescription("Delete multiple messages")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) => o.setName("amount").setDescription("Number of messages to delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const amount = interaction.options.getInteger("amount", true);
      const channel = interaction.channel as any;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const deleted = await channel.bulkDelete(amount, true);
      await interaction.editReply({ content: `✅ Deleted **${deleted.size}** messages.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("purgebots")
      .setDescription("Delete bot messages")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) => o.setName("amount").setDescription("Messages to scan (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const amount = interaction.options.getInteger("amount", true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const messages = await (interaction.channel as any).messages.fetch({ limit: amount });
      const botMsgs = messages.filter((m: any) => m.author.bot);
      await (interaction.channel as any).bulkDelete(botMsgs, true);
      await interaction.editReply({ content: `✅ Deleted **${botMsgs.size}** bot messages.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("purgeuser")
      .setDescription("Delete messages from a specific user")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("Messages to scan (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const messages = await (interaction.channel as any).messages.fetch({ limit: amount });
      const userMsgs = messages.filter((m: any) => m.author.id === target.id);
      await (interaction.channel as any).bulkDelete(userMsgs, true);
      await interaction.editReply({ content: `✅ Deleted **${userMsgs.size}** messages from ${target.tag}.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Clear all messages in channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) => o.setName("amount").setDescription("Amount to clear (1-100)").setMinValue(1).setMaxValue(100)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const amount = interaction.options.getInteger("amount") ?? 100;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const deleted = await (interaction.channel as any).bulkDelete(amount, true);
      await interaction.editReply({ content: `✅ Cleared **${deleted.size}** messages.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("lock")
      .setDescription("Lock the current channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addStringOption((o) => o.setName("reason").setDescription("Reason")),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const reason = interaction.options.getString("reason") ?? "Channel locked by moderator";
      await (interaction.channel as any).permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: false });
      const embed = modEmbed(0xed4245, "🔒 Channel Locked")
        .setDescription(`${interaction.channel} has been locked.\n**Reason:** ${reason}`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("Unlock the current channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      await (interaction.channel as any).permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: null });
      const embed = modEmbed(0x57f287, "🔓 Channel Unlocked")
        .setDescription(`${interaction.channel} has been unlocked.`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("lockdown")
      .setDescription("Lock all channels in the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      await interaction.deferReply();
      const channels = interaction.guild!.channels.cache.filter((c) => c.isTextBased());
      let count = 0;
      for (const [, ch] of channels) {
        try {
          await (ch as any).permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: false });
          count++;
        } catch {}
      }
      const embed = modEmbed(0xed4245, "🔒 Server Lockdown")
        .setDescription(`Locked **${count}** channels.`);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unlockdown")
      .setDescription("Unlock all channels in the server")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      await interaction.deferReply();
      const channels = interaction.guild!.channels.cache.filter((c) => c.isTextBased());
      let count = 0;
      for (const [, ch] of channels) {
        try {
          await (ch as any).permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: null });
          count++;
        } catch {}
      }
      const embed = modEmbed(0x57f287, "🔓 Server Unlocked")
        .setDescription(`Unlocked **${count}** channels.`);
      await interaction.editReply({ embeds: [embed] });
    },
  },
];
