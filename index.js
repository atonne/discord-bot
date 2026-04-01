const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const googleTTS = require("google-tts-api");
require("dotenv").config();

// Khởi tạo Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

// Lưu trữ connections cho mỗi guild
const connections = new Map();

// Commands
const commands = [
  new SlashCommandBuilder()
    .setName("speak")
    .setDescription("Bot sẽ đọc text tiếng Việt")
    .addStringOption((option) =>
      option.setName("text").setDescription("Text cần đọc").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Bot sẽ rời khỏi voice channel"),
];

// Đăng ký commands
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Đang đăng ký slash commands...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });
    console.log("Đăng ký slash commands thành công!");
  } catch (error) {
    console.error("Lỗi khi đăng ký commands:", error);
  }
})();

// Hàm tạo TTS audio URL
async function createTTSAudio(text) {
  try {
    const audioUrl = await googleTTS(text, "vi", 1);
    return audioUrl;
  } catch (error) {
    console.error("Lỗi khi tạo TTS:", error);
    throw error;
  }
}

// Hàm join voice channel
async function joinChannel(voiceChannel, guildId, adapterCreator) {
  console.log("Đang kết nối voice channel:", voiceChannel.name);

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guildId,
    adapterCreator: adapterCreator,
    selfDeaf: false,
    selfMute: false,
    debug: true,
  });

  // Handle disconnections - try to reconnect
  connection.on("stateChange", (oldState, newState) => {
    console.log(`Voice: ${oldState.status} -> ${newState.status}`);

    // Nếu bị disconnect, thử reconnect
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try {
        connection.rejoin();
      } catch (e) {
        console.error("Reconnect failed:", e);
      }
    }
  });

  connection.on("error", (error) => {
    console.error("Voice connection error:", error);
  });

  // Đợi connection ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 5000);
    console.log("Voice connection ready!");
  } catch (error) {
    console.error("Connection timeout:", error);
  }

  connections.set(guildId, connection);
  return connection;
}

// Hàm phát audio trong voice channel
async function playTTS(connection, audioUrl) {
  try {
    console.log("Đang phát TTS...");

    // Đảm bảo connection ready trước khi phát
    await entersState(connection, VoiceConnectionStatus.Ready, 5000);
    console.log("Connection ready, bắt đầu phát audio");

    // Tạo player
    const player = createAudioPlayer();

    // Subscribe player vào connection
    const subscription = connection.subscribe(player);
    console.log("Subscribed:", !!subscription);

    // Tạo audio resource từ URL
    const resource = createAudioResource(audioUrl, {
      inlineVolume: true,
    });
    console.log("Playing from:", audioUrl);

    // Tăng volume
    if (resource.volume) {
      resource.volume.setVolume(1);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log("TTS timeout");
        resolve();
      }, 30000);

      player.on("error", (error) => {
        console.error("Player error:", error);
        clearTimeout(timeout);
        reject(error);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        console.log("TTS hoàn thành");
        clearTimeout(timeout);
        resolve();
      });

      player.on(AudioPlayerStatus.Playing, () => {
        console.log("Audio đang phát!");
      });

      player.on(AudioPlayerStatus.Buffering, () => {
        console.log("Audio đang buffering...");
      });

      // Play
      player.play(resource);
      console.log("Player state:", player.state.status);
    });
  } catch (error) {
    console.error("Lỗi khi phát audio:", error);
    throw error;
  }
}

// Event khi bot sẵn sàng
client.once(Events.ClientReady, () => {
  console.log(`Bot đã sẵn sàng! Đăng nhập với tên: ${client.user.tag}`);
});

// Xử lý slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "speak") {
    try {
      await interaction.deferReply();
    } catch (e) {
      console.error("Defer failed:", e.message);
      return;
    }

    const text = interaction.options.getString("text");
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    // Kiểm tra user có trong voice channel không
    if (!voiceChannel) {
      return interaction.editReply("Bạn cần ở trong một voice channel!");
    }

    try {
      // Tự động join channel nếu chưa join hoặc đang ở channel khác
      let connection = connections.get(interaction.guild.id);
      if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
        connection = await joinChannel(
          voiceChannel,
          interaction.guild.id,
          interaction.guild.voiceAdapterCreator,
        );
      }

      // Tạo TTS URL
      const audioUrl = await createTTSAudio(text);

      // Reply trước
      await interaction.editReply(`🔊 Đang đọc: "${text}"`);

      // Phát audio
      playTTS(connection, audioUrl).catch((err) => {
        console.error("Lỗi phát TTS:", err);
      });
    } catch (error) {
      console.error("Lỗi khi đọc text:", error);
      try {
        await interaction.editReply("Không thể đọc text!");
      } catch (e) {
        console.error("EditReply failed:", e.message);
      }
    }
  } else if (commandName === "leave") {
    await interaction.deferReply();

    const connection = connections.get(interaction.guild.id);

    if (!connection) {
      return interaction.editReply("Bot không ở trong voice channel nào!");
    }

    try {
      connection.destroy();
      connections.delete(interaction.guild.id);
      await interaction.editReply("Đã rời khỏi voice channel!");
    } catch (error) {
      console.error("Lỗi khi rời voice channel:", error);
      await interaction.editReply("Không thể rời voice channel!");
    }
  }
});

// Xử lý tin nhắn thường (TTS khi mention hoặc "bot đọc")
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Kiểm tra có mention bot hoặc có từ khóa "bot đọc"
  if (
    message.mentions.has(client.user) ||
    message.content.toLowerCase().includes("bot đọc")
  ) {
    const voiceChannel = message.member.voice.channel;

    if (!voiceChannel) {
      return message.reply("Bạn cần ở trong một voice channel!");
    }

    // Lấy text cần đọc
    let textToRead = message.content
      .replace(/<@!?\d+>/g, "")
      .replace(/bot đọc/gi, "")
      .trim();

    if (!textToRead) {
      return message.reply("Vui lòng cung cấp text cần đọc!");
    }

    try {
      // Tự động join channel
      let connection = connections.get(message.guild.id);
      if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
        connection = await joinChannel(
          voiceChannel,
          message.guild.id,
          message.guild.voiceAdapterCreator,
        );
      }

      // Tạo TTS URL
      const audioUrl = await createTTSAudio(textToRead);

      // React trước
      message.react("🔊");

      // Phát audio (không await)
      playTTS(connection, audioUrl)
        .then(() => {
          message.react("✅");
        })
        .catch((err) => {
          console.error("Lỗi phát TTS:", err);
        });
    } catch (error) {
      console.error("Lỗi khi đọc text:", error);
      message.reply("Không thể đọc text!");
    }
  }
});

// Xử lý lỗi
client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

// Đăng nhập bot
client.login(process.env.DISCORD_TOKEN);
