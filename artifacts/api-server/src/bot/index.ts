import {
  Client, GatewayIntentBits, Events, REST, Routes,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  EmbedBuilder, AttachmentBuilder,
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
import { generateKey, obfuscateLua, buildLoader } from "./utils/obfuscate.js";

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
];

export async function startBot() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    logger.warn("DISCORD_TOKEN or DISCORD_CLIENT_ID not set — bot will not start");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.DirectMessages,
    ],
  });

  // Register slash commands
  try {
    const rest = new REST().setToken(token);
    const commandData = allCommands.map((c) => c.data.toJSON());
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
      logger.info({ count: commandData.length }, "Registered guild slash commands");
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commandData });
      logger.info({ count: commandData.length }, "Registered global slash commands");
    }
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");
    c.user.setActivity("Serving the server", { type: 3 });
    startReminderLoop(client);
  });

  // Slash command handler
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = allCommands.find((c) => c.data.name === interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, client);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, "Command error");
        const msg = { content: "An error occurred while running this command.", ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg).catch(() => {});
        } else {
          await interaction.reply(msg).catch(() => {});
        }
      }
      return;
    }

    // Button handler
    if (interaction.isButton()) {
      const [ns, action, panelName] = interaction.customId.split(":");
      if (ns !== "panel") return;

      const [panel] = await db.select().from(panels)
        .where(and(eq(panels.guildId, interaction.guildId!), eq(panels.name, panelName)));
      if (!panel) return interaction.reply({ content: "❌ Panel not found.", ephemeral: true });

      const userId = interaction.user.id;

      // Check blacklist
      const [bl] = await db.select().from(panelBlacklist)
        .where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, userId), eq(panelBlacklist.active, true)));
      if (bl) {
        return interaction.reply({
          content: `🔨 You are blacklisted from **${panelName}**.\n**Reason:** ${bl.reason}`,
          ephemeral: true,
        });
      }

      const [wl] = await db.select().from(panelWhitelist)
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));

      if (action === "redeem") {
        // Show modal to enter key
        const modal = new ModalBuilder()
          .setCustomId(`panel-redeem:${panelName}`)
          .setTitle(`Redeem Key — ${panelName}`);
        const keyInput = new TextInputBuilder()
          .setCustomId("key")
          .setLabel("Enter your key")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("XXXXXX-XXXXXX-XXXXXX-XXXXXX")
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput));
        await interaction.showModal(modal);
        return;
      }

      if (action === "script") {
        if (!wl) {
          return interaction.reply({
            content: "❌ You are not whitelisted — redeem a key first by clicking **Redeem Key**.",
            ephemeral: true,
          });
        }
        if (!panel.scriptContent) {
          return interaction.reply({ content: "⚠️ No script has been set for this panel yet.", ephemeral: true });
        }

        // Generate or retrieve user key
        let userKey = wl.keyCode;
        if (!userKey) {
          userKey = generateKey();
          await db.update(panelWhitelist).set({ keyCode: userKey })
            .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));
        }

        // Build obfuscated script file
        const obfuscated = obfuscateLua(panel.scriptContent);
        const fullScript = `--// Light Hub | Project: ${panelName}\n--// Licensed to: ${interaction.user.tag}\nscript_key = "${userKey}"\n\n${obfuscated}`;
        const buf = Buffer.from(fullScript, "utf8");
        const file = new AttachmentBuilder(buf, { name: `${panelName}.lua` });

        await interaction.reply({
          content: `📜 **${panelName}** — Your script is attached below.\nYour key has been sent to your DMs.`,
          files: [file],
          ephemeral: true,
        });

        // Send key to DMs
        try {
          const dmEmbed = new EmbedBuilder().setColor(0x5865f2)
            .setTitle(`🔑 Your Script Key — ${panelName}`)
            .setDescription(`\`\`\`\n${userKey}\n\`\`\``)
            .addFields({ name: "Panel", value: panelName, inline: true })
            .setFooter({ text: "Do not share this key with anyone." })
            .setTimestamp();
          await interaction.user.send({ embeds: [dmEmbed] });
        } catch {}
        return;
      }

      if (action === "role") {
        if (!wl) {
          return interaction.reply({
            content: "❌ You are not whitelisted — redeem a key first by clicking **Redeem Key**.",
            ephemeral: true,
          });
        }
        if (!panel.roleId) {
          return interaction.reply({ content: "⚠️ No role has been configured for this panel. Contact an admin.", ephemeral: true });
        }
        try {
          const member = await interaction.guild!.members.fetch(userId);
          await member.roles.add(panel.roleId);
          await interaction.reply({ content: `✅ You have been given the <@&${panel.roleId}> role!`, ephemeral: true });
        } catch {
          await interaction.reply({ content: "⚠️ Role assignment is managed by admins. Contact support if you are missing your role.", ephemeral: true });
        }
        return;
      }

      if (action === "hwid") {
        if (!wl) {
          return interaction.reply({
            content: "❌ You are not whitelisted. Redeem a key first.",
            ephemeral: true,
          });
        }
        await db.update(panelWhitelist).set({ hwid: null })
          .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));
        await interaction.reply({ content: "✅ Your HWID has been reset. You can use the script on a new device.", ephemeral: true });
        return;
      }

      if (action === "stats") {
        const embed = new EmbedBuilder().setColor(0x2b2d31)
          .setTitle("Your License Stats")
          .addFields(
            { name: "Status", value: wl ? "✅ Whitelisted" : "No key", inline: false },
            { name: "HWID Locked", value: wl?.hwid ? "Yes" : "No", inline: false },
            { name: "Expires", value: "Never (permanent)", inline: false }
          );
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }
    }

    // Modal submit handler
    if (interaction.isModalSubmit()) {
      const [ns, panelName] = interaction.customId.split(":");
      if (ns !== "panel-redeem") return;

      const keyInput = interaction.fields.getTextInputValue("key").trim().toUpperCase();

      const [panel] = await db.select().from(panels)
        .where(and(eq(panels.guildId, interaction.guildId!), eq(panels.name, panelName)));
      if (!panel) return interaction.reply({ content: "❌ Panel not found.", ephemeral: true });

      // Check if already whitelisted
      const [existingWl] = await db.select().from(panelWhitelist)
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, interaction.user.id)));
      if (existingWl) {
        return interaction.reply({ content: "✅ You are already whitelisted! Click **Get Script** to get your script.", ephemeral: true });
      }

      // Validate key
      const [key] = await db.select().from(panelKeys)
        .where(and(eq(panelKeys.panelId, panel.id), eq(panelKeys.keyCode, keyInput), eq(panelKeys.active, true)));

      if (!key) {
        return interaction.reply({ content: "❌ Invalid or already used key. Please check and try again.", ephemeral: true });
      }

      if (key.usedBy && key.usedBy !== interaction.user.id) {
        return interaction.reply({ content: "❌ This key has already been redeemed by someone else.", ephemeral: true });
      }

      // Redeem
      await db.update(panelKeys).set({ usedBy: interaction.user.id, usedAt: new Date() })
        .where(eq(panelKeys.id, key.id));
      await db.insert(panelWhitelist).values({
        panelId: panel.id,
        userId: interaction.user.id,
        keyCode: keyInput,
        whitelistedBy: "key-redemption",
      });

      const embed = new EmbedBuilder().setColor(0x57f287)
        .setTitle("✅ Key Redeemed!")
        .setDescription(`You are now whitelisted for **${panelName}**!\nClick **Get Script** to access your script.`)
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Notify owners
      for (const ownerId of OWNERS) {
        try {
          const owner = await client.users.fetch(ownerId);
          const notif = new EmbedBuilder().setColor(0x5865f2)
            .setTitle("🔑 Key Redeemed")
            .addFields(
              { name: "User", value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
              { name: "Panel", value: panelName, inline: true },
              { name: "Key", value: keyInput, inline: true }
            ).setTimestamp();
          await owner.send({ embeds: [notif] });
        } catch {}
      }
    }
  });

  await client.login(token);
}

async function startReminderLoop(client: Client) {
  setInterval(async () => {
    try {
      const due = await db.select().from(reminders).where(lt(reminders.remindAt, new Date()));
      for (const r of due) {
        try {
          const channel = await client.channels.fetch(r.channelId);
          if (channel && channel.isTextBased()) {
            await (channel as any).send(`<@${r.userId}> ⏰ Reminder: **${r.message}**`);
          }
          await db.delete(reminders).where(eq(reminders.id, r.id));
        } catch {}
      }
    } catch {}
  }, 30_000);
}
