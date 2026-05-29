import {
  Client, GatewayIntentBits, Events, REST, Routes,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  EmbedBuilder, type Logger,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { db } from "@workspace/db";
import { reminders, panels, panelKeys, panelWhitelist, panelBlacklist } from "@workspace/db";
import { lt, eq, and } from "drizzle-orm";

import { funCommands } from "./commands/fun.js";
import { moderationCommands } from "./commands/moderation.js";
import { economyCommands } from "./commands/economy.js";
import { infoCommands } from "./commands/info.js";
import { utilityCommands } from "./commands/utility.js";
import { musicCommands } from "./commands/music.js";
import { setupCommands } from "./commands/setup.js";
import { panelCommands } from "./commands/panel.js";
import { ticketCommands, handleTicketButton, handleCloseTicket } from "./commands/ticket.js";
import { giveawayCommands, handleGiveawayButton, startGiveawayLoop } from "./commands/giveaway.js";
import { antiNukeCommands, setupAntiNuke } from "./commands/antinuke.js";
import { generateKey, buildLoader } from "./utils/obfuscate.js";
import { handlePrefixMessage } from "./prefix.js";

const OWNERS = ["1417552037717086355", "1501051958629503097"];

const allCommands = [
  ...funCommands,
  ...moderationCommands,
  ...economyCommands,
  ...infoCommands,
  ...utilityCommands,
  ...musicCommands,
  ...setupCommands,
  ...panelCommands,
  ...ticketCommands,
  ...giveawayCommands,
  ...antiNukeCommands,
];

const BASE_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
];

export async function startBot() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    logger.warn("DISCORD_TOKEN or DISCORD_CLIENT_ID not set — bot will not start");
    return;
  }

  // Progressively fall back intent combinations until one works.
  // Privileged intents (MessageContent, GuildMembers, GuildModeration) must be enabled
  // in the Discord Developer Portal under Bot → Privileged Gateway Intents.
  const intentSets: Array<{ intents: GatewayIntentBits[]; prefixEnabled: boolean; label: string }> = [
    {
      label: "full (MessageContent + GuildMembers + GuildModeration)",
      intents: [...BASE_INTENTS, GatewayIntentBits.MessageContent],
      prefixEnabled: true,
    },
    {
      label: "no MessageContent (GuildMembers + GuildModeration)",
      intents: BASE_INTENTS,
      prefixEnabled: false,
    },
    {
      label: "minimal (no privileged intents)",
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
      ],
      prefixEnabled: false,
    },
  ];

  for (const { intents, prefixEnabled, label } of intentSets) {
    try {
      const client = new Client({ intents });
      await setupAndLogin(client, token, clientId, guildId, prefixEnabled);
      return;
    } catch (err: any) {
      if (err?.message === "Used disallowed intents") {
        logger.warn(
          { label },
          "Intent set disallowed — trying next fallback. " +
          "Enable Privileged Gateway Intents in Discord Developer Portal → Bot → Privileged Gateway Intents."
        );
      } else {
        throw err;
      }
    }
  }

  logger.error("Bot failed to start — all intent combinations rejected.");
}

async function setupAndLogin(
  client: Client,
  token: string,
  clientId: string,
  guildId: string | undefined,
  prefixEnabled: boolean,
) {
  // Register slash commands — guild first, global as fallback, always clear the other to avoid duplicates
  try {
    const rest = new REST().setToken(token);
    const commandData = allCommands.map((c) => c.data.toJSON());
    if (guildId) {
      try {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
        logger.info({ count: commandData.length }, "Registered guild slash commands");
        await rest.put(Routes.applicationCommands(clientId), { body: [] }).catch(() => {});
      } catch (guildErr: any) {
        logger.warn({ code: guildErr?.code }, "Guild command registration failed — falling back to global");
        await rest.put(Routes.applicationCommands(clientId), { body: commandData });
        logger.info({ count: commandData.length }, "Registered global slash commands (fallback)");
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] }).catch(() => {});
      }
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commandData });
      logger.info({ count: commandData.length }, "Registered global slash commands");
    }
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }

  // Ready
  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag, prefixEnabled }, "Discord bot ready");
    c.user.setActivity("Serving the server", { type: 3 });
    startReminderLoop(client);
    startGiveawayLoop(client);
    setupAntiNuke(client);
  });

  // Prefix commands (.!?)
  if (prefixEnabled) {
    client.on(Events.MessageCreate, async (message) => {
      await handlePrefixMessage(message, client).catch(() => {});
    });
  }

  // Slash commands + button/modal interactions
  client.on(Events.InteractionCreate, async (interaction) => {
    // ── Slash commands ──────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = allCommands.find((c) => c.data.name === interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, client);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, "Command error");
        const msg = { content: "An error occurred while running this command.", ephemeral: true };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
        else await interaction.reply(msg).catch(() => {});
      }
      return;
    }

    // ── Buttons ─────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      // Ticket close
      if (interaction.customId === "ticket-close") {
        await handleCloseTicket(interaction as any);
        return;
      }
      // Ticket open
      if (interaction.customId.startsWith("ticket:")) {
        await handleTicketButton(interaction, client, interaction.customId.split(":")[1]);
        return;
      }
      // Giveaway enter/leave
      if (interaction.customId.startsWith("giveaway:enter:")) {
        const giveawayId = parseInt(interaction.customId.split(":")[2]);
        if (!isNaN(giveawayId)) {
          await handleGiveawayButton(interaction, client, giveawayId);
        }
        return;
      }
      // Panel buttons
      const [ns, action, panelName] = interaction.customId.split(":");
      if (ns !== "panel") return;
      await handlePanelButton(interaction, client, action, panelName);
      return;
    }

    // ── Modals ──────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const [ns, panelName] = interaction.customId.split(":");
      if (ns !== "panel-redeem") return;
      await handlePanelRedeem(interaction, client, panelName);
    }
  });

  await client.login(token);
}

