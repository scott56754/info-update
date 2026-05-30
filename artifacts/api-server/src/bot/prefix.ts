import {
  Message, Client, EmbedBuilder, PermissionFlagsBits,
  ChannelType, TextChannel,
  MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import { db } from "@workspace/db";
import {
  warnings, mutes, economy, guildSettings,
  panels, panelKeys, panelWhitelist, panelBlacklist,
  ticketSettings, tickets,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { generateKey } from "./utils/obfuscate.js";

const OWNERS = ["1417552037717086355", "1501051958629503097", "1101996899453632534"];
const PREFIXES = [".", "!", "?"];

// ── helpers ────────────────────────────────────────────────────────────────

function isOwner(id: string) { return OWNERS.includes(id); }

function embed(color: number, title?: string) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) e.setTitle(title);
  return e;
}

async function reply(msg: Message, content: string | EmbedBuilder) {
  if (typeof content === "string") return msg.reply({ content, allowedMentions: { repliedUser: false } });
  return msg.reply({ embeds: [content], allowedMentions: { repliedUser: false } });
}

function parseArgs(rest: string): string[] {
  return rest.trim().split(/\s+/).filter(Boolean);
}

function mention2id(str: string): string {
  return str.replace(/[<@!>]/g, "");
}

function role2id(str: string): string {
  return str.replace(/[<@&>]/g, "");
}

async function getPanel(guildId: string, name: string) {
  const [p] = await db.select().from(panels)
    .where(and(eq(panels.guildId, guildId), eq(panels.name, name.toLowerCase())));
  return p ?? null;
}

// ── command map ────────────────────────────────────────────────────────────

type PrefixHandler = (msg: Message, args: string[], client: Client) => Promise<unknown>;

