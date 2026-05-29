import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
  PermissionFlagsBits, ChannelType, GuildMember,
} from "discord.js";
import { db } from "@workspace/db";
import { guildSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

const OWNERS = ["1417552037717086355", "1501051958629503097"];
function ownerOnly(i: ChatInputCommandInteraction) {
  if (!OWNERS.includes(i.user.id)) {
    i.reply({ content: "❌ You are not authorized to use this command.", ephemeral: true });
    return false;
  }
  return true;
}

function setupEmbed(color: number) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

async function upsertSettings(guildId: string, patch: Partial<typeof guildSettings.$inferInsert>) {
  const [existing] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId));
  if (existing) {
    const [updated] = await db.update(guildSettings).set({ ...patch, updatedAt: new Date() }).where(eq(guildSettings.guildId, guildId)).returning();
    return updated;
  }
  const [created] = await db.insert(guildSettings).values({ guildId, ...patch }).returning();
  return created;
}

export const setupCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("setlogs")
      .setDescription("Set the mod logs channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) => o.setName("channel").setDescription("Logs channel").setRequired(true).addChannelTypes(ChannelType.GuildText)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const channel = interaction.options.getChannel("channel", true);
      await upsertSettings(interaction.guildId!, { logsChannel: channel.id });
      await interaction.reply({ embeds: [setupEmbed(0x57f287).setTitle("⚙️ Logs Channel Set").setDescription(`Mod logs will now be sent to ${channel}.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setreportchannel")
      .setDescription("Set the report channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) => o.setName("channel").setDescription("Report channel").setRequired(true).addChannelTypes(ChannelType.GuildText)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const channel = interaction.options.getChannel("channel", true);
      await upsertSettings(interaction.guildId!, { reportChannel: channel.id });
      await interaction.reply({ embeds: [setupEmbed(0x57f287).setTitle("⚙️ Report Channel Set").setDescription(`Reports will be sent to ${channel}.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setwelcome")
      .setDescription("Set the welcome channel and message")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) => o.setName("channel").setDescription("Welcome channel").setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName("message").setDescription("Welcome message (use {user} and {server})").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const channel = interaction.options.getChannel("channel", true);
      const message = interaction.options.getString("message", true);
      await upsertSettings(interaction.guildId!, { welcomeChannel: channel.id, welcomeMessage: message });
      await interaction.reply({ embeds: [setupEmbed(0x57f287).setTitle("⚙️ Welcome Set").addFields({ name: "Channel", value: `${channel}`, inline: true }, { name: "Message", value: message })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("testwelcome")
      .setDescription("Test the welcome message")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const [settings] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, interaction.guildId!));
      if (!settings?.welcomeChannel || !settings?.welcomeMessage) {
        return interaction.reply({ content: "❌ Welcome channel/message not configured. Use `/setwelcome` first.", ephemeral: true });
      }
      const ch = await interaction.guild!.channels.fetch(settings.welcomeChannel).catch(() => null);
      if (!ch || !ch.isTextBased()) return interaction.reply({ content: "❌ Welcome channel not found.", ephemeral: true });
      const msg = settings.welcomeMessage.replace("{user}", interaction.user.toString()).replace("{server}", interaction.guild!.name);
      await (ch as any).send({ embeds: [setupEmbed(0x57f287).setTitle("👋 Welcome!").setDescription(msg).setThumbnail(interaction.user.displayAvatarURL())] });
      await interaction.reply({ content: "✅ Test welcome message sent!", ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("welcomecheck")
      .setDescription("Check current welcome settings")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const [settings] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, interaction.guildId!));
      await interaction.reply({ embeds: [setupEmbed(0x5865f2).setTitle("⚙️ Welcome Settings").addFields({ name: "Channel", value: settings?.welcomeChannel ? `<#${settings.welcomeChannel}>` : "Not set", inline: true }, { name: "Message", value: settings?.welcomeMessage ?? "Not set" })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setupverification")
      .setDescription("Set up verification role and channel")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addRoleOption((o) => o.setName("role").setDescription("Role given on verification").setRequired(true))
      .addChannelOption((o) => o.setName("channel").setDescription("Verification channel").setRequired(true).addChannelTypes(ChannelType.GuildText)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const role = interaction.options.getRole("role", true);
      const channel = interaction.options.getChannel("channel", true);
      await upsertSettings(interaction.guildId!, { verificationRole: role.id, verificationChannel: channel.id });
      await interaction.reply({ embeds: [setupEmbed(0x57f287).setTitle("⚙️ Verification Setup").addFields({ name: "Role", value: `${role}`, inline: true }, { name: "Channel", value: `${channel}`, inline: true }).setFooter({ text: "Users can now verify to receive the role." })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unverify")
      .setDescription("Remove verification role from a user")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((o) => o.setName("user").setDescription("User to unverify").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const [settings] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, interaction.guildId!));
      if (!settings?.verificationRole) return interaction.reply({ content: "❌ Verification role not configured.", ephemeral: true });
      const member = interaction.options.getMember("user") as GuildMember;
      if (!member) return interaction.reply({ content: "User not found.", ephemeral: true });
      await member.roles.remove(settings.verificationRole);
      await interaction.reply({ embeds: [setupEmbed(0xed4245).setTitle("🔒 User Unverified").setDescription(`Removed verification role from ${member.user.tag}.`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("ticketsetup")
      .setDescription("Set up ticket system")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) => o.setName("category").setDescription("Category for ticket channels").setRequired(true).addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption((o) => o.setName("logs").setDescription("Channel for ticket logs").addChannelTypes(ChannelType.GuildText)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const category = interaction.options.getChannel("category", true);
      const logs = interaction.options.getChannel("logs");
      await upsertSettings(interaction.guildId!, { ticketCategory: category.id, ticketLogChannel: logs?.id ?? null });
      await interaction.reply({ embeds: [setupEmbed(0x57f287).setTitle("🎫 Ticket System Set Up").addFields({ name: "Category", value: category.name, inline: true }, { name: "Logs", value: logs ? `${logs}` : "None", inline: true })] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("ticketclose")
      .setDescription("Close the current ticket")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const channel = interaction.channel as any;
      if (!channel.name.startsWith("ticket-")) {
        return interaction.reply({ content: "❌ This command can only be used in a ticket channel.", ephemeral: true });
      }
      const embed = setupEmbed(0xed4245).setTitle("🎫 Ticket Closed").setDescription(`Ticket closed by ${interaction.user.tag}. This channel will be deleted in 5 seconds.`);
      await interaction.reply({ embeds: [embed] });
      try {
        const [settings] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, interaction.guildId!));
        if (settings?.ticketLogChannel) {
          const logCh = await interaction.guild!.channels.fetch(settings.ticketLogChannel);
          if (logCh && logCh.isTextBased()) {
            await (logCh as any).send({ embeds: [setupEmbed(0xed4245).setTitle("🎫 Ticket Closed").addFields({ name: "Channel", value: channel.name, inline: true }, { name: "Closed By", value: interaction.user.tag, inline: true })] });
          }
        }
      } catch {}
      setTimeout(() => channel.delete().catch(() => {}), 5000);
    },
  },
];