// ── Panel button handler ───────────────────────────────────────────────────

async function handlePanelButton(interaction: any, client: Client, action: string, panelName: string) {
  const [panel] = await db.select().from(panels)
    .where(and(eq(panels.guildId, interaction.guildId), eq(panels.name, panelName)));
  if (!panel) return interaction.reply({ content: "❌ Panel not found.", ephemeral: true });

  const userId = interaction.user.id;

  const [bl] = await db.select().from(panelBlacklist)
    .where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, userId), eq(panelBlacklist.active, true)));
  if (bl) {
    return interaction.reply({ content: `🔨 You are blacklisted from **${panelName}**.\n**Reason:** ${bl.reason}`, ephemeral: true });
  }

  const [wl] = await db.select().from(panelWhitelist)
    .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));

  // Check whitelist expiry
  if (wl?.expiresAt && wl.expiresAt <= new Date()) {
    return interaction.reply({ content: "⏰ Your access has **expired**. Contact an admin to renew.", ephemeral: true });
  }

  if (action === "redeem") {
    const modal = new ModalBuilder()
      .setCustomId(`panel-redeem:${panelName}`)
      .setTitle(`Redeem Key — ${panelName}`);
    const keyInput = new TextInputBuilder()
      .setCustomId("key").setLabel("Enter your key")
      .setStyle(TextInputStyle.Short).setPlaceholder("XXXXXX-XXXXXX-XXXXXX-XXXXXX").setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput));
    await interaction.showModal(modal);
    return;
  }

  if (action === "script") {
    if (!wl) return interaction.reply({ content: "❌ You are not whitelisted — redeem a key first by clicking **Redeem Key**.", ephemeral: true });
    if (!panel.scriptContent) return interaction.reply({ content: "⚠️ No script has been set for this panel yet.", ephemeral: true });

    let userKey = wl.keyCode;
    if (!userKey) {
      userKey = generateKey();
      await db.update(panelWhitelist).set({ keyCode: userKey })
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));
    }

    const domain = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `http://localhost:${process.env.PORT ?? 8080}`;

    const loaderUrl = `${domain}/api/loader/${encodeURIComponent(panelName)}/${encodeURIComponent(userKey)}`;
    const scriptBlock = `script_key="${userKey}";\nloadstring(game:HttpGet("${loaderUrl}"))()`;

    await interaction.reply({ content: `Here is your script:\n\`\`\`lua\n${scriptBlock}\n\`\`\``, ephemeral: true });

    try {
      await interaction.user.send({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🔑 Your Script Key — ${panelName}`)
          .setDescription(`\`\`\`\n${userKey}\n\`\`\``)
          .addFields(
            { name: "Panel", value: panelName, inline: true },
            { name: "Expires", value: wl.expiresAt ? `<t:${Math.floor(wl.expiresAt.getTime() / 1000)}:R>` : "Never", inline: true },
          )
          .setFooter({ text: "Do not share this key." }).setTimestamp()],
      });
    } catch {}
    return;
  }

  if (action === "role") {
    if (!wl) return interaction.reply({ content: "❌ You are not whitelisted — redeem a key first.", ephemeral: true });
    if (!panel.roleId) return interaction.reply({ content: "⚠️ No role configured for this panel. Contact an admin.", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      const member = await interaction.guild.members.fetch(userId);
      await member.roles.add(panel.roleId);
      await interaction.editReply({ content: `✅ You have been given the <@&${panel.roleId}> role!` });
    } catch {
      await interaction.editReply({ content: "⚠️ Role assignment is managed by admins. Contact support if you are missing your role." });
    }
    return;
  }

  if (action === "hwid") {
    if (!wl) return interaction.reply({ content: "❌ You are not whitelisted. Redeem a key first.", ephemeral: true });
    await db.update(panelWhitelist).set({ hwid: null })
      .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));
    await interaction.reply({ content: "✅ Your HWID has been reset. You can use the script on a new device.", ephemeral: true });
    return;
  }

  if (action === "stats") {
    const expiryValue = wl?.expiresAt
      ? (wl.expiresAt <= new Date() ? "⏰ Expired" : `<t:${Math.floor(wl.expiresAt.getTime() / 1000)}:R>`)
      : "Never (permanent)";
    const e = new EmbedBuilder().setColor(0x2b2d31).setTitle("Your License Stats")
      .addFields(
        { name: "Status", value: wl ? "✅ Whitelisted" : "❌ No access", inline: false },
        { name: "HWID Locked", value: wl?.hwid ? "Yes" : "No", inline: false },
        { name: "Expires", value: expiryValue, inline: false },
      );
    await interaction.reply({ embeds: [e], ephemeral: true });
  }
}

