import {
  Client, GatewayIntentBits, Events, REST, Routes,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { db } from "@workspace/db";
import { reminders, panels, panelKeys, panelWhitelist, panelBlacklist, panelRoleWhitelist, panelRoleBlacklist, guildSettings } from "@workspace/db";
import { lt, eq, and } from "drizzle-orm";

import { funCommands } from "./commands/fun.js";
import { moderationCommands } from "./commands/moderation.js";
import { economyCommands } from "./commands/economy.js";
import { infoCommands } from "./commands/info.js";
import { utilityCommands } from "./commands/utility.js";
import { musicCommands } from "./commands/music.js";
import { setupCommands, buildWelcomeEmbed, replacePlaceholders } from "./commands/setup.js";
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

// Non-privileged intents — always safe to request
const SAFE_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.DirectMessages,
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

  // Try each intent combination from most to least privileged.
  // Privileged intents require opt-in at:
  //   Discord Developer Portal → Application → Bot → Privileged Gateway Intents
  //   ✅ SERVER MEMBERS INTENT  — enables welcome, auto-role
  //   ✅ MESSAGE CONTENT INTENT — enables prefix commands (. ! ?)
  type IntentSet = { intents: GatewayIntentBits[]; prefixEnabled: boolean; membersEnabled: boolean; label: string };
  const intentSets: IntentSet[] = [
    {
      label: "full (MessageContent + GuildMembers)",
      intents: [...SAFE_INTENTS, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
      prefixEnabled: true,
      membersEnabled: true,
    },
    {
      label: "MessageContent only (no GuildMembers)",
      intents: [...SAFE_INTENTS, GatewayIntentBits.MessageContent],
      prefixEnabled: true,
      membersEnabled: false,
    },
    {
      label: "GuildMembers only (no MessageContent)",
      intents: [...SAFE_INTENTS, GatewayIntentBits.GuildMembers],
      prefixEnabled: false,
      membersEnabled: true,
    },
    {
      label: "minimal (no privileged intents)",
      intents: SAFE_INTENTS,
      prefixEnabled: false,
      membersEnabled: false,
    },
  ];

  for (const { intents, prefixEnabled, membersEnabled, label } of intentSets) {
    try {
      const client = new Client({ intents });
      await setupAndLogin(client, token, clientId, guildId, prefixEnabled, membersEnabled);
      return;
    } catch (err: any) {
      if (err?.message === "Used disallowed intents") {
        logger.warn(
          { label },
          "Intent set disallowed — trying next fallback. " +
          "Enable in Discord Developer Portal → Bot → Privileged Gateway Intents."
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
  membersEnabled: boolean,
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

  // Prevent unhandled Discord API errors (expired interactions, unknown interactions, etc.) from crashing the process
  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error (handled)");
  });

  // Ready
  client.once(Events.ClientReady, (c) => {
    logger.info(
      {
        tag: c.user.tag,
        prefixCommands: prefixEnabled ? "✅ enabled (.  !  ?)" : "❌ disabled — enable Message Content Intent in Discord Dev Portal",
        welcomeAutoRole: membersEnabled ? "✅ enabled" : "❌ disabled — enable Server Members Intent in Discord Dev Portal",
      },
      "Discord bot ready",
    );
    if (!prefixEnabled) {
      logger.warn(
        "Prefix commands (. ! ?) are DISABLED. " +
        "To enable: Discord Dev Portal → Your App → Bot → Privileged Gateway Intents → turn on MESSAGE CONTENT INTENT",
      );
    }
    if (!membersEnabled) {
      logger.warn(
        "Welcome/auto-role on join is DISABLED. " +
        "To enable: Discord Dev Portal → Your App → Bot → Privileged Gateway Intents → turn on SERVER MEMBERS INTENT",
      );
    }
    c.user.setActivity("Serving the server", { type: 3 });
    startReminderLoop(client);
    startGiveawayLoop(client);
    setupAntiNuke(client);
  });

  // Prefix commands (.!?) — requires Message Content Intent
  if (prefixEnabled) {
    client.on(Events.MessageCreate, async (message) => {
      await handlePrefixMessage(message, client).catch(() => {});
    });
  }

  // Welcome message + auto-role + DM on member join — requires Server Members Intent
  if (membersEnabled) {
    client.on(Events.GuildMemberAdd, async (member) => {
      try {
        const [settings] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, member.guild.id));
        if (!settings) return;

        // Auto-roles (comma-separated IDs)
        if (settings.welcomeAutoRoleId) {
          const roleIds = settings.welcomeAutoRoleId.split(",").map((id) => id.trim()).filter(Boolean);
          for (const roleId of roleIds) {
            const role = member.guild.roles.cache.get(roleId);
            if (role) await member.roles.add(role).catch(() => {});
          }
        }

        // Welcome embed in channel
        if (settings.welcomeChannel && settings.welcomeMessage) {
          const ch = await member.guild.channels.fetch(settings.welcomeChannel).catch(() => null);
          if (ch?.isTextBased()) {
            const embed = buildWelcomeEmbed(settings, member, member.guild);
            await (ch as any).send({ embeds: [embed] });
          }
        }

        // DM the new member
        if (settings.welcomeDmMessage) {
          const dmText = replacePlaceholders(settings.welcomeDmMessage, member, member.guild);
          const color = parseInt(settings.welcomeColor?.replace("#", "") ?? "5865f2", 16) || 0x5865f2;
          const dmEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`👋 Welcome to ${member.guild.name}!`)
            .setDescription(dmText)
            .setThumbnail(member.guild.iconURL({ size: 256 }) ?? null)
            .setTimestamp();
          await member.user.send({ embeds: [dmEmbed] }).catch(() => {});
        }
      } catch (err) {
        logger.error({ err }, "Failed to send welcome message");
      }
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
        const errOpts = { content: "An error occurred while running this command.", ephemeral: true } as const;
        if (interaction.replied || interaction.deferred) await interaction.followUp(errOpts).catch(() => {});
        else await interaction.reply(errOpts).catch(() => {});
      }
      return;
    }

    // ── Buttons ─────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      try {
        if (interaction.customId === "ticket-close") {
          await handleCloseTicket(interaction as any);
          return;
        }
        if (interaction.customId.startsWith("ticket:")) {
          await handleTicketButton(interaction, client, interaction.customId.split(":")[1]);
          return;
        }
        if (interaction.customId.startsWith("giveaway:enter:")) {
          const giveawayId = parseInt(interaction.customId.split(":")[2]);
          if (!isNaN(giveawayId)) {
            await handleGiveawayButton(interaction, client, giveawayId);
          }
          return;
        }
        const [ns, action, panelName] = interaction.customId.split(":");
        if (ns !== "panel") return;
        await handlePanelButton(interaction, client, action, panelName);
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, "Button handler error");
      }
      return;
    }

    // ── Modals ──────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      try {
        const [ns, panelName] = interaction.customId.split(":");
        if (ns !== "panel-redeem") return;
        await handlePanelRedeem(interaction, client, panelName);
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, "Modal handler error");
      }
    }
  });

  await client.login(token);
}

