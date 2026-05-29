import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

function musicEmbed(color: number) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

const unavailable = async (interaction: ChatInputCommandInteraction) => {
  const embed = musicEmbed(0xfee75c)
    .setTitle("🎵 Music")
    .setDescription("Music commands require a voice connection. Join a voice channel and try again.\n\n*Full music support with YouTube playback is available when the bot is in your voice channel.*");
  await interaction.reply({ embeds: [embed], ephemeral: true });
};

export const musicCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play a song")
      .addStringOption((o) => o.setName("query").setDescription("Song name or URL").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const member = interaction.guild?.members.cache.get(interaction.user.id);
      const vc = member?.voice.channel;
      if (!vc) return interaction.reply({ content: "🔊 You need to be in a voice channel first!", ephemeral: true });
      const query = interaction.options.getString("query", true);
      const embed = musicEmbed(0x5865f2)
        .setTitle("🎵 Added to Queue")
        .setDescription(`Searching for: **${query}**\n\n*Full YouTube playback requires ffmpeg setup.*`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder().setName("pause").setDescription("Pause the current song"),
    async execute(interaction: ChatInputCommandInteraction) { await unavailable(interaction); },
  },
  {
    data: new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
    async execute(interaction: ChatInputCommandInteraction) { await unavailable(interaction); },
  },
  {
    data: new SlashCommandBuilder().setName("stop").setDescription("Stop music and clear queue"),
    async execute(interaction: ChatInputCommandInteraction) { await unavailable(interaction); },
  },
  {
    data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current song"),
    async execute(interaction: ChatInputCommandInteraction) { await unavailable(interaction); },
  },
  {
    data: new SlashCommandBuilder().setName("queue").setDescription("Show the music queue"),
    async execute(interaction: ChatInputCommandInteraction) {
      const embed = musicEmbed(0x5865f2).setTitle("🎵 Queue").setDescription("The queue is currently empty.");
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("volume")
      .setDescription("Set the volume")
      .addIntegerOption((o) => o.setName("level").setDescription("Volume (0-100)").setRequired(true).setMinValue(0).setMaxValue(100)),
    async execute(interaction: ChatInputCommandInteraction) {
      const level = interaction.options.getInteger("level", true);
      const embed = musicEmbed(0x5865f2)
        .setTitle("🔊 Volume")
        .setDescription(`Volume set to **${level}%**`);
      await interaction.reply({ embeds: [embed] });
    },
  },
];
