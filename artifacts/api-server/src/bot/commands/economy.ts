import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { db } from "@workspace/db";
import { economy } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

async function getOrCreate(userId: string, guildId: string) {
  const [existing] = await db.select().from(economy).where(and(eq(economy.userId, userId), eq(economy.guildId, guildId)));
  if (existing) return existing;
  const [created] = await db.insert(economy).values({ userId, guildId, balance: 500 }).returning();
  return created;
}

function ecoEmbed(color: number) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

const DAILY_AMOUNT = 500;
const WORK_COOLDOWN_MS = 30 * 60 * 1000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const workMessages = [
  "You worked as a chef and earned", "You drove for Uber and earned",
  "You streamed on Twitch and earned", "You fixed computers and earned",
  "You walked dogs and earned", "You mined crypto and somehow earned",
];

export const economyCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("balance")
      .setDescription("Check your balance or another user's balance")
      .addUserOption((o) => o.setName("user").setDescription("User to check")),
    async execute(interaction: ChatInputCommandInteraction) {
      const target = interaction.options.getUser("user") ?? interaction.user;
      const acc = await getOrCreate(target.id, interaction.guildId!);
      const embed = ecoEmbed(0xf1c40f)
        .setTitle(`💰 Balance — ${target.tag}`)
        .addFields(
          { name: "Wallet", value: `$${acc.balance.toLocaleString()}`, inline: true },
          { name: "Bank", value: `$${acc.bank.toLocaleString()}`, inline: true },
          { name: "Total", value: `$${(acc.balance + acc.bank).toLocaleString()}`, inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("daily")
      .setDescription("Claim your daily reward"),
    async execute(interaction: ChatInputCommandInteraction) {
      const acc = await getOrCreate(interaction.user.id, interaction.guildId!);
      if (acc.lastDaily && Date.now() - new Date(acc.lastDaily).getTime() < DAILY_COOLDOWN_MS) {
        const next = new Date(new Date(acc.lastDaily).getTime() + DAILY_COOLDOWN_MS);
        return interaction.reply({ content: `⏰ Daily already claimed! Come back <t:${Math.floor(next.getTime() / 1000)}:R>.`, ephemeral: true });
      }
      const [updated] = await db.update(economy)
        .set({ balance: acc.balance + DAILY_AMOUNT, lastDaily: new Date() })
        .where(and(eq(economy.userId, interaction.user.id), eq(economy.guildId, interaction.guildId!)))
        .returning();
      const embed = ecoEmbed(0x57f287)
        .setTitle("💸 Daily Reward Claimed!")
        .setDescription(`You received **$${DAILY_AMOUNT}**!\nNew balance: **$${updated.balance.toLocaleString()}**`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("work")
      .setDescription("Work to earn some money"),
    async execute(interaction: ChatInputCommandInteraction) {
      const acc = await getOrCreate(interaction.user.id, interaction.guildId!);
      if (acc.lastWork && Date.now() - new Date(acc.lastWork).getTime() < WORK_COOLDOWN_MS) {
        const next = new Date(new Date(acc.lastWork).getTime() + WORK_COOLDOWN_MS);
        return interaction.reply({ content: `⏰ You need to rest! Work again <t:${Math.floor(next.getTime() / 1000)}:R>.`, ephemeral: true });
      }
      const earned = Math.floor(Math.random() * 200) + 50;
      const msg = workMessages[Math.floor(Math.random() * workMessages.length)];
      await db.update(economy)
        .set({ balance: acc.balance + earned, lastWork: new Date() })
        .where(and(eq(economy.userId, interaction.user.id), eq(economy.guildId, interaction.guildId!)));
      const embed = ecoEmbed(0x57f287)
        .setTitle("💼 Work Complete")
        .setDescription(`${msg} **$${earned}**!`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("gamble")
      .setDescription("Gamble your money")
      .addIntegerOption((o) => o.setName("amount").setDescription("Amount to gamble").setRequired(true).setMinValue(1)),
    async execute(interaction: ChatInputCommandInteraction) {
      const amount = interaction.options.getInteger("amount", true);
      const acc = await getOrCreate(interaction.user.id, interaction.guildId!);
      if (acc.balance < amount) {
        return interaction.reply({ content: `❌ You only have **$${acc.balance}**.`, ephemeral: true });
      }
      const win = Math.random() < 0.45;
      const newBalance = win ? acc.balance + amount : acc.balance - amount;
      await db.update(economy).set({ balance: newBalance }).where(and(eq(economy.userId, interaction.user.id), eq(economy.guildId, interaction.guildId!)));
      const embed = ecoEmbed(win ? 0x57f287 : 0xed4245)
        .setTitle(win ? "🎰 You Won!" : "🎰 You Lost!")
        .setDescription(win
          ? `You won **$${amount}**! New balance: **$${newBalance.toLocaleString()}**`
          : `You lost **$${amount}**. New balance: **$${newBalance.toLocaleString()}**`
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("pay")
      .setDescription("Pay another user")
      .addUserOption((o) => o.setName("user").setDescription("User to pay").setRequired(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("Amount to pay").setRequired(true).setMinValue(1)),
    async execute(interaction: ChatInputCommandInteraction) {
      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      if (target.id === interaction.user.id) return interaction.reply({ content: "You can't pay yourself!", ephemeral: true });
      const from = await getOrCreate(interaction.user.id, interaction.guildId!);
      if (from.balance < amount) return interaction.reply({ content: `❌ You only have **$${from.balance}**.`, ephemeral: true });
      const to = await getOrCreate(target.id, interaction.guildId!);
      await db.update(economy).set({ balance: from.balance - amount }).where(and(eq(economy.userId, interaction.user.id), eq(economy.guildId, interaction.guildId!)));
      await db.update(economy).set({ balance: to.balance + amount }).where(and(eq(economy.userId, target.id), eq(economy.guildId, interaction.guildId!)));
      const embed = ecoEmbed(0x57f287)
        .setTitle("💸 Payment Sent")
        .addFields(
          { name: "From", value: interaction.user.tag, inline: true },
          { name: "To", value: target.tag, inline: true },
          { name: "Amount", value: `$${amount.toLocaleString()}`, inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("View the economy leaderboard"),
    async execute(interaction: ChatInputCommandInteraction) {
      const top = await db.select().from(economy)
        .where(eq(economy.guildId, interaction.guildId!))
        .orderBy(desc(economy.balance))
        .limit(10);
      const lines = await Promise.all(top.map(async (e, i) => {
        try {
          const user = await interaction.client.users.fetch(e.userId);
          return `**${i + 1}.** ${user.tag} — $${e.balance.toLocaleString()}`;
        } catch {
          return `**${i + 1}.** Unknown — $${e.balance.toLocaleString()}`;
        }
      }));
      const embed = ecoEmbed(0xf1c40f)
        .setTitle("🏆 Economy Leaderboard")
        .setDescription(lines.join("\n") || "No data yet.");
      await interaction.reply({ embeds: [embed] });
    },
  },
];
