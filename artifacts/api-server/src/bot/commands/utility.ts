import { SlashCommandBuilder, ChatInputCommandInteraction, Client, EmbedBuilder, PermissionFlagsBits , MessageFlags } from "discord.js";
import { db } from "@workspace/db";
import { afkUsers, reminders, inviteTracking, reports, guildSettings } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";

function utilEmbed(color: number) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

export const utilityCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("afk")
      .setDescription("Set your AFK status")
      .addStringOption((o) => o.setName("reason").setDescription("AFK reason").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      const reason = interaction.options.getString("reason") ?? "AFK";
      await db.delete(afkUsers).where(and(eq(afkUsers.userId, interaction.user.id), eq(afkUsers.guildId, interaction.guildId!)));
      await db.insert(afkUsers).values({ userId: interaction.user.id, guildId: interaction.guildId!, reason });
      const embed = utilEmbed(0xfee75c)
        .setTitle("💤 AFK Set")
        .setDescription(`You are now AFK: **${reason}**`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("announce")
      .setDescription("Make an announcement")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addStringOption((o) => o.setName("message").setDescription("Announcement message").setRequired(true))
      .addChannelOption((o) => o.setName("channel").setDescription("Channel to announce in")),
    async execute(interaction: ChatInputCommandInteraction) {
      const message = interaction.options.getString("message", true);
      const channel = (interaction.options.getChannel("channel") ?? interaction.channel) as any;
      const embed = utilEmbed(0x5865f2)
        .setTitle("📢 Announcement")
        .setDescription(message)
        .setFooter({ text: `Announced by ${interaction.user.tag}` });
      await channel.send({ embeds: [embed] });
      await interaction.reply({ content: `✅ Announcement sent to ${channel}.`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("remind")
      .setDescription("Set a reminder")
      .addIntegerOption((o) => o.setName("minutes").setDescription("Minutes from now").setRequired(true).setMinValue(1).setMaxValue(10080))
      .addStringOption((o) => o.setName("message").setDescription("Reminder message").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const minutes = interaction.options.getInteger("minutes", true);
      const message = interaction.options.getString("message", true);
      const remindAt = new Date(Date.now() + minutes * 60 * 1000);
      await db.insert(reminders).values({ userId: interaction.user.id, channelId: interaction.channelId, message, remindAt });
      const embed = utilEmbed(0x57f287)
        .setTitle("⏰ Reminder Set")
        .addFields(
          { name: "Message", value: message },
          { name: "Time", value: `<t:${Math.floor(remindAt.getTime() / 1000)}:R>` }
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("report")
      .setDescription("Report a user")
      .addUserOption((o) => o.setName("user").setDescription("User to report").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason for report").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const target = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);
      await db.insert(reports).values({ guildId: interaction.guildId!, reporterId: interaction.user.id, targetId: target.id, reason });
      await interaction.reply({ content: "✅ Your report has been submitted to the moderators.", flags: MessageFlags.Ephemeral });

      // Send to report channel
      try {
        const [settings] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, interaction.guildId!));
        if (settings?.reportChannel) {
          const ch = await interaction.guild!.channels.fetch(settings.reportChannel);
          if (ch && ch.isTextBased()) {
            const embed = utilEmbed(0xed4245)
              .setTitle("🚨 New Report")
              .addFields(
                { name: "Reporter", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                { name: "Reported User", value: `${target.tag} (${target.id})`, inline: true },
                { name: "Reason", value: reason }
              );
            await (ch as any).send({ embeds: [embed] });
          }
        }
      } catch {}
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("invites")
      .setDescription("Check how many invites a user has")
      .addUserOption((o) => o.setName("user").setDescription("User to check")),
    async execute(interaction: ChatInputCommandInteraction) {
      const target = interaction.options.getUser("user") ?? interaction.user;
      const [result] = await db
        .select({ total: count() })
        .from(inviteTracking)
        .where(and(eq(inviteTracking.guildId, interaction.guildId!), eq(inviteTracking.inviterId, target.id)));
      const embed = utilEmbed(0x5865f2)
        .setTitle(`📨 Invites — ${target.tag}`)
        .setDescription(`**${result.total}** invite${result.total !== 1 ? "s" : ""}`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("inviteleaderboard")
      .setDescription("View the invite leaderboard"),
    async execute(interaction: ChatInputCommandInteraction) {
      const rows = await db
        .select({ inviterId: inviteTracking.inviterId, total: count() })
        .from(inviteTracking)
        .where(eq(inviteTracking.guildId, interaction.guildId!))
        .groupBy(inviteTracking.inviterId)
        .orderBy(desc(count()))
        .limit(10);

      const lines = await Promise.all(rows.map(async (r, i) => {
        try {
          const user = await interaction.client.users.fetch(r.inviterId);
          return `**${i + 1}.** ${user.tag} — ${r.total} invite${r.total !== 1 ? "s" : ""}`;
        } catch {
          return `**${i + 1}.** Unknown — ${r.total} invites`;
        }
      }));
      const embed = utilEmbed(0x5865f2)
        .setTitle("📨 Invite Leaderboard")
        .setDescription(lines.join("\n") || "No invite data yet.");
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("whoinvited")
      .setDescription("Check who invited a user")
      .addUserOption((o) => o.setName("user").setDescription("User to check").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const target = interaction.options.getUser("user", true);
      const [row] = await db
        .select()
        .from(inviteTracking)
        .where(and(eq(inviteTracking.guildId, interaction.guildId!), eq(inviteTracking.invitedId, target.id)));
      if (!row) return interaction.reply({ content: "No invite data found for this user.", flags: MessageFlags.Ephemeral });
      const inviter = await interaction.client.users.fetch(row.inviterId).catch(() => null);
      const embed = utilEmbed(0x5865f2)
        .setTitle("📨 Invite Info")
        .addFields(
          { name: "User", value: target.tag, inline: true },
          { name: "Invited By", value: inviter ? inviter.tag : "Unknown", inline: true },
          { name: "Code", value: row.inviteCode, inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
];
