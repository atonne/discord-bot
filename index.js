const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");
const { request, fetch: uFetch } = require("undici");
const { Readable } = require("stream");
const googleTTS = require("google-tts-api");
const playdl = require("play-dl");
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

// ============================================================
// MUSIC QUEUE SYSTEM
// ============================================================

// musicQueues: Map<guildId, QueueState>
// QueueState: { connection, player, songs, textChannel, loop }
const musicQueues = new Map();

function getQueue(guildId) {
  return musicQueues.get(guildId) || null;
}

function formatDuration(seconds) {
  if (!seconds) return "🔴 Live";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function playSong(guildId, song) {
  const queue = getQueue(guildId);
  if (!queue) return;

  try {
    const ytdlexec = require("youtube-dl-exec");
    const subprocess = ytdlexec.exec(song.url, {
      o: '-',
      q: true,
      f: 'bestaudio',
      r: '1M',
    }, { stdio: ['ignore', 'pipe', 'ignore'] });

    const resource = createAudioResource(subprocess.stdout, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });
    
    // Dọn dẹp process khi kết thúc phát
    resource.playStream.on('error', () => subprocess.kill());
    resource.playStream.on('close', () => subprocess.kill());

    if (resource.volume) resource.volume.setVolume(0.8);

    queue.player.play(resource);
    queue.currentSong = song;

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle("🎵 Đang phát")
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: "Thời lượng", value: formatDuration(song.durationSec), inline: true },
        { name: "Yêu cầu bởi", value: song.requestedBy, inline: true },
      )
      .setThumbnail(song.thumbnail);

    if (queue.textChannel) queue.textChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Lỗi phát nhạc:", err);
    if (queue.textChannel) queue.textChannel.send(`❌ Lỗi khi phát: **${song.title}**. Bỏ qua...`);
    advanceQueue(guildId);
  }
}

function advanceQueue(guildId) {
  const queue = getQueue(guildId);
  if (!queue) return;

  if (queue.loop && queue.currentSong) {
    queue.songs.unshift(queue.currentSong);
  }

  if (queue.songs.length === 0) {
    queue.currentSong = null;
    if (queue.textChannel) queue.textChannel.send("✅ Đã phát hết hàng chờ nhạc!");
    setTimeout(() => {
      const q = getQueue(guildId);
      if (q && q.songs.length === 0 && !q.currentSong) {
        q.connection.destroy();
        musicQueues.delete(guildId);
      }
    }, 60000);
    return;
  }

  const nextSong = queue.songs.shift();
  playSong(guildId, nextSong);
}

// ============================================================
// BONG DA LINK FINDER
// ============================================================

const BONGDA_SITES = [
  {
    keyword: "rakhoi",
    label: "Rakhoi TV",
    emoji: "🔴",
    searchQuery: "rakhoi tv bóng đá trực tiếp",
  },
  {
    keyword: "cakhia",
    label: "Cakhia TV",
    emoji: "🟡",
    searchQuery: "cakhia tv xem bóng đá",
  },
  {
    keyword: "xoilac",
    label: "Xoilac TV",
    emoji: "🟢",
    searchQuery: "xoilac tv trực tiếp bóng đá",
  },
];

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Trích xuất domain gốc từ URL
function getRootUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return null;
  }
}

// Loại bỏ các domain không liên quan (Google, Facebook, Youtube...)
const BLACKLIST_DOMAINS = [
  "google.", "youtube.", "facebook.", "twitter.", "instagram.",
  "wikipedia.", "tiktok.", "reddit.", "w3.", "mozilla.", "microsoft.",
  "apple.", "amazon.", "shopee.", "lazada.", "zalo.", "t.me", "telegram.",
  "pinterest.", "linkedin.", "github.", "stackoverflow.", "cloudflare.",
  "doubleclick.", "googletagmanager.", "schema.org", "gstatic.",
];

function isBlacklisted(url) {
  return BLACKLIST_DOMAINS.some((d) => url.includes(d));
}