const commands: Record<string, PrefixHandler> = {

  // ── Help ──────────────────────────────────────────────────────────────
  help: async (msg) => {
    const e = embed(0x5865f2, "📖 Light Hub — Prefix Commands")
      .setDescription("Use `.`, `!`, or `?` before any command.\nAll slash commands also work.")
      .addFields(
        { name: "🛡️ Moderation", value: "`ban` `kick` `warn` `warnings` `mute` `unmute` `purge` `lock` `unlock`" },
        { name: "📋 Panel", value: "`panel` `whitelist` `blacklist` `unwhitelist` `unblacklist` `generatekeys` `listkeys` `createpanel` `setrole`" },
        { name: "💰 Economy", value: "`balance` `daily` `pay` `leaderboard`" },
        { name: "🎮 Fun", value: "`8ball` `joke` `roll` `coinflip` `choose`" },
        { name: "🛠️ Utility", value: "`ping` `userinfo` `serverinfo` `avatar`" },
        { name: "🎫 Tickets", value: "`closeticket` `ticket`" },
      );
    await reply(msg, e);
  },

  ping: async (msg, _a, client) => {
    const sent = await msg.reply("🏓 Pinging...");
    await sent.edit(`🏓 Pong! Latency: **${sent.createdTimestamp - msg.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  },

  // ── Moderation ─────────────────────────────────────────────────────────
  ban: async (msg, args) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.BanMembers)) return;
    if (!args[0]) return reply(msg, "Usage: `ban @user [reason]`");
    const target = await msg.guild!.members.fetch(mention2id(args[0])).catch(() => null);
    if (!target) return reply(msg, "❌ User not found.");
    const reason = args.slice(1).join(" ") || "No reason provided";
    await target.ban({ reason });
    const e = embed(0xed4245, "🔨 Banned").addFields(
      { name: "User", value: target.user.tag, inline: true },
      { name: "Reason", value: reason },
    );
    await reply(msg, e);
  },

  kick: async (msg, args) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.KickMembers)) return;
    if (!args[0]) return reply(msg, "Usage: `kick @user [reason]`");
    const target = await msg.guild!.members.fetch(mention2id(args[0])).catch(() => null);
    if (!target) return reply(msg, "❌ User not found.");
    const reason = args.slice(1).join(" ") || "No reason provided";
    await target.kick(reason);
    await reply(msg, embed(0xfee75c, "👢 Kicked").addFields(
      { name: "User", value: target.user.tag, inline: true },
      { name: "Reason", value: reason },
    ));
  },

  warn: async (msg, args) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
    if (!args[0]) return reply(msg, "Usage: `warn @user [reason]`");
    const target = await msg.guild!.members.fetch(mention2id(args[0])).catch(() => null);
    if (!target) return reply(msg, "❌ User not found.");
    const reason = args.slice(1).join(" ") || "No reason provided";
    await db.insert(warnings).values({ guildId: msg.guildId!, userId: target.id, reason, moderatorId: msg.author.id });
    await reply(msg, embed(0xfee75c, "⚠️ Warning Issued").addFields(
      { name: "User", value: target.user.tag, inline: true },
      { name: "Reason", value: reason },
    ));
    try { await target.send(`⚠️ You were warned in **${msg.guild!.name}**: ${reason}`); } catch {}
  },

  warnings: async (msg, args) => {
    const targetId = args[0] ? mention2id(args[0]) : msg.author.id;
    const list = await db.select().from(warnings)
      .where(and(eq(warnings.guildId, msg.guildId!), eq(warnings.userId, targetId)))
      .orderBy(desc(warnings.createdAt));
    if (!list.length) return reply(msg, "✅ No warnings found.");
    const e = embed(0xfee75c, `⚠️ Warnings (${list.length})`)
      .setDescription(list.map((w, i) => `**${i + 1}.** ${w.reason}`).join("\n"));
    await reply(msg, e);
  },

  purge: async (msg, args) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const n = parseInt(args[0]);
    if (isNaN(n) || n < 1 || n > 100) return reply(msg, "Usage: `purge <1-100>`");
    const deleted = await (msg.channel as TextChannel).bulkDelete(n + 1, true);
    const notice = await (msg.channel as TextChannel).send(`🗑️ Deleted **${deleted.size - 1}** messages.`);
    setTimeout(() => notice.delete().catch(() => {}), 4000);
  },

  lock: async (msg) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.ManageChannels)) return;
    await (msg.channel as TextChannel).permissionOverwrites.edit(msg.guild!.id, { SendMessages: false });
    await reply(msg, "🔒 Channel locked.");
  },

  unlock: async (msg) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.ManageChannels)) return;
    await (msg.channel as TextChannel).permissionOverwrites.edit(msg.guild!.id, { SendMessages: null });
    await reply(msg, "🔓 Channel unlocked.");
  },

  mute: async (msg, args) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
    if (!args[0]) return reply(msg, "Usage: `mute @user [minutes] [reason]`");
    const target = await msg.guild!.members.fetch(mention2id(args[0])).catch(() => null);
    if (!target) return reply(msg, "❌ User not found.");
    const minutes = parseInt(args[1]) || 60;
    const reason = args.slice(isNaN(parseInt(args[1])) ? 1 : 2).join(" ") || "No reason";
    await target.timeout(minutes * 60 * 1000, reason);
    await reply(msg, embed(0xfee75c, "🔇 Muted").addFields(
      { name: "User", value: target.user.tag, inline: true },
      { name: "Duration", value: `${minutes}m`, inline: true },
      { name: "Reason", value: reason },
    ));
  },

  unmute: async (msg, args) => {
    if (!msg.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
    if (!args[0]) return reply(msg, "Usage: `unmute @user`");
    const target = await msg.guild!.members.fetch(mention2id(args[0])).catch(() => null);
    if (!target) return reply(msg, "❌ User not found.");
    await target.timeout(null);
    await reply(msg, `✅ Unmuted **${target.user.tag}**.`);
  },

  // ── Panel (owner only) ─────────────────────────────────────────────────
  panel: async (msg, args) => {
    if (!args[0]) return reply(msg, "Usage: `panel <name>`");
    const p = await getPanel(msg.guildId!, args[0]);
    if (!p) return reply(msg, `❌ No panel named **${args[0]}** found.`);
    const e = embed(0x2b2d31).setDescription(`**${p.name}**\n\n${p.description}`);
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`panel:redeem:${p.name}`).setLabel("🔑 Redeem Key").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`panel:script:${p.name}`).setLabel("📜 Get Script").setStyle(ButtonStyle.Primary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`panel:role:${p.name}`).setLabel("👤 Get Role").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`panel:hwid:${p.name}`).setLabel("⚙️ Reset HWID").setStyle(ButtonStyle.Secondary),
    );
    const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`panel:stats:${p.name}`).setLabel("📊 Get Stats").setStyle(ButtonStyle.Secondary),
    );
    await (msg.channel as TextChannel).send({ embeds: [e], components: [row1, row2, row3] });
  },

  createpanel: async (msg, args) => {
    if (!isOwner(msg.author.id)) return reply(msg, "❌ Not authorized.");
    if (!args[0]) return reply(msg, "Usage: `createpanel <name> [description...]`");
    const name = args[0].toLowerCase();
    const description = args.slice(1).join(" ") || `This control panel is for the project: **${name}**\nIf you're a buyer, click the buttons below.`;
    const existing = await getPanel(msg.guildId!, name);
    if (existing) return reply(msg, `❌ Panel **${name}** already exists.`);
    await db.insert(panels).values({ guildId: msg.guildId!, name, description, createdBy: msg.author.id });
    await reply(msg, embed(0x57f287, "✅ Panel Created").addFields({ name: "Name", value: name }));
  },

  whitelist: async (msg, args) => {
    if (!isOwner(msg.author.id)) return reply(msg, "❌ Not authorized.");
    if (!args[0] || !args[1]) return reply(msg, "Usage: `whitelist <panel> @user`");
    const p = await getPanel(msg.guildId!, args[0]);
    if (!p) return reply(msg, `❌ Panel **${args[0]}** not found.`);
    const targetId = mention2id(args[1]);
    const target = await msg.client.users.fetch(targetId).catch(() => null);
    if (!target) return reply(msg, "❌ User not found.");
    const [existing] = await db.select().from(panelWhitelist)
      .where(and(eq(panelWhitelist.panelId, p.id), eq(panelWhitelist.userId, targetId)));
    if (existing) return reply(msg, `❌ Already whitelisted.`);
    const [bl] = await db.select().from(panelBlacklist)
      .where(and(eq(panelBlacklist.panelId, p.id), eq(panelBlacklist.userId, targetId), eq(panelBlacklist.active, true)));
    if (bl) return reply(msg, "❌ User is blacklisted. Unblacklist first.");
    await db.insert(panelWhitelist).values({ panelId: p.id, userId: targetId, whitelistedBy: msg.author.id });
    await reply(msg, embed(0x57f287, "✅ Whitelisted").addFields(
      { name: "User", value: target.tag, inline: true },
      { name: "Panel", value: p.name, inline: true },
    ));
    try {
      await target.send({ embeds: [embed(0x57f287, "✅ You have been whitelisted!").setDescription(`You have been whitelisted for **${p.name}**.\nClick **Get Script** in the panel to access your script.`)] });
    } catch {}
  },

  unwhitelist: async (msg, args) => {
    if (!isOwner(msg.author.id)) return reply(msg, "❌ Not authorized.");
    if (!args[0] || !args[1]) return reply(msg, "Usage: `unwhitelist <panel> @user`");
    const p = await getPanel(msg.guildId!, args[0]);
    if (!p) return reply(msg, `❌ Panel **${args[0]}** not found.`);
    const targetId = mention2id(args[1]);
    const deleted = await db.delete(panelWhitelist)
      .where(and(eq(panelWhitelist.panelId, p.id), eq(panelWhitelist.userId, targetId))).returning();
    if (!deleted.length) return reply(msg, "❌ Not whitelisted.");
    await reply(msg, `✅ Removed from whitelist.`);
  },

  blacklist: async (msg, args) => {
    if (!isOwner(msg.author.id)) return reply(msg, "❌ Not authorized.");
    if (!args[0] || !args[1]) return reply(msg, "Usage: `blacklist <panel> @user [reason]`");
    const p = await getPanel(msg.guildId!, args[0]);
    if (!p) return reply(msg, `❌ Panel **${args[0]}** not found.`);
    const targetId = mention2id(args[1]);
    const target = await msg.client.users.fetch(targetId).catch(() => null);
    if (!target) return reply(msg, "❌ User not found.");
    const reason = args.slice(2).join(" ") || "No reason provided";
    await db.delete(panelWhitelist).where(and(eq(panelWhitelist.panelId, p.id), eq(panelWhitelist.userId, targetId)));
    await db.update(panelBlacklist).set({ active: false })
      .where(and(eq(panelBlacklist.panelId, p.id), eq(panelBlacklist.userId, targetId)));
    await db.insert(panelBlacklist).values({ panelId: p.id, userId: targetId, reason, blacklistedBy: msg.author.id });
    await reply(msg, embed(0xed4245, "🔨 Blacklisted").addFields(
      { name: "User", value: target.tag, inline: true },
      { name: "Panel", value: p.name, inline: true },
      { name: "Reason", value: reason },
    ));
    try {
      await target.send({ embeds: [embed(0xed4245, "🔨 You have been blacklisted").addFields({ name: "Panel", value: p.name, inline: true }, { name: "Reason", value: reason })] });
    } catch {}
  },

  unblacklist: async (msg, args) => {
    if (!isOwner(msg.author.id)) return reply(msg, "❌ Not authorized.");
    if (!args[0] || !args[1]) return reply(msg, "Usage: `unblacklist <panel> @user`");
    const p = await getPanel(msg.guildId!, args[0]);
    if (!p) return reply(msg, `❌ Panel **${args[0]}** not found.`);
    const targetId = mention2id(args[1]);
    await db.update(panelBlacklist).set({ active: false })
      .where(and(eq(panelBlacklist.panelId, p.id), eq(panelBlacklist.userId, targetId)));
    await reply(msg, `✅ Unblacklisted.`);
  },

  generatekeys: async (msg, args) => {
    if (!isOwner(msg.author.id)) return reply(msg, "❌ Not authorized.");
    if (!args[0]) return reply(msg, "Usage: `generatekeys <panel> [count]`");
    const p = await getPanel(msg.guildId!, args[0]);
    if (!p) return reply(msg, `❌ Panel **${args[0]}** not found.`);
    const count = Math.min(parseInt(args[1]) || 1, 50);
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      const keyCode = generateKey();
      await db.insert(panelKeys).values({ panelId: p.id, keyCode });
      keys.push(keyCode);
    }
    await reply(msg, `✅ Generated **${count}** key(s) for **${p.name}**:\n${keys.map((k) => `\`${k}\``).join("\n")}`);
  },

  listkeys: async (msg, args) => {
    if (!isOwner(msg.author.id)) return reply(msg, "❌ Not authorized.");
    if (!args[0]) return reply(msg, "Usage: `listkeys <panel>`");
    const p = await getPanel(msg.guildId!, args[0]);
    if (!p) return reply(msg, `❌ Panel **${args[0]}** not found.`);
    const keys = await db.select().from(panelKeys).where(eq(panelKeys.panelId, p.id));
    if (!keys.length) return reply(msg, "No keys found.");
    const lines = keys.map((k) => `${k.active ? "🟢" : "🔴"} \`${k.keyCode}\` ${k.usedBy ? `— <@${k.usedBy}>` : "— unused"}`);
    await reply(msg, `**Keys for \`${p.name}\`:**\n${lines.slice(0, 20).join("\n")}${keys.length > 20 ? `\n...and ${keys.length - 20} more` : ""}`);
  },

  setrole: async (msg, args) => {
    if (!isOwner(msg.author.id)) return reply(msg, "❌ Not authorized.");
    if (!args[0] || !args[1]) return reply(msg, "Usage: `setrole <panel> @role`");
    const p = await getPanel(msg.guildId!, args[0]);
    if (!p) return reply(msg, `❌ Panel **${args[0]}** not found.`);
    const roleId = role2id(args[1]);
    await db.update(panels).set({ roleId }).where(eq(panels.id, p.id));
    await reply(msg, `✅ Role <@&${roleId}> set for panel **${p.name}**.`);
  },

  // ── Economy ────────────────────────────────────────────────────────────
  balance: async (msg, args) => {
    const targetId = args[0] ? mention2id(args[0]) : msg.author.id;
    const target = await msg.client.users.fetch(targetId).catch(() => null);
    const [acc] = await db.select().from(economy)
      .where(and(eq(economy.guildId, msg.guildId!), eq(economy.userId, targetId)));
    const bal = acc?.balance ?? 0;
    await reply(msg, embed(0xfee75c, "💰 Balance").addFields(
      { name: "User", value: target?.tag ?? targetId, inline: true },
      { name: "Balance", value: `**${bal}** coins`, inline: true },
    ));
  },

  daily: async (msg) => {
    const [acc] = await db.select().from(economy)
      .where(and(eq(economy.guildId, msg.guildId!), eq(economy.userId, msg.author.id)));
    if (acc?.lastDaily) {
      const next = new Date(acc.lastDaily.getTime() + 86400000);
      if (next > new Date()) {
        return reply(msg, `❌ Daily already claimed. Try again <t:${Math.floor(next.getTime() / 1000)}:R>.`);
      }
    }
    const amount = 100 + Math.floor(Math.random() * 150);
    const bal = (acc?.balance ?? 0) + amount;
    if (acc) {
      await db.update(economy).set({ balance: bal, lastDaily: new Date() })
        .where(and(eq(economy.guildId, msg.guildId!), eq(economy.userId, msg.author.id)));
    } else {
      await db.insert(economy).values({ guildId: msg.guildId!, userId: msg.author.id, balance: bal, lastDaily: new Date() });
    }
    await reply(msg, embed(0x57f287, "💰 Daily Claimed").addFields(
      { name: "Earned", value: `+${amount} coins`, inline: true },
      { name: "Balance", value: `${bal} coins`, inline: true },
    ));
  },

  pay: async (msg, args) => {
    if (!args[0] || !args[1]) return reply(msg, "Usage: `pay @user <amount>`");
    const amount = parseInt(args[1]);
    if (isNaN(amount) || amount <= 0) return reply(msg, "❌ Invalid amount.");
    const targetId = mention2id(args[0]);
    if (targetId === msg.author.id) return reply(msg, "❌ Can't pay yourself.");
    const [sender] = await db.select().from(economy)
      .where(and(eq(economy.guildId, msg.guildId!), eq(economy.userId, msg.author.id)));
    if (!sender || sender.balance < amount) return reply(msg, "❌ Insufficient balance.");
    const [receiver] = await db.select().from(economy)
      .where(and(eq(economy.guildId, msg.guildId!), eq(economy.userId, targetId)));
    await db.update(economy).set({ balance: sender.balance - amount })
      .where(and(eq(economy.guildId, msg.guildId!), eq(economy.userId, msg.author.id)));
    if (receiver) {
      await db.update(economy).set({ balance: receiver.balance + amount })
        .where(and(eq(economy.guildId, msg.guildId!), eq(economy.userId, targetId)));
    } else {
      await db.insert(economy).values({ guildId: msg.guildId!, userId: targetId, balance: amount });
    }
    await reply(msg, `✅ Paid **${amount} coins** to <@${targetId}>.`);
  },

  // ── Fun ────────────────────────────────────────────────────────────────
  "8ball": async (msg, args) => {
    if (!args.length) return reply(msg, "Usage: `8ball <question>`");
    const responses = [
      "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes, definitely.",
      "As I see it, yes.", "Most likely.", "Outlook good.", "Yes.", "Signs point to yes.",
      "Reply hazy, try again.", "Ask again later.", "Cannot predict now.",
      "Don't count on it.", "My reply is no.", "My sources say no.",
      "Outlook not so good.", "Very doubtful.",
    ];
    const answer = responses[Math.floor(Math.random() * responses.length)];
    const e = embed(0x5865f2, "🎱 Magic 8-Ball")
      .addFields({ name: "Question", value: args.join(" ") }, { name: "Answer", value: answer });
    await reply(msg, e);
  },

  joke: async (msg) => {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything!",
      "I told my wife she was drawing her eyebrows too high. She looked surprised.",
      "Why did the scarecrow win an award? Because he was outstanding in his field!",
      "I'm reading a book about anti-gravity. It's impossible to put down.",
      "What do you call a fake noodle? An impasta.",
    ];
    await reply(msg, jokes[Math.floor(Math.random() * jokes.length)]);
  },

  roll: async (msg, args) => {
    const max = parseInt(args[0]) || 6;
    const result = Math.floor(Math.random() * max) + 1;
    await reply(msg, `🎲 You rolled a **${result}** (1–${max})`);
  },

  coinflip: async (msg) => {
    await reply(msg, `🪙 **${Math.random() < 0.5 ? "Heads" : "Tails"}!**`);
  },

  choose: async (msg, args) => {
    if (!args.length) return reply(msg, "Usage: `choose option1 option2 ...`");
    await reply(msg, `🎯 I choose: **${args[Math.floor(Math.random() * args.length)]}**`);
  },

  // ── Utility ────────────────────────────────────────────────────────────
  userinfo: async (msg, args) => {
    const targetId = args[0] ? mention2id(args[0]) : msg.author.id;
    const member = await msg.guild!.members.fetch(targetId).catch(() => null);
    if (!member) return reply(msg, "❌ User not found.");
    const e = embed(0x5865f2, member.user.tag)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: "ID", value: member.id, inline: true },
        { name: "Joined", value: `<t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`, inline: true },
        { name: "Account created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: "Roles", value: member.roles.cache.filter((r) => r.id !== msg.guildId).map((r) => `${r}`).join(", ") || "None" },
      );
    await reply(msg, e);
  },

  serverinfo: async (msg) => {
    const g = msg.guild!;
    const e = embed(0x5865f2, g.name)
      .setThumbnail(g.iconURL())
      .addFields(
        { name: "Members", value: `${g.memberCount}`, inline: true },
        { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
        { name: "Boost Level", value: `${g.premiumTier}`, inline: true },
      );
    await reply(msg, e);
  },

  avatar: async (msg, args) => {
    const targetId = args[0] ? mention2id(args[0]) : msg.author.id;
    const user = await msg.client.users.fetch(targetId).catch(() => null);
    if (!user) return reply(msg, "❌ User not found.");
    await reply(msg, embed(0x5865f2, `${user.tag}'s Avatar`).setImage(user.displayAvatarURL({ size: 512 })));
  },

  // ── Tickets ────────────────────────────────────────────────────────────
  closeticket: async (msg) => {
    const [ticket] = await db.select().from(tickets).where(eq(tickets.channelId, msg.channelId));
    if (!ticket) return reply(msg, "❌ This is not a ticket channel.");
    const isStaff = isOwner(msg.author.id) || (msg.member?.permissions.has(PermissionFlagsBits.ManageChannels) ?? false);
    if (!isStaff && ticket.userId !== msg.author.id) return reply(msg, "❌ Only the ticket owner or staff can close this.");
    await (msg.channel as TextChannel).send("🔒 Closing ticket in 5 seconds...");
    await db.update(tickets).set({ closedAt: new Date(), closedBy: msg.author.id })
      .where(eq(tickets.channelId, msg.channelId));
    setTimeout(() => msg.channel.delete().catch(() => {}), 5000);
  },
};

// Aliases
commands["wl"] = commands["whitelist"];
commands["bl"] = commands["blacklist"];
commands["genkeys"] = commands["generatekeys"];
commands["bal"] = commands["balance"];

// ── Export router ──────────────────────────────────────────────────────────

const recentlyHandled = new Set<string>();

export async function handlePrefixMessage(msg: Message, client: Client) {
  if (msg.author.bot || !msg.guild) return;

  const prefix = PREFIXES.find((p) => msg.content.startsWith(p));
  if (!prefix) return;

  if (recentlyHandled.has(msg.id)) return;
  recentlyHandled.add(msg.id);
  setTimeout(() => recentlyHandled.delete(msg.id), 5000);

  const withoutPrefix = msg.content.slice(prefix.length).trim();
  if (!withoutPrefix) return;

  const [commandName, ...rest] = withoutPrefix.split(/\s+/);
  const handler = commands[commandName.toLowerCase()];
  if (!handler) return;

  try {
    await handler(msg, rest, client);
  } catch (err: any) {
    await msg.reply(`❌ Error: ${err?.message ?? "Something went wrong."}`).catch(() => {});
  }
}