// ── Panel button handler ───────────────────────────────────────────────────

async function handlePanelButton(interaction: any, client: Client, action: string, panelName: string) {
  const [panel] = await db.select().from(panels)
    .where(and(eq(panels.guildId, interaction.guildId), eq(panels.name, panelName)));
  if (!panel) return interaction.reply({ content: "❌ Panel not found.", flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;

  // Fetch member to get their roles
  let memberRoleIds: string[] = [];
  try {
    const member = await interaction.guild.members.fetch(userId);
    memberRoleIds = [...member.roles.cache.keys()];
  } catch {}

  // Check individual user blacklist
  const [bl] = await db.select().from(panelBlacklist)
    .where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, userId), eq(panelBlacklist.active, true)));
  if (bl) {
    return interaction.reply({ content: `🔨 You are blacklisted from **${panelName}**.\n**Reason:** ${bl.reason}`, flags: MessageFlags.Ephemeral });
  }

  // Check role blacklist — if any of the user's roles are blacklisted, deny access
  if (memberRoleIds.length) {
    const roleBlacklists = await db.select().from(panelRoleBlacklist)
      .where(and(eq(panelRoleBlacklist.panelId, panel.id), eq(panelRoleBlacklist.active, true)));
    const blockedRole = roleBlacklists.find((rb) => memberRoleIds.includes(rb.roleId));
    if (blockedRole) {
      return interaction.reply({ content: `🔨 Your role is blacklisted from **${panelName}**.\n**Reason:** ${blockedRole.reason}`, flags: MessageFlags.Ephemeral });
    }
  }

  const [wl] = await db.select().from(panelWhitelist)
    .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));

  // Check whitelist expiry
  if (wl?.expiresAt && wl.expiresAt <= new Date()) {
    return interaction.reply({ content: "⏰ Your access has **expired**. Contact an admin to renew.", flags: MessageFlags.Ephemeral });
  }

  // Check role whitelist — if any of the user's roles are whitelisted, treat them as whitelisted
  let roleWl: typeof panelRoleWhitelist.$inferSelect | undefined;
  if (!wl && memberRoleIds.length) {
    const roleWhitelists = await db.select().from(panelRoleWhitelist)
      .where(eq(panelRoleWhitelist.panelId, panel.id));
    const now = new Date();
    roleWl = roleWhitelists.find((rw) =>
      memberRoleIds.includes(rw.roleId) && !(rw.expiresAt && rw.expiresAt <= now)
    );
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

  const hasAccess = !!(wl || roleWl);

  if (action === "script") {
    if (!hasAccess) return interaction.reply({ content: "❌ You are not whitelisted — redeem a key first by clicking **Redeem Key**.", flags: MessageFlags.Ephemeral });
    if (!panel.scriptContent) return interaction.reply({ content: "⚠️ No script has been set for this panel yet.", flags: MessageFlags.Ephemeral });

    let userKey = wl?.keyCode ?? null;
    if (!userKey) {
      userKey = generateKey();
      if (wl) {
        await db.update(panelWhitelist).set({ keyCode: userKey })
          .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));
      }
    }

    const domain = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `http://localhost:${process.env.PORT ?? 8080}`;

    const loaderUrl = `${domain}/api/loader/${encodeURIComponent(panelName)}/${encodeURIComponent(userKey)}`;
    const scriptBlock = `script_key="${userKey}";\nloadstring(game:HttpGet("${loaderUrl}"))()`;

    const accessExpiry = wl?.expiresAt ?? roleWl?.expiresAt ?? null;
    await interaction.reply({ content: `Here is your script:\n\`\`\`lua\n${scriptBlock}\n\`\`\``, flags: MessageFlags.Ephemeral });

    try {
      await interaction.user.send({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🔑 Your Script Key — ${panelName}`)
          .setDescription(`\`\`\`\n${userKey}\n\`\`\``)
          .addFields(
            { name: "Panel", value: panelName, inline: true },
            { name: "Expires", value: accessExpiry ? `<t:${Math.floor(accessExpiry.getTime() / 1000)}:R>` : "Never", inline: true },
          )
          .setFooter({ text: "Do not share this key." }).setTimestamp()],
      });
    } catch {}
    return;
  }

  if (action === "role") {
    if (!hasAccess) return interaction.reply({ content: "❌ You are not whitelisted — redeem a key first.", flags: MessageFlags.Ephemeral });
    if (!panel.roleId) return interaction.reply({ content: "⚠️ No role configured for this panel. Contact an admin.", flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    if (!hasAccess) return interaction.reply({ content: "❌ You are not whitelisted. Redeem a key first.", flags: MessageFlags.Ephemeral });
    if (wl) {
      await db.update(panelWhitelist).set({ hwid: null })
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));
    }
    await interaction.reply({ content: "✅ Your HWID has been reset. You can use the script on a new device.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "stats") {
    const activeWl = wl ?? roleWl;
    const accessType = wl ? "✅ Whitelisted (user)" : roleWl ? "✅ Whitelisted (role)" : "❌ No access";
    const expiryValue = activeWl?.expiresAt
      ? (activeWl.expiresAt <= new Date() ? "⏰ Expired" : `<t:${Math.floor(activeWl.expiresAt.getTime() / 1000)}:R>`)
      : hasAccess ? "Never (permanent)" : "—";
    const e = new EmbedBuilder().setColor(0x2b2d31).setTitle("Your License Stats")
      .addFields(
        { name: "Status", value: accessType, inline: false },
        { name: "HWID Locked", value: wl?.hwid ? "Yes" : "No", inline: false },
        { name: "Expires", value: expiryValue, inline: false },
      );
    await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  }
}

// ── Panel redeem modal handler ─────────────────────────────────────────────

async function handlePanelRedeem(interaction: any, client: Client, panelName: string) {
  const keyInput = interaction.fields.getTextInputValue("key").trim().toUpperCase();

  const [panel] = await db.select().from(panels)
    .where(and(eq(panels.guildId, interaction.guildId), eq(panels.name, panelName)));
  if (!panel) return interaction.reply({ content: "❌ Panel not found.", flags: MessageFlags.Ephemeral });

  const [existingWl] = await db.select().from(panelWhitelist)
    .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, interaction.user.id)));
  if (existingWl) return interaction.reply({ content: "✅ You are already whitelisted! Click **Get Script** to access your script.", flags: MessageFlags.Ephemeral });

  const [key] = await db.select().from(panelKeys)
    .where(and(eq(panelKeys.panelId, panel.id), eq(panelKeys.keyCode, keyInput), eq(panelKeys.active, true)));
  if (!key) return interaction.reply({ content: "❌ Invalid or already used key. Please check and try again.", flags: MessageFlags.Ephemeral });
  if (key.usedBy && key.usedBy !== interaction.user.id) return interaction.reply({ content: "❌ This key has already been redeemed by someone else.", flags: MessageFlags.Ephemeral });

  // Check key expiry
  if (key.expiresAt && key.expiresAt <= new Date()) {
    return interaction.reply({ content: "❌ This key has expired and can no longer be redeemed.", flags: MessageFlags.Ephemeral });
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
    flags: MessageFlags.Ephemeral,
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
