import {
  SlashCommandBuilder, ChatInputCommandInteraction, Client,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits, ButtonInteraction,
  OverwriteType,
} from "discord.js";
import { db } from "@workspace/db";
import { ticketSettings, tickets } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

const OWNERS = ["1417552037717086355", "1501051958629503097"];

function isOwner(id: string) { return OWNERS.includes(id); }

function ownerOnly(i: ChatInputCommandInteraction) {
  if (!isOwner(i.user.id)) {
    i.reply({ content: "❌ You are not authorized to use this command.", flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

async function getSettings(guildId: string) {
  const [s] = await db.select().from(ticketSettings).where(eq(ticketSettings.guildId, guildId));
  return s ?? null;
}

async function upsertSettings(guildId: string, values: Partial<typeof ticketSettings.$inferInsert>) {
  const existing = await getSettings(guildId);
  if (existing) {
    await db.update(ticketSettings).set({ ...values, updatedAt: new Date() }).where(eq(ticketSettings.guildId, guildId));
  } else {
    await db.insert(ticketSettings).values({ guildId, ...values });
  }
}

export const ticketCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Post the ticket panel in this channel")
      .addStringOption((o) => o.setName("title").setDescription("Panel title").setRequired(false))
      .addStringOption((o) => o.setName("description").setDescription("Panel description").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const settings = await getSettings(interaction.guildId!);

      const title = interaction.options.getString("title") ?? settings?.title ?? "TICKETS";
      const description = interaction.options.getString("description") ?? settings?.description ?? "Open a ticket by clicking one of the buttons below.";

      // Save title/description
      await upsertSettings(interaction.guildId!, { title, description });

      const buy1Label = settings?.buy1Label ?? "💰 BUY SCRIPT 1";
      const buy2Label = settings?.buy2Label ?? "🧠 BUY SCRIPT 2";
      const supportLabel = settings?.supportLabel ?? "🎧 SUPPORT/SUGGESTIONS";

      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(title)
        .setDescription(description);

      const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("ticket:buy1").setLabel(buy1Label).setStyle(ButtonStyle.Success),
      );
      const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("ticket:buy2").setLabel(buy2Label).setStyle(ButtonStyle.Primary),
      );
      const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("ticket:support").setLabel(supportLabel).setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({ embeds: [embed], components: [row1, row2, row3] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setticketrole")
      .setDescription("Set the staff role for a ticket type")
      .addStringOption((o) =>
        o.setName("type").setDescription("Ticket type").setRequired(true)
          .addChoices(
            { name: "Buy 1", value: "buy1" },
            { name: "Buy 2", value: "buy2" },
            { name: "Support/Suggestions", value: "support" },
          )
      )
      .addRoleOption((o) => o.setName("role").setDescription("Staff role for this ticket type").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const type = interaction.options.getString("type", true) as "buy1" | "buy2" | "support";
      const role = interaction.options.getRole("role", true);
      const updates: Record<string, string> = {
        buy1: "buy1RoleId",
        buy2: "buy2RoleId",
        support: "supportRoleId",
      };
      await upsertSettings(interaction.guildId!, { [updates[type]]: role.id });
      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ Ticket Role Set")
        .addFields(
          { name: "Type", value: type, inline: true },
          { name: "Role", value: `${role}`, inline: true },
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setticketlabel")
      .setDescription("Rename a ticket button")
      .addStringOption((o) =>
        o.setName("type").setDescription("Ticket type").setRequired(true)
          .addChoices(
            { name: "Buy 1", value: "buy1" },
            { name: "Buy 2", value: "buy2" },
            { name: "Support/Suggestions", value: "support" },
          )
      )
      .addStringOption((o) => o.setName("label").setDescription("New button label (include emoji if wanted)").setRequired(true).setMaxLength(80)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const type = interaction.options.getString("type", true) as "buy1" | "buy2" | "support";
      const label = interaction.options.getString("label", true);
      const map: Record<string, string> = { buy1: "buy1Label", buy2: "buy2Label", support: "supportLabel" };
      await upsertSettings(interaction.guildId!, { [map[type]]: label });
      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ Button Label Updated")
        .addFields({ name: "Type", value: type, inline: true }, { name: "Label", value: label, inline: true });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setticketcategory")
      .setDescription("Set the category where ticket channels are created")
      .addChannelOption((o) =>
        o.setName("category").setDescription("Category channel").setRequired(true)
          .addChannelTypes(ChannelType.GuildCategory)
      ),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const cat = interaction.options.getChannel("category", true);
      await upsertSettings(interaction.guildId!, { categoryId: cat.id });
      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ Ticket Category Set")
        .addFields({ name: "Category", value: cat.name, inline: true });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("closeticket")
      .setDescription("Close the current ticket channel"),
    async execute(interaction: ChatInputCommandInteraction, client: Client) {
      await handleCloseTicket(interaction);
    },
  },
];

async function handleCloseTicket(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  const channelId = interaction.channelId;
  const [ticket] = await db.select().from(tickets).where(eq(tickets.channelId, channelId));
  if (!ticket) {
    return interaction.reply({ content: "❌ This is not a ticket channel.", flags: MessageFlags.Ephemeral });
  }

  const isStaff = isOwner(interaction.user.id) ||
    (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false);
  const isTicketOwner = ticket.userId === interaction.user.id;

  if (!isStaff && !isTicketOwner) {
    return interaction.reply({ content: "❌ Only the ticket creator or staff can close this ticket.", flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({ content: "🔒 Closing ticket in 5 seconds..." });
  await db.update(tickets).set({ closedAt: new Date(), closedBy: interaction.user.id })
    .where(eq(tickets.channelId, channelId));

  setTimeout(async () => {
    try {
      await interaction.channel?.delete();
    } catch {}
  }, 5000);
}

export async function handleTicketButton(interaction: ButtonInteraction, client: Client, type: string) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return; // Stale or already-acknowledged interaction — silently ignore
  }

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const guild = interaction.guild!;

  const settings = await getSettings(guildId);

  // Check for existing open ticket by this user of this type
  const [existing] = await db.select().from(tickets)
    .where(and(eq(tickets.guildId, guildId), eq(tickets.userId, userId), eq(tickets.ticketType, type), isNull(tickets.closedAt)));

  if (existing) {
    // Check channel still exists
    try {
      const ch = await client.channels.fetch(existing.channelId);
      if (ch) {
        return interaction.editReply({ content: `❌ You already have an open ticket for this type: <#${existing.channelId}>` });
      }
    } catch {}
    // Channel gone — clean up
    await db.delete(tickets).where(eq(tickets.channelId, existing.channelId));
  }

  const typeLabels: Record<string, string> = {
    buy1: settings?.buy1Label ?? "buy-script-1",
    buy2: settings?.buy2Label ?? "buy-script-2",
    support: settings?.supportLabel ?? "support",
  };
  const staffRoles: Record<string, string | null | undefined> = {
    buy1: settings?.buy1RoleId,
    buy2: settings?.buy2RoleId,
    support: settings?.supportRoleId,
  };

  const staffRoleId = staffRoles[type];
  const label = typeLabels[type] ?? type;
  const channelName = `ticket-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 30)}-${interaction.user.username.slice(0, 10)}`;

  // Permission overwrites: deny everyone, allow user + staff role
  const permissionOverwrites: any[] = [
    {
      id: guild.id, // @everyone
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
  ];

  if (staffRoleId) {
    permissionOverwrites.push({
      id: staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
    });
  }

  // Also give owners access
  for (const ownerId of OWNERS) {
    permissionOverwrites.push({
      id: ownerId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
    });
  }

  try {
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: settings?.categoryId ?? undefined,
      permissionOverwrites,
      reason: `Ticket created by ${interaction.user.tag}`,
    });

    await db.insert(tickets).values({
      guildId,
      channelId: channel.id,
      userId,
      ticketType: type,
    });

    const typeEmojis: Record<string, string> = { buy1: "💰", buy2: "🧠", support: "🎧" };
    const typeNames: Record<string, string> = { buy1: "Purchase", buy2: "Purchase", support: "Support" };

    const welcomeEmbed = new EmbedBuilder()
      .setColor(type === "buy1" ? 0x57f287 : type === "buy2" ? 0x5865f2 : 0x4e5058)
      .setTitle(`${typeEmojis[type]} ${typeLabels[type]}`)
      .setDescription(
        `Welcome <@${userId}>! A staff member will be with you shortly.\n\n` +
        (type === "buy1" || type === "buy2"
          ? "Please describe what you'd like to purchase and any relevant information."
          : "Please describe your issue or suggestion in detail.")
      )
      .addFields({ name: "Opened by", value: `<@${userId}>`, inline: true })
      .setTimestamp();

    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ticket-close").setLabel("🔒 Close Ticket").setStyle(ButtonStyle.Danger),
    );

    await channel.send({
      content: staffRoleId ? `<@${userId}> <@&${staffRoleId}>` : `<@${userId}>`,
      embeds: [welcomeEmbed],
      components: [closeRow],
    });

    await interaction.editReply({ content: `✅ Your ticket has been created: <#${channel.id}>` });
  } catch (err: any) {
    await interaction.editReply({ content: `❌ Could not create ticket channel. Make sure the bot has **Manage Channels** permission.\n\`${err?.message ?? err}\`` });
  }
}

export { handleCloseTicket };
