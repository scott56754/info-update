import {
  SlashCommandBuilder, ChatInputCommandInteraction, Client,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import { db } from "@workspace/db";
import { giveaways, giveawayEntries } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const OWNERS = ["1417552037717086355", "1501051958629503097"];
function ownerOnly(i: ChatInputCommandInteraction) {
  if (!OWNERS.includes(i.user.id)) {
    i.reply({ content: "❌ You are not authorized to use this command.", flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

function parseDuration(s: string): number | null {
  const match = s.match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const ms: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return n * (ms[unit] ?? 0);
}

export function giveawayEmbed(prize: string, endsAt: Date, hostId: string, winnersCount: number, entries: number, ended = false, winnerIds?: string[]) {
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x5865f2 : 0xfee75c)
    .setTitle(`🎉 GIVEAWAY${ended ? " — ENDED" : ""}`)
    .setDescription(
      ended
        ? `**Prize:** ${prize}\n\n${winnerIds?.length ? `**Winners:** ${winnerIds.map((id) => `<@${id}>`).join(", ")}` : "No winners (no entries)"}`
        : `**Prize:** ${prize}\n\nClick the button below to enter!\nEnds: <t:${Math.floor(endsAt.getTime() / 1000)}:R>`
    )
    .addFields(
      { name: "Winners", value: `${winnersCount}`, inline: true },
      { name: "Entries", value: `${entries}`, inline: true },
      { name: "Hosted by", value: `<@${hostId}>`, inline: true },
    )
    .setTimestamp(endsAt);
  return embed;
}

function enterButton(giveawayId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${giveawayId}`)
      .setLabel("🎉 Enter Giveaway")
      .setStyle(ButtonStyle.Success),
  );
}

export async function endGiveaway(client: Client, giveaway: typeof giveaways.$inferSelect) {
  const entries = await db.select().from(giveawayEntries).where(eq(giveawayEntries.giveawayId, giveaway.id));
  const shuffled = entries.sort(() => Math.random() - 0.5);
  const winners = shuffled.slice(0, giveaway.winnersCount);
  const winnerIds = winners.map((e) => e.userId);

  await db.update(giveaways).set({ ended: true, winnerIds: JSON.stringify(winnerIds) }).where(eq(giveaways.id, giveaway.id));

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (channel?.isTextBased() && giveaway.messageId) {
      const msg = await (channel as any).messages.fetch(giveaway.messageId);
      const embed = giveawayEmbed(giveaway.prize, giveaway.endsAt, giveaway.hostId, giveaway.winnersCount, entries.length, true, winnerIds);
      await msg.edit({ embeds: [embed], components: [] });

      if (winnerIds.length) {
        await (channel as any).send({
          content: `🎉 Congratulations ${winnerIds.map((id) => `<@${id}>`).join(", ")}! You won **${giveaway.prize}**!`,
        });
      } else {
        await (channel as any).send({ content: `😔 No one entered the giveaway for **${giveaway.prize}**.` });
      }
    }
  } catch {}
}

export async function handleGiveawayButton(interaction: any, client: Client, giveawayId: number) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [giveaway] = await db.select().from(giveaways).where(eq(giveaways.id, giveawayId));
  if (!giveaway) return interaction.editReply({ content: "❌ Giveaway not found." });
  if (giveaway.ended || giveaway.endsAt < new Date()) return interaction.editReply({ content: "❌ This giveaway has already ended." });

  const [existing] = await db.select().from(giveawayEntries)
    .where(and(eq(giveawayEntries.giveawayId, giveawayId), eq(giveawayEntries.userId, interaction.user.id)));

  if (existing) {
    await db.delete(giveawayEntries)
      .where(and(eq(giveawayEntries.giveawayId, giveawayId), eq(giveawayEntries.userId, interaction.user.id)));
    return interaction.editReply({ content: "✅ You have left the giveaway." });
  }

  await db.insert(giveawayEntries).values({ giveawayId, userId: interaction.user.id });
  const totalEntries = await db.select().from(giveawayEntries).where(eq(giveawayEntries.giveawayId, giveawayId));

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (channel?.isTextBased() && giveaway.messageId) {
      const msg = await (channel as any).messages.fetch(giveaway.messageId);
      const embed = giveawayEmbed(giveaway.prize, giveaway.endsAt, giveaway.hostId, giveaway.winnersCount, totalEntries.length);
      await msg.edit({ embeds: [embed], components: [enterButton(giveawayId)] });
    }
  } catch {}

  return interaction.editReply({ content: "🎉 You have entered the giveaway! Click again to leave." });
}

export function startGiveawayLoop(client: Client) {
  setInterval(async () => {
    try {
      const now = new Date();
      const active = await db.select().from(giveaways)
        .where(and(eq(giveaways.ended, false)));
      for (const g of active) {
        if (g.endsAt <= now) {
          await endGiveaway(client, g);
        }
      }
    } catch {}
  }, 15_000);
}

export const giveawayCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Giveaway management")
      .addSubcommand((s) =>
        s.setName("start")
          .setDescription("Start a new giveaway")
          .addChannelOption((o) => o.setName("channel").setDescription("Channel to host the giveaway in").setRequired(true))
          .addStringOption((o) => o.setName("duration").setDescription("Duration e.g. 10m, 1h, 1d, 7d").setRequired(true))
          .addStringOption((o) => o.setName("prize").setDescription("What is being given away").setRequired(true))
          .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners (default 1)").setMinValue(1).setMaxValue(20))
      )
      .addSubcommand((s) =>
        s.setName("end")
          .setDescription("End a giveaway early")
          .addIntegerOption((o) => o.setName("id").setDescription("Giveaway ID (use /giveaway list to find it)").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("reroll")
          .setDescription("Reroll winners for an ended giveaway")
          .addIntegerOption((o) => o.setName("id").setDescription("Giveaway ID").setRequired(true))
          .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners to reroll").setMinValue(1).setMaxValue(20))
      )
      .addSubcommand((s) =>
        s.setName("list")
          .setDescription("List active giveaways in this server")
      ),
    async execute(interaction: ChatInputCommandInteraction, client: Client) {
      if (!ownerOnly(interaction)) return;
      const sub = interaction.options.getSubcommand();

      if (sub === "start") {
        const channel = interaction.options.getChannel("channel", true) as any;
        const durationStr = interaction.options.getString("duration", true);
        const prize = interaction.options.getString("prize", true);
        const winnersCount = interaction.options.getInteger("winners") ?? 1;

        const ms = parseDuration(durationStr);
        if (!ms || ms < 5000) return interaction.reply({ content: "❌ Invalid duration. Use format like `10m`, `1h`, `1d`.", flags: MessageFlags.Ephemeral });

        const endsAt = new Date(Date.now() + ms);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const [inserted] = await db.insert(giveaways).values({
          guildId: interaction.guildId!,
          channelId: channel.id,
          hostId: interaction.user.id,
          prize,
          winnersCount,
          endsAt,
        }).returning();

        const embed = giveawayEmbed(prize, endsAt, interaction.user.id, winnersCount, 0);
        const msg = await channel.send({ embeds: [embed], components: [enterButton(inserted.id)] });
        await db.update(giveaways).set({ messageId: msg.id }).where(eq(giveaways.id, inserted.id));

        await interaction.editReply({
          content: `✅ Giveaway started in ${channel}!\n**ID:** ${inserted.id} | **Prize:** ${prize} | **Ends:** <t:${Math.floor(endsAt.getTime() / 1000)}:R>`,
        });
        return;
      }

      if (sub === "end") {
        const id = interaction.options.getInteger("id", true);
        const [giveaway] = await db.select().from(giveaways).where(eq(giveaways.id, id));
        if (!giveaway || giveaway.guildId !== interaction.guildId) return interaction.reply({ content: "❌ Giveaway not found.", flags: MessageFlags.Ephemeral });
        if (giveaway.ended) return interaction.reply({ content: "❌ Giveaway already ended.", flags: MessageFlags.Ephemeral });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await endGiveaway(client, giveaway);
        await interaction.editReply({ content: `✅ Giveaway **#${id}** (${giveaway.prize}) has been ended.` });
        return;
      }

      if (sub === "reroll") {
        const id = interaction.options.getInteger("id", true);
        const winnersCount = interaction.options.getInteger("winners") ?? 1;
        const [giveaway] = await db.select().from(giveaways).where(eq(giveaways.id, id));
        if (!giveaway || giveaway.guildId !== interaction.guildId) return interaction.reply({ content: "❌ Giveaway not found.", flags: MessageFlags.Ephemeral });
        if (!giveaway.ended) return interaction.reply({ content: "❌ Giveaway has not ended yet.", flags: MessageFlags.Ephemeral });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const entries = await db.select().from(giveawayEntries).where(eq(giveawayEntries.giveawayId, id));
        const shuffled = entries.sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(0, winnersCount);
        const winnerIds = winners.map((e) => e.userId);

        await db.update(giveaways).set({ winnerIds: JSON.stringify(winnerIds) }).where(eq(giveaways.id, id));

        try {
          const channel = await client.channels.fetch(giveaway.channelId);
          if (channel?.isTextBased()) {
            if (winnerIds.length) {
              await (channel as any).send({
                content: `🎉 **Reroll!** New winner(s) for **${giveaway.prize}**: ${winnerIds.map((w) => `<@${w}>`).join(", ")}`,
              });
            } else {
              await (channel as any).send({ content: `😔 No entries found to reroll for **${giveaway.prize}**.` });
            }
          }
        } catch {}

        await interaction.editReply({
          content: winnerIds.length ? `✅ Rerolled! New winner(s): ${winnerIds.map((w) => `<@${w}>`).join(", ")}` : "😔 No entries to pick from.",
        });
        return;
      }

      if (sub === "list") {
        const active = await db.select().from(giveaways)
          .where(and(eq(giveaways.guildId, interaction.guildId!), eq(giveaways.ended, false)));
        if (!active.length) return interaction.reply({ content: "No active giveaways.", flags: MessageFlags.Ephemeral });
        const embed = new EmbedBuilder().setColor(0xfee75c).setTitle("🎉 Active Giveaways")
          .setDescription(active.map((g) => `**ID ${g.id}** — ${g.prize} | <#${g.channelId}> | Ends <t:${Math.floor(g.endsAt.getTime() / 1000)}:R>`).join("\n"));
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    },
  },
];
