import {
  SlashCommandBuilder, ChatInputCommandInteraction, Client,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, AttachmentBuilder,
} from "discord.js";
import { db } from "@workspace/db";
import { panels, panelKeys, panelWhitelist, panelBlacklist } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateKey } from "../utils/obfuscate.js";

const OWNERS = ["1417552037717086355", "1501051958629503097"];

function isOwner(userId: string) {
  return OWNERS.includes(userId);
}

function ownerOnly(interaction: ChatInputCommandInteraction) {
  if (!isOwner(interaction.user.id)) {
    interaction.reply({ content: "❌ You are not authorized to use this command.", ephemeral: true });
    return false;
  }
  return true;
}

async function getPanel(guildId: string, name: string) {
  const [panel] = await db.select().from(panels).where(
    and(eq(panels.guildId, guildId), eq(panels.name, name.toLowerCase()))
  );
  return panel ?? null;
}

function panelEmbed(panel: typeof panels.$inferSelect) {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(
      `**${panel.name}**\n\n${panel.description}\nIf you're a buyer, click on the buttons below to redeem your key, get the script or get your role`
    );
}

function panelButtons(panelName: string) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`panel:redeem:${panelName}`).setLabel("🔑 Redeem Key").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`panel:script:${panelName}`).setLabel("📜 Get Script").setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`panel:role:${panelName}`).setLabel("👤 Get Role").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`panel:hwid:${panelName}`).setLabel("⚙️ Reset HWID").setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`panel:stats:${panelName}`).setLabel("📊 Get Stats").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3];
}

function parseDuration(s: string): number | null {
  const match = s.match(/^(\d+)(h|d|w|m)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const ms: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 604_800_000, m: 30 * 86_400_000 };
  return n * (ms[unit] ?? 0);
}

function formatTimeLeft(expiresAt: Date | null | undefined): string {
  if (!expiresAt) return "Never";
  const now = Date.now();
  const diff = expiresAt.getTime() - now;
  if (diff <= 0) return "⏰ Expired";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : "<1m";
}