// Tìm URL qua Google (ưu tiên) hoặc DuckDuckGo (fallback)
async function searchLinks(site) {
  const query = encodeURIComponent(site.searchQuery);
  const GOOGLE_URL = `https://www.google.com/search?q=${query}&hl=vi&gl=vn`;
  const DDG_URL = "https://html.duckduckgo.com/html/";

  // Thử Google trước
  try {
    const res = await uFetch(GOOGLE_URL, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const html = await res.text();
      const found = [];
      const seen = new Set();
      
      // Google redirect pattern
      const pattern = /href="\/url\?q=(https?:\/\/[^&"]+)/g;
      let m;
      while ((m = pattern.exec(html)) !== null) {
        const url = decodeURIComponent(m[1]);
        if (!isBlacklisted(url)) {
          const root = getRootUrl(url);
          if (root && !seen.has(root)) {
            seen.add(root);
            found.push(root);
          }
        }
        if (found.length >= 5) break;
      }
      
      if (found.length > 0) {
        console.log(`[BongDa] Google tìm thấy ${found.length} ứng viên cho ${site.keyword}`);
        return found;
      }
    }
  } catch (err) {
    console.warn(`[BongDa] Google Search failed, falling back to DDG...`);
  }

  // Fallback sang DuckDuckGo nếu Google bị chặn
  try {
    const res = await uFetch(DDG_URL, {
      method: "POST",
      headers: {
        "User-Agent": BROWSER_UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `q=${query}&b=&kl=vn-vi`,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];

    const html = await res.text();
    const found = [];
    const seen = new Set();
    const pattern = /href="(https?:\/\/[^"]+)"/g;
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const url = m[1];
      if (!isBlacklisted(url) && !url.includes("duckduckgo")) {
        const root = getRootUrl(url);
        if (root && !seen.has(root)) {
          seen.add(root);
          found.push(root);
        }
      }
      if (found.length >= 5) break;
    }
    return found;
  } catch (err) {
    console.error(`[BongDa] Lỗi search cho ${site.keyword}:`, err.message);
    return [];
  }
}

