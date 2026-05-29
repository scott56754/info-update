import { Client, GatewayIntentBits, Collection, Events, REST, Routes } from "discord.js";
import { logger } from "../lib/logger.js";
import { db } from "@workspace/db";
import { reminders } from "@workspace/db";
import { lt, eq } from "drizzle-orm";

import { funCommands } from "./commands/fun.js";
import { moderationCommands } from "./commands/moderation.js";
import { economyCommands } from "./commands/economy.js";
import { infoCommands } from "./commands/info.js";
import { utilityCommands } from "./commands/utility.js";
import { musicCommands } from "./commands/music.js";
import { setupCommands } from "./commands/setup.js";

const allCommands = [
  ...funCommands,
  ...moderationCommands,
  ...economyCommands,
  ...infoCommands,
  ...utilityCommands,
  ...musicCommands,
  ...setupCommands,
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

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = allCommands.find((c) => c.data.name === interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client);
    } catch (err) {
      logger.error({ err, command: interaction.commandName }, "Command error");
      const msg = { content: "An error occurred while running this command.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    }
  });

  await client.login(token);
}

async function startReminderLoop(client: Client) {
  setInterval(async () => {
    try {
      const due = await db
        .select()
        .from(reminders)
        .where(lt(reminders.remindAt, new Date()));

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