export const panelCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("panel")
      .setDescription("Open a script control panel")
      .addStringOption((o) => o.setName("name").setDescription("Panel name").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const name = interaction.options.getString("name", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ No panel named **${name}** found.`, ephemeral: true });
      await interaction.reply({
        embeds: [panelEmbed(panel)],
        components: panelButtons(name),
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("createpanel")
      .setDescription("Create a new script panel")
      .addStringOption((o) => o.setName("name").setDescription("Panel name (no spaces)").setRequired(true))
      .addStringOption((o) => o.setName("description").setDescription("Panel description").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("name", true).toLowerCase().replace(/\s+/g, "-");
      const description = interaction.options.getString("description") ?? `This control panel is for the project: **${name}**\nIf you're a buyer, click on the buttons below to redeem your key, get the script or get your role`;
      const existing = await getPanel(interaction.guildId!, name);
      if (existing) return interaction.reply({ content: `❌ A panel named **${name}** already exists.`, ephemeral: true });
      await db.insert(panels).values({ guildId: interaction.guildId!, name, description, createdBy: interaction.user.id });
      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ Panel Created")
        .addFields(
          { name: "Name", value: name, inline: true },
          { name: "Use", value: `/panel name:${name}`, inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setscriptsource")
      .setDescription("Upload the Lua script for a panel (max 400KB)")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addAttachmentOption((o) => o.setName("script").setDescription("Upload your .lua script file (max 400KB)").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      await interaction.deferReply({ ephemeral: true });
      const name = interaction.options.getString("panel", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.editReply({ content: `❌ Panel **${name}** not found.` });

      const attachment = interaction.options.getAttachment("script", true);
      if (attachment.size > 400 * 1024) return interaction.editReply({ content: "❌ Script file must be under 400KB." });

      const res = await fetch(attachment.url);
      const content = await res.text();
      if (!content.trim()) return interaction.editReply({ content: "❌ Script file is empty." });

      await db.update(panels).set({ scriptContent: content }).where(eq(panels.id, panel.id));
      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ Script Uploaded")
        .addFields(
          { name: "Panel", value: name, inline: true },
          { name: "Size", value: `${(attachment.size / 1024).toFixed(1)} KB`, inline: true },
          { name: "Lines", value: `${content.split("\n").length}`, inline: true }
        );
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setrole")
      .setDescription("Set the role given to whitelisted users for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Role to assign").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const role = interaction.options.getRole("role", true);
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, ephemeral: true });
      await db.update(panels).set({ roleId: role.id }).where(eq(panels.id, panel.id));
      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ Role Set")
        .addFields({ name: "Panel", value: name, inline: true }, { name: "Role", value: `${role}`, inline: true });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("whitelist")
      .setDescription("Whitelist a user for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addUserOption((o) => o.setName("user").setDescription("User to whitelist").setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("How long access lasts e.g. 7d, 30d, 1h (leave blank for permanent)").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const target = interaction.options.getUser("user", true);
      const durationStr = interaction.options.getString("duration");
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, ephemeral: true });

      let expiresAt: Date | null = null;
      if (durationStr) {
        const ms = parseDuration(durationStr);
        if (!ms) return interaction.reply({ content: "❌ Invalid duration format. Use e.g. `7d`, `30d`, `24h`.", ephemeral: true });
        expiresAt = new Date(Date.now() + ms);
      }

      const [existing] = await db.select().from(panelWhitelist)
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, target.id)));
      if (existing) return interaction.reply({ content: `❌ ${target.tag} is already whitelisted for **${name}**.`, ephemeral: true });

      const [bl] = await db.select().from(panelBlacklist)
        .where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, target.id), eq(panelBlacklist.active, true)));
      if (bl) return interaction.reply({ content: `❌ ${target.tag} is blacklisted from **${name}**. Unblacklist them first.`, ephemeral: true });

      await db.insert(panelWhitelist).values({
        panelId: panel.id,
        userId: target.id,
        whitelistedBy: interaction.user.id,
        expiresAt,
      });

      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ User Whitelisted")
        .addFields(
          { name: "User", value: `${target.tag} (${target.id})`, inline: true },
          { name: "Panel", value: name, inline: true },
          { name: "By", value: interaction.user.tag, inline: true },
          { name: "Expires", value: expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : "Never (permanent)", inline: true },
        );
      await interaction.reply({ embeds: [embed] });

      try {
        const dmEmbed = new EmbedBuilder().setColor(0x57f287)
          .setTitle("✅ You have been whitelisted!")
          .setDescription(
            `You have been whitelisted for the **${name}** script.\nYou can access the script via the panel in the server.`
          )
          .addFields({ name: "Expires", value: expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : "Never (permanent)", inline: true })
          .setTimestamp();
        await target.send({ embeds: [dmEmbed] });
      } catch {}
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unwhitelist")
      .setDescription("Remove a user from the whitelist for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addUserOption((o) => o.setName("user").setDescription("User to remove").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const target = interaction.options.getUser("user", true);
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, ephemeral: true });

      const deleted = await db.delete(panelWhitelist)
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, target.id)))
        .returning();
      if (!deleted.length) return interaction.reply({ content: `❌ ${target.tag} is not whitelisted for **${name}**.`, ephemeral: true });

      const embed = new EmbedBuilder().setColor(0xed4245).setTitle("🚫 User Unwhitelisted")
        .addFields({ name: "User", value: target.tag, inline: true }, { name: "Panel", value: name, inline: true });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("blacklist")
      .setDescription("Blacklist a user from a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addUserOption((o) => o.setName("user").setDescription("User to blacklist").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const target = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, ephemeral: true });

      await db.delete(panelWhitelist)
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, target.id)));

      await db.update(panelBlacklist).set({ active: false })
        .where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, target.id)));
      await db.insert(panelBlacklist).values({
        panelId: panel.id,
        userId: target.id,
        reason,
        blacklistedBy: interaction.user.id,
      });

      const embed = new EmbedBuilder().setColor(0xed4245).setTitle("🔨 User Blacklisted")
        .addFields(
          { name: "User", value: `${target.tag} (${target.id})`, inline: true },
          { name: "Panel", value: name, inline: true },
          { name: "Reason", value: reason }
        );
      await interaction.reply({ embeds: [embed] });

      try {
        const dmEmbed = new EmbedBuilder().setColor(0xed4245)
          .setTitle("🔨 You have been blacklisted")
          .addFields(
            { name: "Panel", value: name, inline: true },
            { name: "Reason", value: reason }
          )
          .setTimestamp();
        await target.send({ embeds: [dmEmbed] });
      } catch {}
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unblacklist")
      .setDescription("Remove a user from the blacklist for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addUserOption((o) => o.setName("user").setDescription("User to unblacklist").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const target = interaction.options.getUser("user", true);
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, ephemeral: true });

      await db.update(panelBlacklist).set({ active: false })
        .where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, target.id)));

      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ User Unblacklisted")
        .addFields({ name: "User", value: target.tag, inline: true }, { name: "Panel", value: name, inline: true });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("generatekeys")
      .setDescription("Generate keys for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addIntegerOption((o) => o.setName("count").setDescription("Number of keys to generate (1-50)").setMinValue(1).setMaxValue(50).setRequired(false))
      .addStringOption((o) => o.setName("duration").setDescription("Key expiry duration e.g. 7d, 30d, 24h (leave blank for permanent)").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const count = interaction.options.getInteger("count") ?? 1;
      const durationStr = interaction.options.getString("duration");
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, ephemeral: true });

      let expiresAt: Date | null = null;
      if (durationStr) {
        const ms = parseDuration(durationStr);
        if (!ms) return interaction.reply({ content: "❌ Invalid duration format. Use e.g. `7d`, `30d`, `24h`.", ephemeral: true });
        expiresAt = new Date(Date.now() + ms);
      }

      const keys: string[] = [];
      for (let i = 0; i < count; i++) {
        const keyCode = generateKey();
        await db.insert(panelKeys).values({ panelId: panel.id, keyCode, expiresAt });
        keys.push(keyCode);
      }

      const expiryNote = expiresAt
        ? `\n⏰ Keys expire: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
        : "\n⏰ Keys expire: Never (permanent)";
      const keyList = keys.map((k) => `\`${k}\``).join("\n");
      const content = `**Generated ${count} key(s) for panel \`${name}\`:**\n${keyList}${expiryNote}`;

      if (keys.length > 10) {
        const fileContent = keys.map((k) => {
          const expiry = expiresAt ? `| expires: ${expiresAt.toISOString()}` : "| expires: never";
          return `${k} ${expiry}`;
        }).join("\n");
        const buf = Buffer.from(fileContent, "utf8");
        const file = new AttachmentBuilder(buf, { name: `keys-${name}.txt` });
        return interaction.reply({
          content: `✅ Generated ${count} keys for **${name}**.${expiryNote}`,
          files: [file],
          ephemeral: true,
        });
      }
      await interaction.reply({ content, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("listkeys")
      .setDescription("List all keys for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, ephemeral: true });

      const keys = await db.select().from(panelKeys).where(eq(panelKeys.panelId, panel.id));
      if (!keys.length) return interaction.reply({ content: `No keys found for **${name}**.`, ephemeral: true });

      const now = new Date();
      const lines = keys.map((k) => {
        const expired = k.expiresAt && k.expiresAt <= now;
        const statusIcon = !k.active || expired ? "🔴" : "🟢";
        const usedPart = k.usedBy ? `— used by <@${k.usedBy}>` : "— unused";
        const timeLeft = k.expiresAt ? ` | ⏰ ${expired ? "Expired" : formatTimeLeft(k.expiresAt)}` : " | ⏰ Never";
        return `${statusIcon} \`${k.keyCode}\` ${usedPart}${timeLeft}`;
      });

      const content = lines.join("\n");
      if (content.length > 1900) {
        const fileContent = keys.map((k) => {
          const expired = k.expiresAt && k.expiresAt <= now;
          const status = !k.active || expired ? "EXPIRED/REVOKED" : "ACTIVE";
          const expiry = k.expiresAt ? k.expiresAt.toISOString() : "never";
          const timeLeft = k.expiresAt ? formatTimeLeft(k.expiresAt) : "permanent";
          return `${status} | ${k.keyCode} | used_by: ${k.usedBy ?? "unused"} | expires: ${expiry} | time_left: ${timeLeft}`;
        }).join("\n");
        const buf = Buffer.from(fileContent, "utf8");
        const file = new AttachmentBuilder(buf, { name: `keys-${name}.txt` });
        return interaction.reply({ content: `Found **${keys.length}** keys for **${name}**:`, files: [file], ephemeral: true });
      }
      await interaction.reply({ content: `**Keys for \`${name}\`:**\n${content}`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("revokekey")
      .setDescription("Revoke a specific key")
      .addStringOption((o) => o.setName("key").setDescription("The key to revoke").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const keyCode = interaction.options.getString("key", true).toUpperCase();
      const [key] = await db.select().from(panelKeys).where(eq(panelKeys.keyCode, keyCode));
      if (!key) return interaction.reply({ content: "❌ Key not found.", ephemeral: true });
      await db.update(panelKeys).set({ active: false }).where(eq(panelKeys.keyCode, keyCode));
      await interaction.reply({ content: `✅ Key \`${keyCode}\` has been revoked.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("listwhitelist")
      .setDescription("List all whitelisted users for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, ephemeral: true });

      const list = await db.select().from(panelWhitelist).where(eq(panelWhitelist.panelId, panel.id));
      if (!list.length) return interaction.reply({ content: `No users whitelisted for **${name}**.`, ephemeral: true });

      const now = new Date();
      const embed = new EmbedBuilder().setColor(0x5865f2)
        .setTitle(`📋 Whitelist — ${name}`)
        .setDescription(list.map((e, i) => {
          const expired = e.expiresAt && e.expiresAt <= now;
          const expiry = e.expiresAt
            ? (expired ? " ⏰ **Expired**" : ` ⏰ ${formatTimeLeft(e.expiresAt)} left`)
            : " ⏰ Permanent";
          return `**${i + 1}.** <@${e.userId}>${expiry}`;
        }).join("\n"))
        .setFooter({ text: `${list.length} user(s) whitelisted` });
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("listpanels")
      .setDescription("List all panels in this server"),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const allPanels = await db.select().from(panels).where(eq(panels.guildId, interaction.guildId!));
      if (!allPanels.length) return interaction.reply({ content: "No panels created yet. Use `/createpanel` to get started.", ephemeral: true });
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Panels")
        .setDescription(allPanels.map((p, i) => `**${i + 1}.** \`${p.name}\` ${p.scriptContent ? "✅ Script set" : "⚠️ No script"} ${p.roleId ? `| Role: <@&${p.roleId}>` : ""}`).join("\n"));
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },
];