// Kiểm tra xem một URL có kết nối được không (timeout 6s)
async function checkLinkAlive(url) {
  try {
    const res = await uFetch(url, {
      method: "GET",
      headers: { "User-Agent": BROWSER_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

// Tìm link hoạt động cho 1 site
async function findWorkingLink(site) {
  const candidates = await searchLinks(site);
  console.log(`[BongDa] ${site.label}: tìm được ${candidates.length} ứng viên:`, candidates);

  for (const url of candidates) {
    const alive = await checkLinkAlive(url);
    console.log(`[BongDa] ${url} -> ${alive ? "✅ OK" : "❌ Dead"}`);
    if (alive) return { url, alive: true };
  }

  return { url: null, alive: false };
}

// Tìm link theo keyword tuỳ chỉnh, trả về tối đa `limit` link đang sống
async function findLinksByKeyword(keyword, limit = 2) {
  const kw = keyword.toLowerCase();
  
  let candidates = await searchLinks({
    keyword: kw,
    searchQuery: `${kw} xem bóng đá trực tiếp`,
  });

  if (candidates.length === 0) {
    candidates = await searchLinks({
      keyword: kw,
      searchQuery: kw,
    });
  }

  console.log(`[BongDa Custom] "${keyword}": ${candidates.length} ứng viên:`, candidates);

  const working = [];
  for (const url of candidates) {
    if (working.length >= limit) break;
    const alive = await checkLinkAlive(url);
    console.log(`[BongDa Custom] ${url} -> ${alive ? "✅" : "❌"}`);
    if (alive) working.push(url);
  }

  return working;
}

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

  // ── Music commands ──
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Phát nhạc từ YouTube (URL hoặc tên bài)")
    .addStringOption((option) =>
      option.setName("query").setDescription("Link YouTube hoặc tên bài hát").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Bỏ qua bài nhạc hiện tại"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Dừng nhạc và xóa hàng chờ"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Xem danh sách hàng chờ nhạc"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Tạm dừng nhạc"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Tiếp tục phát nhạc"),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Xem bài nhạc đang phát"),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Bật/tắt chế độ lặp bài hiện tại"),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Chỉnh âm lượng (0–100)")
    .addIntegerOption((option) =>
      option.setName("level").setDescription("Mức âm lượng từ 0 đến 100").setRequired(true)
        .setMinValue(0).setMaxValue(100),
    ),

  new SlashCommandBuilder()
    .setName("getlinkbongda")
    .setDescription("Tìm link xem bóng đá trực tiếp (Rakhoi, Cakhia, Xoilac) đang hoạt động")
    .addStringOption((option) =>
      option
        .setName("keyword")
        .setDescription("Keyword tuỳ chỉnh để tìm link (VD: bongdalu, vebo, 90phut...) — trả về 2 link SEO đầu tiên")
        .setRequired(false),
    ),
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

// Hàm tạo TTS audio buffer
async function createTTSAudio(text) {
  try {
    const audioUrl = await googleTTS(text, "vi", 1);
    // Tải xuống trực tiếp để tránh ffmpeg treo khi stream qua mạng
    const { body } = await request(audioUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const arrayBuffer = await body.arrayBuffer();
    return Buffer.from(arrayBuffer);
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
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log("Voice connection ready!");
  } catch (error) {
    console.error("Connection timeout:", error);
  }

  connections.set(guildId, connection);
  return connection;
}

// Hàm phát audio trong voice channel
async function playTTS(connection, audioBuffer) {
  try {
    console.log("Đang phát TTS...");

    // Đảm bảo connection ready trước khi phát
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log("Connection ready, bắt đầu phát audio");

    // Tạo player
    const player = createAudioPlayer();

    // Subscribe player vào connection
    const subscription = connection.subscribe(player);
    console.log("Subscribed:", !!subscription);

    // Tạo audio resource từ Buffer stream thay vì URL để tránh kẹt Ffmpeg
    const stream = Readable.from(audioBuffer);
    const resource = createAudioResource(stream, {
      inlineVolume: true,
    });
    console.log("Created resource from downloaded buffer");

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

// Helper: defer an interaction safely (chống lỗi "already acknowledged")
async function safeDefer(interaction, options = {}) {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferReply(options);
  } catch (e) {
    console.error("safeDefer failed:", e.message);
  }
}

// Helper: editReply an interaction safely
async function safeEdit(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(content);
    }
    return await interaction.reply(content);
  } catch (e) {
    console.error("safeEdit failed:", e.message);
  }
}

// Xử lý slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "speak") {
    await safeDefer(interaction);

    const text = interaction.options.getString("text");
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    // Kiểm tra user có trong voice channel không
    if (!voiceChannel) {
      return safeEdit(interaction, "Bạn cần ở trong một voice channel!");
    }

    try {
      let connection = connections.get(interaction.guild.id);
      if (!connection || connection.joinConfig.channelId !== voiceChannel.id) {
        connection = await joinChannel(
          voiceChannel,
          interaction.guild.id,
          interaction.guild.voiceAdapterCreator,
        );
      }

      const audioUrl = await createTTSAudio(text);
      await safeEdit(interaction, `🔊 Đang đọc: "${text}"`);
      playTTS(connection, audioUrl).catch((err) => {
        console.error("Lỗi phát TTS:", err);
      });
    } catch (error) {
      console.error("Lỗi khi đọc text:", error);
      await safeEdit(interaction, "Không thể đọc text!");
    }

  } else if (commandName === "leave") {
    await safeDefer(interaction);

    const connection = connections.get(interaction.guild.id);

    if (!connection) {
      return safeEdit(interaction, "Bot không ở trong voice channel nào!");
    }

    try {
      connection.destroy();
      connections.delete(interaction.guild.id);
      await safeEdit(interaction, "Đã rời khỏi voice channel!");
    } catch (error) {
      console.error("Lỗi khi rời voice channel:", error);
      await safeEdit(interaction, "Không thể rời voice channel!");
    }

  // ================================================================
  // MUSIC COMMANDS
  // ================================================================

  } else if (commandName === "play") {
    await safeDefer(interaction);

    const query = interaction.options.getString("query");
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return safeEdit(interaction, "❌ Bạn cần vào một **voice channel** trước!");
    }

    const guildId = interaction.guild.id;
    let queue = getQueue(guildId);

    // Tạo queue & kết nối nếu chưa có
    if (!queue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      const player = createAudioPlayer();
      connection.subscribe(player);

      player.on(AudioPlayerStatus.Idle, () => advanceQueue(guildId));
      player.on("error", (err) => {
        console.error("Music player error:", err);
        advanceQueue(guildId);
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        connection.destroy();
        return safeEdit(interaction, "❌ Không thể kết nối voice channel!");
      }

      queue = { connection, player, songs: [], currentSong: null, textChannel: interaction.channel, loop: false };
      musicQueues.set(guildId, queue);
    } else {
      queue.textChannel = interaction.channel;
    }

    try {
      let songInfo;

      const isYtUrl = playdl.yt_validate(query) === "video";
      const isYtPlaylist = playdl.yt_validate(query) === "playlist";

      if (isYtPlaylist) {
        const playlist = await playdl.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();
        const added = [];
        for (const vid of videos.slice(0, 50)) {
          queue.songs.push({
            title: vid.title,
            url: vid.url,
            durationSec: vid.durationInSec,
            thumbnail: vid.thumbnails?.[0]?.url ?? null,
            requestedBy: member.user.tag,
          });
          added.push(vid.title);
        }
        if (!queue.currentSong && queue.songs.length > 0) {
          const first = queue.songs.shift();
          playSong(guildId, first);
        }
        return safeEdit(interaction, `✅ Đã thêm **${added.length}** bài từ playlist **${playlist.title}** vào hàng chờ!`);
      } else if (isYtUrl) {
        const info = await playdl.video_info(query);
        const vid = info.video_details;
        songInfo = {
          title: vid.title,
          url: vid.url || `https://www.youtube.com/watch?v=${vid.id}`,
          durationSec: vid.durationInSec,
          thumbnail: vid.thumbnails?.[0]?.url ?? null,
          requestedBy: member.user.tag,
        };
      } else {
        const results = await playdl.search(query, { limit: 1 });
        if (!results.length) return safeEdit(interaction, "❌ Không tìm thấy bài hát!");
        const vid = results[0];
        songInfo = {
          title: vid.title,
          url: vid.url,
          durationSec: vid.durationInSec,
          thumbnail: vid.thumbnails?.[0]?.url ?? null,
          requestedBy: member.user.tag,
        };
      }

      queue.songs.push(songInfo);

      if (!queue.currentSong) {
        const next = queue.songs.shift();
        playSong(guildId, next);
        await safeEdit(interaction, `▶️ Bắt đầu phát: **${songInfo.title}**`);
      } else {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("➕ Đã thêm vào hàng chờ")
          .setDescription(`**[${songInfo.title}](${songInfo.url})**`)
          .addFields(
            { name: "Thời lượng", value: formatDuration(songInfo.durationSec), inline: true },
            { name: "Vị trí", value: `#${queue.songs.length}`, inline: true },
          )
          .setThumbnail(songInfo.thumbnail);
        await safeEdit(interaction, { embeds: [embed] });
      }
    } catch (err) {
      console.error("Lỗi play:", err);
      await safeEdit(interaction, "❌ Không thể phát bài hát này. Vui lòng thử lại!");
    }

  } else if (commandName === "skip") {
    await safeDefer(interaction);
    const queue = getQueue(interaction.guild.id);
    if (!queue || !queue.currentSong) return safeEdit(interaction, "❌ Không có bài nào đang phát!");
    const skipped = queue.currentSong.title;
    queue.player.stop();
    await safeEdit(interaction, `⏭️ Đã bỏ qua: **${skipped}**`);

  } else if (commandName === "stop") {
    await safeDefer(interaction);
    const queue = getQueue(interaction.guild.id);
    if (!queue) return safeEdit(interaction, "❌ Không có nhạc đang phát!");
    queue.songs = [];
    queue.currentSong = null;
    queue.player.stop();
    queue.connection.destroy();
    musicQueues.delete(interaction.guild.id);
    await safeEdit(interaction, "⏹️ Đã dừng nhạc và xóa hàng chờ!");

  } else if (commandName === "queue") {
    await safeDefer(interaction);
    const queue = getQueue(interaction.guild.id);
    if (!queue || (!queue.currentSong && queue.songs.length === 0)) {
      return safeEdit(interaction, "❌ Hàng chờ trống!");
    }
    const lines = [];
    if (queue.currentSong) {
      lines.push(`**▶️ Đang phát:** [${queue.currentSong.title}](${queue.currentSong.url}) \`${formatDuration(queue.currentSong.durationSec)}\``);
    }
    if (queue.songs.length > 0) {
      lines.push("\n**📋 Hàng chờ:**");
      queue.songs.slice(0, 10).forEach((s, i) => {
        lines.push(`\`${i + 1}.\` [${s.title}](${s.url}) \`${formatDuration(s.durationSec)}\` — ${s.requestedBy}`);
      });
      if (queue.songs.length > 10) lines.push(`\n*... và ${queue.songs.length - 10} bài nữa*`);
    }
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎶 Hàng chờ nhạc")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `${queue.songs.length} bài trong hàng chờ${queue.loop ? " • 🔁 Loop bật" : ""}` });
    await safeEdit(interaction, { embeds: [embed] });

  } else if (commandName === "pause") {
    await safeDefer(interaction);
    const queue = getQueue(interaction.guild.id);
    if (!queue || !queue.currentSong) return safeEdit(interaction, "❌ Không có bài nào đang phát!");
    if (queue.player.state.status === AudioPlayerStatus.Paused) {
      return safeEdit(interaction, "⏸️ Nhạc đã đang tạm dừng rồi!");
    }
    queue.player.pause();
    await safeEdit(interaction, "⏸️ Đã tạm dừng nhạc!");

  } else if (commandName === "resume") {
    await safeDefer(interaction);
    const queue = getQueue(interaction.guild.id);
    if (!queue) return safeEdit(interaction, "❌ Không có nhạc nào trong hàng chờ!");
    if (queue.player.state.status !== AudioPlayerStatus.Paused) {
      return safeEdit(interaction, "▶️ Nhạc đang phát bình thường rồi!");
    }
    queue.player.unpause();
    await safeEdit(interaction, "▶️ Tiếp tục phát nhạc!");

  } else if (commandName === "nowplaying") {
    await safeDefer(interaction);
    const queue = getQueue(interaction.guild.id);
    if (!queue || !queue.currentSong) return safeEdit(interaction, "❌ Không có bài nào đang phát!");
    const song = queue.currentSong;
    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle("🎵 Đang phát")
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: "Thời lượng", value: formatDuration(song.durationSec), inline: true },
        { name: "Yêu cầu bởi", value: song.requestedBy, inline: true },
        { name: "Trạng thái", value: queue.player.state.status === AudioPlayerStatus.Paused ? "⏸️ Tạm dừng" : "▶️ Đang phát", inline: true },
      )
      .setThumbnail(song.thumbnail);
    await safeEdit(interaction, { embeds: [embed] });

  } else if (commandName === "loop") {
    await safeDefer(interaction);
    const queue = getQueue(interaction.guild.id);
    if (!queue) return safeEdit(interaction, "❌ Không có nhạc đang phát!");
    queue.loop = !queue.loop;
    await safeEdit(interaction, queue.loop ? "🔁 Đã bật chế độ **lặp bài**!" : "➡️ Đã tắt chế độ lặp!");

  } else if (commandName === "volume") {
    await safeDefer(interaction);
    const queue = getQueue(interaction.guild.id);
    if (!queue || !queue.currentSong) return safeEdit(interaction, "❌ Không có bài nào đang phát!");
    const level = interaction.options.getInteger("level");
    const resource = queue.player.state.resource;
    if (resource?.volume) {
      resource.volume.setVolume(level / 100);
      await safeEdit(interaction, `🔊 Âm lượng đã được đặt thành **${level}%**`);
    } else {
      await safeEdit(interaction, "❌ Không thể điều chỉnh âm lượng lúc này!");
    }

  // ================================================================
  // BONG DA LINK COMMAND
  // ================================================================

  } else if (commandName === "getlinkbongda") {
    await safeDefer(interaction);

    const customKeyword = interaction.options.getString("keyword");

    // ── Chế độ keyword tuỳ chỉnh ──────────────────────────────────
    if (customKeyword) {
      await safeEdit(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle("🔍 Đang tìm link theo keyword...")
            .setDescription(`Keyword: **${customKeyword}**\nĐang search và kiểm tra kết nối, vui lòng đợi...`)
            .setFooter({ text: "Có thể mất 10–20 giây..." }),
        ],
      });

      const links = await findLinksByKeyword(customKeyword, 2);

      let description;
      if (links.length === 0) {
        description = `❌ Không tìm thấy link nào hoạt động cho keyword **"${customKeyword}"**`;
      } else {
        description = links.map((url, i) => `\`${i + 1}.\` ✅ ${url}`).join("\n");
      }

      const embed = new EmbedBuilder()
        .setColor(links.length > 0 ? 0x00c853 : 0xf44336)
        .setTitle(`⚽ Kết quả tìm kiếm: "${customKeyword}"`)
        .setDescription(description)
        .addFields({
          name: "Tổng",
          value: `Tìm thấy **${links.length}/2** link đang hoạt động`,
          inline: false,
        })
        .setFooter({ text: `🕐 <t:${Math.floor(Date.now() / 1000)}:T> • Dùng /getlinkbongda để tìm lại` });

      return safeEdit(interaction, { embeds: [embed] });
    }

    // ── Chế độ mặc định: Rakhoi + Cakhia + Xoilac ─────────────────
    await safeEdit(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor(0xffa500)
          .setTitle("⚽ Đang tìm link bóng đá...")
          .setDescription(
            "🔍 Đang tìm kiếm và kiểm tra kết nối cho:\n" +
            BONGDA_SITES.map((s) => `${s.emoji} **${s.label}**`).join("\n"),
          )
          .setFooter({ text: "Quá trình này có thể mất 10–30 giây..." }),
      ],
    });

    const results = await Promise.all(
      BONGDA_SITES.map(async (site) => {
        const { url, alive } = await findWorkingLink(site);
        return { site, url, alive };
      }),
    );

    const fields = results.map(({ site, url, alive }) => {
      if (alive && url) {
        return {
          name: `${site.emoji} ${site.label}`,
          value: `✅ **Hoạt động**\n🔗 ${url}`,
          inline: false,
        };
      } else {
        return {
          name: `${site.emoji} ${site.label}`,
          value: "❌ **Không tìm thấy link hoạt động**",
          inline: false,
        };
      }
    });

    const workingCount = results.filter((r) => r.alive).length;
    const embedColor = workingCount === 3 ? 0x00c853 : workingCount > 0 ? 0xffa500 : 0xf44336;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle("⚽ Link Xem Bóng Đá Trực Tiếp")
      .setDescription(
        `Tìm thấy **${workingCount}/3** link đang hoạt động\n` +
        `🕐 Cập nhật lúc: <t:${Math.floor(Date.now() / 1000)}:T>`,
      )
      .addFields(fields)
      .setFooter({ text: "Lưu ý: Link có thể thay đổi bất kỳ lúc nào • Dùng /getlinkbongda để cập nhật" });

    await safeEdit(interaction, { embeds: [embed] });
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
