import {
  SlashCommandBuilder, ChatInputCommandInteraction, Client,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, AttachmentBuilder,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { panels, panelKeys, panelWhitelist, panelBlacklist, panelRoleWhitelist, panelRoleBlacklist } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateKey } from "../utils/obfuscate.js";

const OWNERS = ["1417552037717086355", "1501051958629503097", "1101996899453632534"];

function isOwner(userId: string) {
  return OWNERS.includes(userId);
}

function ownerOnly(interaction: ChatInputCommandInteraction) {
  if (!isOwner(interaction.user.id)) {
    interaction.reply({ content: "❌ You are not authorized to use this command.", flags: MessageFlags.Ephemeral });
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
      if (!panel) return interaction.reply({ content: `❌ No panel named **${name}** found.`, flags: MessageFlags.Ephemeral });
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
      if (existing) return interaction.reply({ content: `❌ A panel named **${name}** already exists.`, flags: MessageFlags.Ephemeral });
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });
      await db.update(panels).set({ roleId: role.id }).where(eq(panels.id, panel.id));
      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ Role Set")
        .addFields({ name: "Panel", value: name, inline: true }, { name: "Role", value: `${role}`, inline: true });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("whitelist")
      .setDescription("Whitelist a user or role for a panel")
      .addSubcommand((s) => s.setName("user").setDescription("Whitelist a specific user")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addUserOption((o) => o.setName("user").setDescription("User to whitelist").setRequired(true))
        .addStringOption((o) => o.setName("duration").setDescription("How long e.g. 7d, 30d, 1h (blank = permanent)").setRequired(false)))
      .addSubcommand((s) => s.setName("role").setDescription("Whitelist an entire role")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role to whitelist").setRequired(true))
        .addStringOption((o) => o.setName("duration").setDescription("How long e.g. 7d, 30d, 1h (blank = permanent)").setRequired(false))),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const sub = interaction.options.getSubcommand();
      const name = interaction.options.getString("panel", true).toLowerCase();
      const durationStr = interaction.options.getString("duration");
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      let expiresAt: Date | null = null;
      if (durationStr) {
        const ms = parseDuration(durationStr);
        if (!ms) return interaction.reply({ content: "❌ Invalid duration. Use e.g. `7d`, `30d`, `24h`.", flags: MessageFlags.Ephemeral });
        expiresAt = new Date(Date.now() + ms);
      }

      if (sub === "user") {
        const target = interaction.options.getUser("user", true);
        const [existing] = await db.select().from(panelWhitelist)
          .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, target.id)));
        if (existing) return interaction.reply({ content: `❌ ${target.tag} is already whitelisted for **${name}**.`, flags: MessageFlags.Ephemeral });
        const [bl] = await db.select().from(panelBlacklist)
          .where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, target.id), eq(panelBlacklist.active, true)));
        if (bl) return interaction.reply({ content: `❌ ${target.tag} is blacklisted from **${name}**. Unblacklist them first.`, flags: MessageFlags.Ephemeral });
        const assignedKey = generateKey();
        await db.insert(panelWhitelist).values({ panelId: panel.id, userId: target.id, whitelistedBy: interaction.user.id, expiresAt, keyCode: assignedKey });
        const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ User Whitelisted")
          .addFields(
            { name: "User", value: `${target.tag} (${target.id})`, inline: true },
            { name: "Panel", value: name, inline: true },
            { name: "By", value: interaction.user.tag, inline: true },
            { name: "Key", value: `\`${assignedKey}\``, inline: true },
            { name: "Expires", value: expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : "Never (permanent)", inline: true },
          );
        await interaction.reply({ embeds: [embed] });
        try {
          await target.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ You have been whitelisted!")
            .setDescription(`You have been whitelisted for the **${name}** script.\nYou can access the script via the panel in the server.`)
            .addFields({ name: "Expires", value: expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : "Never (permanent)", inline: true })
            .setTimestamp()] });
        } catch {}
        return;
      }

      if (sub === "role") {
        const role = interaction.options.getRole("role", true);
        const [existing] = await db.select().from(panelRoleWhitelist)
          .where(and(eq(panelRoleWhitelist.panelId, panel.id), eq(panelRoleWhitelist.roleId, role.id)));
        if (existing) return interaction.reply({ content: `❌ <@&${role.id}> is already whitelisted for **${name}**.`, flags: MessageFlags.Ephemeral });
        const [bl] = await db.select().from(panelRoleBlacklist)
          .where(and(eq(panelRoleBlacklist.panelId, panel.id), eq(panelRoleBlacklist.roleId, role.id), eq(panelRoleBlacklist.active, true)));
        if (bl) return interaction.reply({ content: `❌ <@&${role.id}> is blacklisted from **${name}**. Remove the role blacklist first.`, flags: MessageFlags.Ephemeral });
        await interaction.deferReply();
        await db.insert(panelRoleWhitelist).values({ panelId: panel.id, roleId: role.id, whitelistedBy: interaction.user.id, expiresAt });
        // Immediately assign a unique key to every current member of this role
        let assigned = 0;
        let skipped = 0;
        try {
          await interaction.guild!.members.fetch();
          const guildRole = interaction.guild!.roles.cache.get(role.id);
          if (guildRole) {
            for (const [memberId] of guildRole.members) {
              const [alreadyWl] = await db.select().from(panelWhitelist)
                .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, memberId)));
              if (alreadyWl) { skipped++; continue; }
              const [isBlacklisted] = await db.select().from(panelBlacklist)
                .where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, memberId), eq(panelBlacklist.active, true)));
              if (isBlacklisted) { skipped++; continue; }
              await db.insert(panelWhitelist).values({
                panelId: panel.id,
                userId: memberId,
                whitelistedBy: "role:" + role.id,
                keyCode: generateKey(),
                expiresAt,
              });
              assigned++;
            }
          }
        } catch {}
        const embed = new EmbedBuilder().setColor(0x57f287).setTitle("✅ Role Whitelisted")
          .addFields(
            { name: "Role", value: `<@&${role.id}> (${role.name})`, inline: true },
            { name: "Panel", value: name, inline: true },
            { name: "By", value: interaction.user.tag, inline: true },
            { name: "Expires", value: expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : "Never (permanent)", inline: true },
            { name: "Keys Assigned", value: `${assigned} member(s) got individual keys (${skipped} skipped)`, inline: false },
          )
          .setFooter({ text: "Each member now has their own key — use /listaccess or /keyinfo to view." });
        await interaction.editReply({ embeds: [embed] });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unwhitelist")
      .setDescription("Remove a user, role, or everyone from the whitelist for a panel")
      .addSubcommand((s) => s.setName("user").setDescription("Remove a specific user")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addUserOption((o) => o.setName("user").setDescription("User to remove").setRequired(true)))
      .addSubcommand((s) => s.setName("role").setDescription("Remove a role")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role to remove").setRequired(true)))
      .addSubcommand((s) => s.setName("everyone").setDescription("Remove ALL whitelisted users and roles from a panel")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addStringOption((o) => o.setName("confirm").setDescription('Type "confirm" to proceed').setRequired(true))),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const sub = interaction.options.getSubcommand();
      const name = interaction.options.getString("panel", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      if (sub === "user") {
        const target = interaction.options.getUser("user", true);
        const deleted = await db.delete(panelWhitelist)
          .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, target.id))).returning();
        if (!deleted.length) return interaction.reply({ content: `❌ ${target.tag} is not whitelisted for **${name}**.`, flags: MessageFlags.Ephemeral });
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚫 User Unwhitelisted")
          .addFields({ name: "User", value: target.tag, inline: true }, { name: "Panel", value: name, inline: true })] });
        return;
      }

      if (sub === "role") {
        const role = interaction.options.getRole("role", true);
        const deleted = await db.delete(panelRoleWhitelist)
          .where(and(eq(panelRoleWhitelist.panelId, panel.id), eq(panelRoleWhitelist.roleId, role.id))).returning();
        if (!deleted.length) return interaction.reply({ content: `❌ <@&${role.id}> is not whitelisted for **${name}**.`, flags: MessageFlags.Ephemeral });
        await interaction.deferReply();
        // Delete materialised entries created via this role
        await db.delete(panelWhitelist)
          .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.whitelistedBy, "role:" + role.id)));
        // Also sweep any other whitelist entries (key-redeemers, manual whitelists) who currently hold this role
        let sweptCount = 0;
        try {
          const allWl = await db.select().from(panelWhitelist).where(eq(panelWhitelist.panelId, panel.id));
          for (const entry of allWl) {
            const member = await interaction.guild!.members.fetch(entry.userId).catch(() => null);
            if (member?.roles.cache.has(role.id)) {
              await db.delete(panelWhitelist)
                .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, entry.userId)));
              sweptCount++;
            }
          }
        } catch {}
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🚫 Role Unwhitelisted")
          .addFields(
            { name: "Role", value: `<@&${role.id}> (${role.name})`, inline: true },
            { name: "Panel", value: name, inline: true },
            { name: "Users Revoked", value: `${sweptCount} additional member(s) removed`, inline: false },
          )] });
      }

      if (sub === "everyone") {
        const confirm = interaction.options.getString("confirm", true).toLowerCase();
        if (confirm !== "confirm") {
          return interaction.reply({ content: '❌ You must type `confirm` in the confirm field to wipe the entire whitelist.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply();

        // Count before deleting so we can report numbers
        const usersBefore = await db.select().from(panelWhitelist).where(eq(panelWhitelist.panelId, panel.id));
        const rolesBefore = await db.select().from(panelRoleWhitelist).where(eq(panelRoleWhitelist.panelId, panel.id));

        await db.delete(panelWhitelist).where(eq(panelWhitelist.panelId, panel.id));
        await db.delete(panelRoleWhitelist).where(eq(panelRoleWhitelist.panelId, panel.id));

        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("🗑️ Whitelist Wiped")
            .setDescription(`All whitelisted users and roles have been removed from **${name}**.\n\n⚠️ **Discord roles were NOT removed** — users keep their roles in the server.`)
            .addFields(
              { name: "Users Removed", value: `${usersBefore.length}`, inline: true },
              { name: "Roles Removed", value: `${rolesBefore.length}`, inline: true },
              { name: "Panel", value: name, inline: true },
              { name: "Wiped By", value: interaction.user.tag, inline: true },
            )
            .setTimestamp()],
        });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("blacklist")
      .setDescription("Blacklist a user or role from a panel")
      .addSubcommand((s) => s.setName("user").setDescription("Blacklist a specific user")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addUserOption((o) => o.setName("user").setDescription("User to blacklist").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false)))
      .addSubcommand((s) => s.setName("role").setDescription("Blacklist an entire role")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role to blacklist").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(false))),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const sub = interaction.options.getSubcommand();
      const name = interaction.options.getString("panel", true).toLowerCase();
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      if (sub === "user") {
        const target = interaction.options.getUser("user", true);
        await db.delete(panelWhitelist).where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, target.id)));
        await db.update(panelBlacklist).set({ active: false }).where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, target.id)));
        await db.insert(panelBlacklist).values({ panelId: panel.id, userId: target.id, reason, blacklistedBy: interaction.user.id });
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔨 User Blacklisted")
          .addFields(
            { name: "User", value: `${target.tag} (${target.id})`, inline: true },
            { name: "Panel", value: name, inline: true },
            { name: "Reason", value: reason },
          )] });
        try {
          await target.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔨 You have been blacklisted")
            .addFields({ name: "Panel", value: name, inline: true }, { name: "Reason", value: reason }).setTimestamp()] });
        } catch {}
        return;
      }

      if (sub === "role") {
        const role = interaction.options.getRole("role", true);
        await interaction.deferReply();
        // Remove role whitelist + materialised entries tagged with this role
        await db.delete(panelRoleWhitelist).where(and(eq(panelRoleWhitelist.panelId, panel.id), eq(panelRoleWhitelist.roleId, role.id)));
        await db.delete(panelWhitelist).where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.whitelistedBy, "role:" + role.id)));
        // Sweep all remaining whitelist entries: revoke any user who currently holds this role
        let sweptCount = 0;
        try {
          const allWl = await db.select().from(panelWhitelist).where(eq(panelWhitelist.panelId, panel.id));
          for (const entry of allWl) {
            const member = await interaction.guild!.members.fetch(entry.userId).catch(() => null);
            if (member?.roles.cache.has(role.id)) {
              await db.delete(panelWhitelist)
                .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, entry.userId)));
              sweptCount++;
            }
          }
        } catch {}
        await db.update(panelRoleBlacklist).set({ active: false }).where(and(eq(panelRoleBlacklist.panelId, panel.id), eq(panelRoleBlacklist.roleId, role.id)));
        await db.insert(panelRoleBlacklist).values({ panelId: panel.id, roleId: role.id, reason, blacklistedBy: interaction.user.id });
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔨 Role Blacklisted")
          .addFields(
            { name: "Role", value: `<@&${role.id}> (${role.name})`, inline: true },
            { name: "Panel", value: name, inline: true },
            { name: "Reason", value: reason },
            { name: "Users Revoked", value: `${sweptCount} member(s) had access removed`, inline: false },
          )
          .setFooter({ text: "All members with this role are now denied access." })] });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unblacklist")
      .setDescription("Remove a user or role from the blacklist for a panel")
      .addSubcommand((s) => s.setName("user").setDescription("Remove a specific user")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addUserOption((o) => o.setName("user").setDescription("User to unblacklist").setRequired(true)))
      .addSubcommand((s) => s.setName("role").setDescription("Remove a role")
        .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
        .addRoleOption((o) => o.setName("role").setDescription("Role to unblacklist").setRequired(true))),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const sub = interaction.options.getSubcommand();
      const name = interaction.options.getString("panel", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      if (sub === "user") {
        const target = interaction.options.getUser("user", true);
        await db.update(panelBlacklist).set({ active: false }).where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.userId, target.id)));
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ User Unblacklisted")
          .addFields({ name: "User", value: target.tag, inline: true }, { name: "Panel", value: name, inline: true })] });
        return;
      }

      if (sub === "role") {
        const role = interaction.options.getRole("role", true);
        await db.update(panelRoleBlacklist).set({ active: false }).where(and(eq(panelRoleBlacklist.panelId, panel.id), eq(panelRoleBlacklist.roleId, role.id)));
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Role Unblacklisted")
          .addFields({ name: "Role", value: `<@&${role.id}> (${role.name})`, inline: true }, { name: "Panel", value: name, inline: true })] });
      }
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
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      let expiresAt: Date | null = null;
      if (durationStr) {
        const ms = parseDuration(durationStr);
        if (!ms) return interaction.reply({ content: "❌ Invalid duration format. Use e.g. `7d`, `30d`, `24h`.", flags: MessageFlags.Ephemeral });
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
        return interaction.editReply({
          content: `✅ Generated ${count} keys for **${name}**.${expiryNote}`,
          files: [file],
        });
      }
      await interaction.editReply({ content });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("listkeys")
      .setDescription("List active redeemed keys for a panel (with time left)")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      const allKeys = await db.select().from(panelKeys).where(eq(panelKeys.panelId, panel.id));
      if (!allKeys.length) return interaction.reply({ content: `No keys found for **${name}**.`, flags: MessageFlags.Ephemeral });

      const now = new Date();
      // Only show keys that are: active (not revoked), redeemed (usedBy set), and not expired
      const activeKeys = allKeys.filter((k) => k.active && k.usedBy && !(k.expiresAt && k.expiresAt <= now));

      if (!activeKeys.length) {
        return interaction.reply({ content: `No active redeemed keys for **${name}**.`, flags: MessageFlags.Ephemeral });
      }

      const lines = activeKeys.map((k) => {
        const timeLeft = k.expiresAt ? `⏰ ${formatTimeLeft(k.expiresAt)} left` : "⏰ Permanent";
        return `🟢 \`${k.keyCode}\` — <@${k.usedBy}> | ${timeLeft}`;
      });

      const content = lines.join("\n");
      if (content.length > 1900) {
        const fileContent = activeKeys.map((k) => {
          const expiry = k.expiresAt ? k.expiresAt.toISOString() : "permanent";
          const timeLeft = k.expiresAt ? formatTimeLeft(k.expiresAt) : "permanent";
          return `${k.keyCode} | user: ${k.usedBy} | expires: ${expiry} | time_left: ${timeLeft}`;
        }).join("\n");
        const buf = Buffer.from(fileContent, "utf8");
        const file = new AttachmentBuilder(buf, { name: `keys-${name}.txt` });
        return interaction.reply({ content: `**${activeKeys.length}** active keys for **${name}**:`, files: [file], flags: MessageFlags.Ephemeral });
      }
      await interaction.reply({ content: `**Active keys for \`${name}\` (${activeKeys.length}):**\n${content}`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setkeytime")
      .setDescription("Update the expiry time on an existing key")
      .addStringOption((o) => o.setName("key").setDescription("The key code to update").setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("New duration from now e.g. 7d, 30d, 24h, or 'permanent' to remove expiry").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const keyCode = interaction.options.getString("key", true).toUpperCase();
      const durationStr = interaction.options.getString("duration", true).toLowerCase().trim();

      const [key] = await db.select().from(panelKeys).where(eq(panelKeys.keyCode, keyCode));
      if (!key) return interaction.reply({ content: "❌ Key not found.", flags: MessageFlags.Ephemeral });
      if (!key.active) return interaction.reply({ content: "❌ That key has been revoked.", flags: MessageFlags.Ephemeral });

      let newExpiresAt: Date | null = null;
      if (durationStr !== "permanent" && durationStr !== "never") {
        const ms = parseDuration(durationStr);
        if (!ms) return interaction.reply({ content: "❌ Invalid duration. Use e.g. `7d`, `30d`, `24h`, or `permanent`.", flags: MessageFlags.Ephemeral });
        newExpiresAt = new Date(Date.now() + ms);
      }

      await db.update(panelKeys).set({ expiresAt: newExpiresAt }).where(eq(panelKeys.keyCode, keyCode));

      // Also sync expiry on whitelist entry if this key was redeemed
      if (key.usedBy) {
        const [panel] = await db.select().from(panelKeys).where(eq(panelKeys.keyCode, keyCode));
        await db.update(panelWhitelist).set({ expiresAt: newExpiresAt })
          .where(and(eq(panelWhitelist.panelId, key.panelId), eq(panelWhitelist.keyCode, keyCode)));
      }

      const expiryDisplay = newExpiresAt
        ? `<t:${Math.floor(newExpiresAt.getTime() / 1000)}:F> (<t:${Math.floor(newExpiresAt.getTime() / 1000)}:R>)`
        : "Permanent (never expires)";

      const embed = new EmbedBuilder().setColor(0x57f287).setTitle("⏰ Key Expiry Updated")
        .addFields(
          { name: "Key", value: `\`${keyCode}\``, inline: true },
          { name: "Redeemed By", value: key.usedBy ? `<@${key.usedBy}>` : "Unredeemed", inline: true },
          { name: "New Expiry", value: expiryDisplay },
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
      if (!key) return interaction.reply({ content: "❌ Key not found.", flags: MessageFlags.Ephemeral });
      await db.update(panelKeys).set({ active: false }).where(eq(panelKeys.keyCode, keyCode));
      await interaction.reply({ content: `✅ Key \`${keyCode}\` has been revoked.`, flags: MessageFlags.Ephemeral });
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
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      const list = await db.select().from(panelWhitelist).where(eq(panelWhitelist.panelId, panel.id));
      if (!list.length) return interaction.reply({ content: `No users whitelisted for **${name}**.`, flags: MessageFlags.Ephemeral });

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
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("keyinfo")
      .setDescription("Look up a specific key, or see time left on all keys for a panel")
      .addStringOption((o) => o.setName("key").setDescription("Key code to look up").setRequired(false))
      .addStringOption((o) => o.setName("panel").setDescription("Panel name — shows all keys with time left").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const keyCode = interaction.options.getString("key")?.toUpperCase().trim();
      const panelName = interaction.options.getString("panel")?.toLowerCase().trim();

      if (!keyCode && !panelName) {
        return interaction.reply({ content: "❌ Provide either a `key` or a `panel` name.", flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const now = new Date();

      // ── Single key lookup ──────────────────────────────────────────────
      if (keyCode) {
        const [key] = await db.select().from(panelKeys).where(eq(panelKeys.keyCode, keyCode));
        if (!key) return interaction.editReply({ content: "❌ Key not found." });

        const expired = key.expiresAt && key.expiresAt <= now;
        const status = !key.active ? "🔴 Revoked" : expired ? "⏰ Expired" : "🟢 Active";
        const timeLeft = key.expiresAt
          ? (expired ? "**Expired**" : `**${formatTimeLeft(key.expiresAt)}** left (expires <t:${Math.floor(key.expiresAt.getTime() / 1000)}:R>)`)
          : "**Permanent** (no expiry)";

        let hwid = "Not locked";
        if (key.usedBy) {
          const [wl] = await db.select().from(panelWhitelist)
            .where(and(eq(panelWhitelist.panelId, key.panelId), eq(panelWhitelist.keyCode, keyCode)));
          if (wl?.hwid) hwid = `Locked (\`${wl.hwid.slice(0, 12)}…\`)`;
        }

        const embed = new EmbedBuilder().setColor(!key.active || expired ? 0xed4245 : 0x57f287)
          .setTitle(`🔑 Key Info`)
          .addFields(
            { name: "Key", value: `\`${key.keyCode}\``, inline: false },
            { name: "Status", value: status, inline: true },
            { name: "Redeemed By", value: key.usedBy ? `<@${key.usedBy}>` : "Unredeemed", inline: true },
            { name: "HWID", value: hwid, inline: true },
            { name: "Time Left", value: timeLeft, inline: false },
            { name: "Created", value: `<t:${Math.floor(key.createdAt!.getTime() / 1000)}:R>`, inline: true },
            { name: "Redeemed At", value: key.usedAt ? `<t:${Math.floor(key.usedAt.getTime() / 1000)}:R>` : "—", inline: true },
          );
        return interaction.editReply({ embeds: [embed] });
      }

      // ── All keys for a panel ───────────────────────────────────────────
      const panel = await getPanel(interaction.guildId!, panelName!);
      if (!panel) return interaction.editReply({ content: `❌ Panel **${panelName}** not found.` });

      const keys = await db.select().from(panelKeys).where(eq(panelKeys.panelId, panel.id));
      if (!keys.length) return interaction.editReply({ content: `No keys found for **${panelName}**.` });

      const lines = keys.map((k) => {
        const expired = k.expiresAt && k.expiresAt <= now;
        const icon = !k.active ? "🔴" : expired ? "⏰" : "🟢";
        const user = k.usedBy ? `<@${k.usedBy}>` : "unused";
        const timeLeft = k.expiresAt
          ? (expired ? "Expired" : formatTimeLeft(k.expiresAt) + " left")
          : "Permanent";
        return `${icon} \`${k.keyCode}\` — ${user} | ${timeLeft}`;
      });

      const content = lines.join("\n");
      if (content.length > 1900) {
        const fileContent = keys.map((k) => {
          const expired = k.expiresAt && k.expiresAt <= now;
          const status = !k.active ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE";
          const timeLeft = k.expiresAt ? (expired ? "expired" : formatTimeLeft(k.expiresAt) + " left") : "permanent";
          return `${status} | ${k.keyCode} | user: ${k.usedBy ?? "unused"} | time_left: ${timeLeft}`;
        }).join("\n");
        const buf = Buffer.from(fileContent, "utf8");
        const file = new AttachmentBuilder(buf, { name: `keyinfo-${panelName}.txt` });
        return interaction.editReply({ content: `**${keys.length}** keys for **${panelName}**:`, files: [file] });
      }
      return interaction.editReply({ content: `**All keys for \`${panelName}\` (${keys.length}):**\n${content}` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("addrole")
      .setDescription("Add a role to a user")
      .addUserOption((o) => o.setName("user").setDescription("User to give the role to").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Role to assign").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason (optional)").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getUser("user", true);
      const role = interaction.options.getRole("role", true);
      const reason = interaction.options.getString("reason") ?? "No reason provided";

      const guild = interaction.guild!;
      const member = await guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ That user is not in this server.", flags: MessageFlags.Ephemeral });

      const botMember = guild.members.me!;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: "❌ I don't have the **Manage Roles** permission.", flags: MessageFlags.Ephemeral });
      }
      if (role.position >= botMember.roles.highest.position) {
        return interaction.reply({ content: `❌ I can't assign **${role.name}** — it's higher than or equal to my highest role.`, flags: MessageFlags.Ephemeral });
      }
      if (member.roles.cache.has(role.id)) {
        return interaction.reply({ content: `⚠️ ${target} already has the **${role.name}** role.`, flags: MessageFlags.Ephemeral });
      }

      await member.roles.add(role.id, reason);

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ Role Added")
        .addFields(
          { name: "User", value: `${target} (\`${target.id}\`)`, inline: true },
          { name: "Role", value: `${role}`, inline: true },
          { name: "Assigned By", value: `${interaction.user}`, inline: true },
          { name: "Reason", value: reason, inline: false },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("removerole")
      .setDescription("Remove a role from a user")
      .addUserOption((o) => o.setName("user").setDescription("User to remove the role from").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Role to remove").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Reason (optional)").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const target = interaction.options.getUser("user", true);
      const role = interaction.options.getRole("role", true);
      const reason = interaction.options.getString("reason") ?? "No reason provided";

      const guild = interaction.guild!;
      const member = await guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ That user is not in this server.", flags: MessageFlags.Ephemeral });

      const botMember = guild.members.me!;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ content: "❌ I don't have the **Manage Roles** permission.", flags: MessageFlags.Ephemeral });
      }
      if (role.position >= botMember.roles.highest.position) {
        return interaction.reply({ content: `❌ I can't remove **${role.name}** — it's higher than or equal to my highest role.`, flags: MessageFlags.Ephemeral });
      }
      if (!member.roles.cache.has(role.id)) {
        return interaction.reply({ content: `⚠️ ${target} doesn't have the **${role.name}** role.`, flags: MessageFlags.Ephemeral });
      }

      await member.roles.remove(role.id, reason);

      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("🗑️ Role Removed")
        .addFields(
          { name: "User", value: `${target} (\`${target.id}\`)`, inline: true },
          { name: "Role", value: `${role}`, inline: true },
          { name: "Removed By", value: `${interaction.user}`, inline: true },
          { name: "Reason", value: reason, inline: false },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("forcehwidreset")
      .setDescription("Force-reset the HWID lock for a user on a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addUserOption((o) => o.setName("user").setDescription("User whose HWID to reset").setRequired(false))
      .addStringOption((o) => o.setName("userid").setDescription("User ID (if they left the server)").setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const panelName = interaction.options.getString("panel", true).toLowerCase().trim();
      const targetUser = interaction.options.getUser("user");
      const rawId = interaction.options.getString("userid");

      const userId = targetUser?.id ?? rawId?.trim();
      if (!userId) return interaction.reply({ content: "❌ Provide either a `user` or a `userid`.", flags: MessageFlags.Ephemeral });

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const panel = await getPanel(interaction.guildId!, panelName);
      if (!panel) return interaction.editReply({ content: `❌ Panel **${panelName}** not found.` });

      const [wl] = await db.select().from(panelWhitelist)
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, userId)));

      if (!wl) {
        return interaction.editReply({ content: `❌ No whitelist entry found for that user on panel **${panelName}**.` });
      }

      if (!wl.hwid) {
        return interaction.editReply({ content: `⚠️ That user has no HWID locked on **${panelName}** — nothing to reset.` });
      }

      const oldHwid = wl.hwid;
      await db.update(panelWhitelist)
        .set({ hwid: null })
        .where(eq(panelWhitelist.id, wl.id));

      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("⚙️ HWID Force Reset")
        .addFields(
          { name: "Panel", value: `\`${panelName}\``, inline: true },
          { name: "User", value: targetUser ? `${targetUser} (\`${userId}\`)` : `\`${userId}\``, inline: true },
          { name: "Reset By", value: `${interaction.user}`, inline: true },
          { name: "Old HWID", value: `\`${oldHwid.slice(0, 20)}…\``, inline: false },
        )
        .setDescription("The user's HWID lock has been cleared. They can now lock in from any device on their next script execution.")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("listpanels")
      .setDescription("List all panels in this server"),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const allPanels = await db.select().from(panels).where(eq(panels.guildId, interaction.guildId!));
      if (!allPanels.length) return interaction.reply({ content: "No panels created yet. Use `/createpanel` to get started.", flags: MessageFlags.Ephemeral });
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Panels")
        .setDescription(allPanels.map((p, i) => `**${i + 1}.** \`${p.name}\` ${p.scriptContent ? "✅ Script set" : "⚠️ No script"} ${p.roleId ? `| Role: <@&${p.roleId}>` : ""}`).join("\n"));
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("deletepanel")
      .setDescription("Permanently delete a panel and all its keys, whitelist, and blacklist data")
      .addStringOption((o) => o.setName("name").setDescription("Panel name").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("name", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ No panel named **${name}** found.`, flags: MessageFlags.Ephemeral });
      await db.delete(panels).where(eq(panels.id, panel.id));
      const embed = new EmbedBuilder().setColor(0xed4245).setTitle("🗑️ Panel Deleted")
        .setDescription(`Panel **${name}** and all its associated keys, whitelist, and blacklist data have been permanently deleted.`)
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("listaccess")
      .setDescription("Show all whitelisted/blacklisted users and roles for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      const [wlUsers, wlRoles, blUsers, blRoles, unusedKeys] = await Promise.all([
        db.select().from(panelWhitelist).where(eq(panelWhitelist.panelId, panel.id)),
        db.select().from(panelRoleWhitelist).where(eq(panelRoleWhitelist.panelId, panel.id)),
        db.select().from(panelBlacklist).where(and(eq(panelBlacklist.panelId, panel.id), eq(panelBlacklist.active, true))),
        db.select().from(panelRoleBlacklist).where(and(eq(panelRoleBlacklist.panelId, panel.id), eq(panelRoleBlacklist.active, true))),
        db.select().from(panelKeys).where(and(eq(panelKeys.panelId, panel.id), eq(panelKeys.active, true))),
      ]);

      const now = new Date();
      const fmtExpiry = (expiresAt: Date | null | undefined) =>
        expiresAt ? (expiresAt <= now ? "⏰ Expired" : `${formatTimeLeft(expiresAt)} left`) : "Permanent";

      // Build detailed whitelist lines: user mention | key | expiry
      const wlUserLines = wlUsers.map((e) => {
        const keyPart = e.keyCode ? `\`${e.keyCode}\`` : "_no key yet_";
        const expiry = fmtExpiry(e.expiresAt);
        return `<@${e.userId}> | ${keyPart} | ${expiry}`;
      });

      const wlRoleLines = wlRoles.map((e) =>
        `<@&${e.roleId}> | ${fmtExpiry(e.expiresAt)}`
      );

      const blUserLines = blUsers.map((e) => `<@${e.userId}> — ${e.reason}`);
      const blRoleLines = blRoles.map((e) => `<@&${e.roleId}> — ${e.reason}`);

      // Unredeemed keys — filter out keys already used (usedBy set) and show remaining ones
      const redeemedCodes = new Set(wlUsers.map((u) => u.keyCode).filter(Boolean));
      const unredeemedKeys = unusedKeys.filter((k) => !k.usedBy && !redeemedCodes.has(k.keyCode));
      const unusedKeyLines = unredeemedKeys.map((k) =>
        `\`${k.keyCode}\` | ${fmtExpiry(k.expiresAt)}`
      );

      const totalWl = wlUsers.length + wlRoles.length;
      const totalBl = blUsers.length + blRoles.length;

      // If too large for an embed, send as a file
      const fullText = [
        `=== WHITELISTED USERS (${wlUsers.length}) ===`,
        ...(wlUserLines.length ? wlUserLines : ["None"]),
        "",
        `=== WHITELISTED ROLES (${wlRoles.length}) ===`,
        ...(wlRoleLines.length ? wlRoleLines : ["None"]),
        "",
        `=== UNREDEEMED KEYS (${unredeemedKeys.length}) ===`,
        ...(unusedKeyLines.length ? unusedKeyLines : ["None"]),
        "",
        `=== BLACKLISTED USERS (${blUsers.length}) ===`,
        ...(blUserLines.length ? blUserLines : ["None"]),
        "",
        `=== BLACKLISTED ROLES (${blRoles.length}) ===`,
        ...(blRoleLines.length ? blRoleLines : ["None"]),
      ].join("\n");

      if (wlUsers.length > 30 || fullText.length > 3500) {
        const file = new AttachmentBuilder(Buffer.from(fullText, "utf8"), { name: `access-${name}.txt` });
        return interaction.reply({ content: `**${totalWl}** whitelisted · **${unredeemedKeys.length}** unredeemed keys · **${totalBl}** blacklisted`, files: [file], flags: MessageFlags.Ephemeral });
      }

      const cap = (lines: string[], fallback: string) => {
        const joined = lines.join("\n") || fallback;
        return joined.length > 1024 ? joined.slice(0, 1021) + "…" : joined;
      };

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🔐 Access List — ${name}`)
        .addFields(
          { name: `✅ Whitelisted Users (${wlUsers.length})`, value: cap(wlUserLines, "_None_"), inline: false },
          { name: `✅ Whitelisted Roles (${wlRoles.length})`, value: cap(wlRoleLines, "_None_"), inline: false },
          { name: `🔑 Unredeemed Keys (${unredeemedKeys.length})`, value: cap(unusedKeyLines, "_None_"), inline: false },
          { name: `🔨 Blacklisted Users (${blUsers.length})`, value: cap(blUserLines, "_None_"), inline: false },
          { name: `🔨 Blacklisted Roles (${blRoles.length})`, value: cap(blRoleLines, "_None_"), inline: false },
        )
        .setFooter({ text: `Total: ${totalWl} whitelisted · ${unredeemedKeys.length} unredeemed keys · ${totalBl} blacklisted` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setexpiry")
      .setDescription("Change or clear the expiry on a user's whitelist entry")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addUserOption((o) => o.setName("user").setDescription("User to update").setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("New duration e.g. 7d, 30d, 1h — or 'permanent' to remove expiry").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const target = interaction.options.getUser("user", true);
      const durationStr = interaction.options.getString("duration", true).trim().toLowerCase();
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      const [wl] = await db.select().from(panelWhitelist)
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, target.id)));
      if (!wl) return interaction.reply({ content: `❌ ${target.tag} is not whitelisted for **${name}**.`, flags: MessageFlags.Ephemeral });

      let newExpiry: Date | null = null;
      if (durationStr !== "permanent") {
        const ms = parseDuration(durationStr);
        if (!ms) return interaction.reply({ content: "❌ Invalid duration. Use e.g. `7d`, `30d`, `24h`, or `permanent`.", flags: MessageFlags.Ephemeral });
        newExpiry = new Date(Date.now() + ms);
      }

      await db.update(panelWhitelist).set({ expiresAt: newExpiry })
        .where(and(eq(panelWhitelist.panelId, panel.id), eq(panelWhitelist.userId, target.id)));

      const embed = new EmbedBuilder().setColor(0xfee75c).setTitle("⏰ Expiry Updated")
        .addFields(
          { name: "User", value: `${target.tag} (${target.id})`, inline: true },
          { name: "Panel", value: name, inline: true },
          { name: "New Expiry", value: newExpiry ? `<t:${Math.floor(newExpiry.getTime() / 1000)}:R>` : "Permanent (no expiry)", inline: false },
          { name: "Key", value: wl.keyCode ? `\`${wl.keyCode}\`` : "_no key assigned_", inline: true },
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("assignrole")
      .setDescription("Give a role to every whitelisted user for a panel")
      .addStringOption((o) => o.setName("panel").setDescription("Panel name").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("Role to assign").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      if (!ownerOnly(interaction)) return;
      const name = interaction.options.getString("panel", true).toLowerCase();
      const role = interaction.options.getRole("role", true);
      const panel = await getPanel(interaction.guildId!, name);
      if (!panel) return interaction.reply({ content: `❌ Panel **${name}** not found.`, flags: MessageFlags.Ephemeral });

      await interaction.deferReply();

      const whitelisted = await db.select().from(panelWhitelist).where(eq(panelWhitelist.panelId, panel.id));
      if (!whitelisted.length) {
        return interaction.editReply({ content: `⚠️ No whitelisted users found for **${name}**.` });
      }

      let assigned = 0;
      let alreadyHad = 0;
      let failed = 0;

      for (const entry of whitelisted) {
        try {
          const member = await interaction.guild!.members.fetch(entry.userId).catch(() => null);
          if (!member) { failed++; continue; }
          if (member.roles.cache.has(role.id)) { alreadyHad++; continue; }
          await member.roles.add(role.id, `assignrole: panel ${name}`);
          assigned++;
        } catch {
          failed++;
        }
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("✅ Role Assigned")
          .setDescription(`Finished assigning <@&${role.id}> to all whitelisted users in **${name}**.`)
          .addFields(
            { name: "✅ Assigned", value: `${assigned}`, inline: true },
            { name: "⏭️ Already Had Role", value: `${alreadyHad}`, inline: true },
            { name: "❌ Failed / Left Server", value: `${failed}`, inline: true },
            { name: "Panel", value: name, inline: true },
          )
          .setTimestamp()],
      });
    },
  },
];
