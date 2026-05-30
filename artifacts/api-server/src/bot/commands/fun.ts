import { SlashCommandBuilder, ChatInputCommandInteraction, Client, EmbedBuilder, PermissionFlagsBits } from "discord.js";

const eightBallResponses = [
  "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes, definitely.",
  "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.",
  "Yes.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.",
  "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
  "Don't count on it.", "My reply is no.", "My sources say no.",
  "Outlook not so good.", "Very doubtful.",
];

const jokes = [
  "Why don't scientists trust atoms? Because they make up everything!",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "Why did the scarecrow win an award? Because he was outstanding in his field!",
  "I'm reading a book about anti-gravity. It's impossible to put down.",
  "Did you hear about the mathematician who's afraid of negative numbers? He'll stop at nothing to avoid them.",
  "Why do cows wear bells? Because their horns don't work.",
  "I asked the librarian if they had books about paranoia. She whispered, 'They're right behind you!'",
  "What do you call a fake noodle? An impasta.",
  "How does a penguin build its house? Igloos it together.",
  "I used to hate facial hair but then it grew on me.",
];

function makeEmbed(color: number) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

export const funCommands = [
  {
    data: new SlashCommandBuilder()
      .setName("8ball")
      .setDescription("Ask the magic 8-ball a question")
      .addStringOption((o) => o.setName("question").setDescription("Your question").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const question = interaction.options.getString("question", true);
      const answer = eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
      const embed = makeEmbed(0x7289da)
        .setTitle("🎱 Magic 8-Ball")
        .addFields(
          { name: "Question", value: question },
          { name: "Answer", value: answer }
        );
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("choose")
      .setDescription("Choose between multiple options")
      .addStringOption((o) => o.setName("options").setDescription("Options separated by commas").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const raw = interaction.options.getString("options", true);
      const options = raw.split(",").map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) {
        return interaction.reply({ content: "Please provide at least 2 options separated by commas.", flags: MessageFlags.Ephemeral });
      }
      const chosen = options[Math.floor(Math.random() * options.length)];
      const embed = makeEmbed(0x57f287)
        .setTitle("🎯 I choose...")
        .setDescription(`**${chosen}**`)
        .addFields({ name: "Options", value: options.join(", ") });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("coinflip")
      .setDescription("Flip a coin"),
    async execute(interaction: ChatInputCommandInteraction) {
      const result = Math.random() < 0.5 ? "Heads" : "Tails";
      const embed = makeEmbed(0xfee75c)
        .setTitle("🪙 Coin Flip")
        .setDescription(`It landed on **${result}**!`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("joke")
      .setDescription("Get a random joke"),
    async execute(interaction: ChatInputCommandInteraction) {
      const joke = jokes[Math.floor(Math.random() * jokes.length)];
      const embed = makeEmbed(0xfee75c).setTitle("😄 Here's a joke!").setDescription(joke);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("roll")
      .setDescription("Roll a dice")
      .addIntegerOption((o) => o.setName("sides").setDescription("Number of sides (default: 6)").setMinValue(2).setMaxValue(1000)),
    async execute(interaction: ChatInputCommandInteraction) {
      const sides = interaction.options.getInteger("sides") ?? 6;
      const result = Math.floor(Math.random() * sides) + 1;
      const embed = makeEmbed(0x5865f2)
        .setTitle("🎲 Dice Roll")
        .setDescription(`You rolled a **${result}** out of ${sides}`);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("poll")
      .setDescription("Create a poll")
      .addStringOption((o) => o.setName("question").setDescription("Poll question").setRequired(true))
      .addStringOption((o) => o.setName("options").setDescription("Options separated by commas (max 5)").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const question = interaction.options.getString("question", true);
      const raw = interaction.options.getString("options", true);
      const options = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
      if (options.length < 2) {
        return interaction.reply({ content: "Please provide at least 2 options.", flags: MessageFlags.Ephemeral });
      }
      const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
      const description = options.map((o, i) => `${emojis[i]} ${o}`).join("\n");
      const embed = makeEmbed(0x5865f2)
        .setTitle(`📊 ${question}`)
        .setDescription(description)
        .setFooter({ text: `Poll by ${interaction.user.tag}` });
      const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
      for (let i = 0; i < options.length; i++) {
        await msg.react(emojis[i]);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("quickpoll")
      .setDescription("Create a quick yes/no poll")
      .addStringOption((o) => o.setName("question").setDescription("Poll question").setRequired(true)),
    async execute(interaction: ChatInputCommandInteraction) {
      const question = interaction.options.getString("question", true);
      const embed = makeEmbed(0x5865f2)
        .setTitle(`📊 ${question}`)
        .setDescription("👍 Yes\n👎 No")
        .setFooter({ text: `Poll by ${interaction.user.tag}` });
      const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
      await msg.react("👍");
      await msg.react("👎");
    },
  },
];