// ── Panel redeem modal handler ─────────────────────────────────────────────

async function handlePanelRedeem(interaction: any, client: Client, panelName: string) {
  const keyInput = interaction.fields.getTextInputValue("key").trim().toUpperCase();

  const [panel] = await db.select().from(panels)
    .where(and(eq(panels.guildId, interaction.guildId), eq(panels.name, panelName)));
  if (!panel) return interaction.reply({ content: "❌ Panel not found.", ephemeral: true });

  const [existingWl] = await db.select().from(panelWhitelist)
    .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, interaction.user.id)));
  if (existingWl) return interaction.reply({ content: "✅ You are already whitelisted! Click **Get Script** to access your script.", ephemeral: true });

  const [key] = await db.select().from(panelKeys)
    .where(and(eq(panelKeys.panelId, panel.id), eq(panelKeys.keyCode, keyInput), eq(panelKeys.active, true)));
  if (!key) return interaction.reply({ content: "❌ Invalid or already used key. Please check and try again.", ephemeral: true });
  if (key.usedBy && key.usedBy !== interaction.user.id) return interaction.reply({ content: "❌ This key has already been redeemed by someone else.", ephemeral: true });

  // Check key expiry
  if (key.expiresAt && key.expiresAt <= new Date()) {
    return interaction.reply({ content: "❌ This key has expired and can no longer be redeemed.", ephemeral: true });
  }

  await db.update(panelKeys).set({ usedBy: interaction.user.id, usedAt: new Date() }).where(eq(panelKeys.id, key.id));
  await db.insert(panelWhitelist).values({
    panelId: panel.id,
    userId: interaction.user.id,
    keyCode: keyInput,
    whitelistedBy: "key-redemption",
    expiresAt: key.expiresAt,
  });

  const expiryNote = key.expiresAt
    ? `\nYour access expires <t:${Math.floor(key.expiresAt.getTime() / 1000)}:R>.`
    : "";

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Key Redeemed!")
      .setDescription(`You are now whitelisted for **${panelName}**!\nClick **Get Script** to access your script.${expiryNote}`)
      .setTimestamp()],
    ephemeral: true,
  });

  // Notify owners
  for (const ownerId of OWNERS) {
    try {
      const owner = await client.users.fetch(ownerId);
      await owner.send({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🔑 Key Redeemed")
          .addFields(
            { name: "User", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
            { name: "Panel", value: panelName, inline: true },
            { name: "Key", value: keyInput, inline: true },
            { name: "Expires", value: key.expiresAt ? `<t:${Math.floor(key.expiresAt.getTime() / 1000)}:R>` : "Never", inline: true },
          ).setTimestamp()],
      });
    } catch {}
  }
}

// ── Reminder loop ──────────────────────────────────────────────────────────

async function startReminderLoop(client: Client) {
  setInterval(async () => {
    try {
      const due = await db.select().from(reminders).where(lt(reminders.remindAt, new Date()));
      for (const r of due) {
        try {
          const channel = await client.channels.fetch(r.channelId);
          if (channel?.isTextBased()) await (channel as any).send(`<@${r.userId}> ⏰ Reminder: **${r.message}**`);
          await db.delete(reminders).where(eq(reminders.id, r.id));
        } catch {}
      }
    } catch {}
  }, 30_000);
}
