import { SlashCommandBuilder, ChatInputCommandInteraction, Client, EmbedBuilder, GuildMember, ActivityType } from "discord.js";

function infoEmbed(color: number) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

export const infoCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check the bot's latency"),
    async execute(interaction: ChatInputCommandInteraction, client: Client) {
      const sent = await interaction.reply({ content: "Pinging...", fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      const embed = infoEmbed(0x5865f2)
        .setTitle("🏓 Pong!")
        .addFields(
          { name: "Roundtrip", value: `${latency}ms`, inline: true },
          { name: "API Latency", value: `${Math.round(client.ws.ping)}ms`, inline: true }
        );
      await interaction.editReply({ content: "", embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Get info about a user")
      .addUserOption((o) => o.setName("user").setDescription("User to look up")),
    async execute(interaction: ChatInputCommandInteraction) {
      const member = (interaction.options.getMember("user") ?? interaction.member) as GuildMember;
      const user = member.user;
      const roles = member.roles.cache.filter((r) => r.id !== interaction.guildId).map((r) => r.toString()).join(", ") || "None";
      const embed = infoEmbed(0x5865f2)
        .setTitle(`👤 ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "ID", value: user.id, inline: true },
          { name: "Nickname", value: member.nickname ?? "None", inline: true },
          { name: "Account Created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: "Joined Server", value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "Unknown", inline: true },
          { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
          { name: `Roles (${member.roles.cache.size - 1})`, value: roles.length > 1024 ? roles.slice(0, 1020) + "..." : roles }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("Get info about this server"),
    async execute(interaction: ChatInputCommandInteraction) {
      const guild = interaction.guild!;
      await guild.fetch();
      const embed = infoEmbed(0x5865f2)
        .setTitle(`🏠 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
        .addFields(
          { name: "ID", value: guild.id, inline: true },
          { name: "Owner", value: `<@${guild.ownerId}>`, inline: true },
          { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          { name: "Members", value: `${guild.memberCount}`, inline: true },
          { name: "Channels", value: `${guild.channels.cache.size}`, inline: true },
          { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
          { name: "Boost Level", value: `${guild.premiumTier}`, inline: true },
          { name: "Boosts", value: `${guild.premiumSubscriptionCount ?? 0}`, inline: true },
          { name: "Verification", value: guild.verificationLevel.toString(), inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("avatar")
      .setDescription("Get a user's avatar")
      .addUserOption((o) => o.setName("user").setDescription("User")),
    async execute(interaction: ChatInputCommandInteraction) {
      const user = interaction.options.getUser("user") ?? interaction.user;
      const url = user.displayAvatarURL({ size: 1024 });
      const embed = infoEmbed(0x5865f2)
        .setTitle(`🖼️ Avatar — ${user.tag}`)
        .setImage(url)
        .setURL(url);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("botstatus")
      .setDescription("Show bot statistics"),
    async execute(interaction: ChatInputCommandInteraction, client: Client) {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = Math.floor(uptime % 60);
      const mem = process.memoryUsage().heapUsed / 1024 / 1024;
      const embed = infoEmbed(0x5865f2)
        .setTitle("🤖 Bot Status")
        .addFields(
          { name: "Uptime", value: `${h}h ${m}m ${s}s`, inline: true },
          { name: "Ping", value: `${Math.round(client.ws.ping)}ms`, inline: true },
          { name: "Servers", value: `${client.guilds.cache.size}`, inline: true },
          { name: "Users", value: `${client.users.cache.size}`, inline: true },
          { name: "Memory", value: `${mem.toFixed(1)} MB`, inline: true },
          { name: "Node.js", value: process.version, inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("rank")
      .setDescription("Check your economy rank")
      .addUserOption((o) => o.setName("user").setDescription("User to check")),
    async execute(interaction: ChatInputCommandInteraction) {
      const { db } = await import("@workspace/db");
      const { economy } = await import("@workspace/db");
      const { eq, desc } = await import("drizzle-orm");
      const target = interaction.options.getUser("user") ?? interaction.user;
      const all = await db.select().from(economy).where(eq(economy.guildId, interaction.guildId!)).orderBy(desc(economy.balance));
      const rank = all.findIndex((e) => e.userId === target.id) + 1;
      const entry = all.find((e) => e.userId === target.id);
      if (!entry) return interaction.reply({ content: "This user has no economy data yet.", ephemeral: true });
      const embed = infoEmbed(0xf1c40f)
        .setTitle(`🏅 Rank — ${target.tag}`)
        .addFields(
          { name: "Rank", value: `#${rank} of ${all.length}`, inline: true },
          { name: "Balance", value: `$${entry.balance.toLocaleString()}`, inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("help")
      .setDescription("List all commands"),
    async execute(interaction: ChatInputCommandInteraction) {
      const embed = infoEmbed(0x5865f2)
        .setTitle("📖 Command List")
        .addFields(
          { name: "🎮 Fun", value: "/8ball /choose /coinflip /joke /roll /poll /quickpoll" },
          { name: "⚔️ Moderation", value: "/ban /kick /mute /unmute /warn /warnings /purge /purgebots /purgeuser /clear /lock /unlock /lockdown /unlockdown" },
          { name: "💰 Economy", value: "/balance /daily /work /gamble /pay /leaderboard /rank" },
          { name: "ℹ️ Info", value: "/userinfo /serverinfo /avatar /ping /botstatus /help" },
          { name: "🛠️ Utility", value: "/afk /announce /remind /report /invites /inviteleaderboard /whoinvited" },
          { name: "🎵 Music", value: "/play /pause /resume /stop /skip /queue /volume" },
          { name: "⚙️ Setup", value: "/setlogs /setreportchannel /setupverification /setwelcome /testwelcome /ticketsetup /ticketclose /welcomecheck /unverify" }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
];
