const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const googleTTS = require('google-tts-api');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Khởi tạo Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// Lưu trữ audio players cho mỗi guild
const audioPlayers = new Map();

// Lưu trữ music queues cho mỗi guild
const musicQueues = new Map();

// Commands
const commands = [
    new SlashCommandBuilder()
        .setName('join')
        .setDescription('Bot sẽ join vào voice channel của bạn'),
    
    new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Bot sẽ rời khỏi voice channel'),
    
    new SlashCommandBuilder()
        .setName('speak')
        .setDescription('Bot sẽ đọc text tiếng Việt')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('Text cần đọc')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Phát nhạc từ YouTube')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('Link YouTube hoặc từ khóa tìm kiếm')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Dừng nhạc và xóa queue'),
    
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Bỏ qua bài hát hiện tại'),
    
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Xem danh sách nhạc đang chờ')
];

// Đăng ký commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Đang đăng ký slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('Đăng ký slash commands thành công!');
    } catch (error) {
        console.error('Lỗi khi đăng ký commands:', error);
    }
})();

// Hàm tạo TTS audio
async function createTTSAudio(text) {
    try {
        // Sử dụng Google TTS với tiếng Việt
        const audioUrl = await googleTTS(text, 'vi', 1);
        
        return audioUrl;
    } catch (error) {
        console.error('Lỗi khi tạo TTS:', error);
        throw error;
    }
}

// Hàm phát audio trong voice channel
async function playAudio(connection, audioUrl) {
    try {
        const player = createAudioPlayer();
        const resource = createAudioResource(audioUrl);
        
        player.play(resource);
        connection.subscribe(player);
        
        return new Promise((resolve, reject) => {
            player.on(VoiceConnectionStatus.Ready, () => {
                console.log('Bắt đầu phát audio');
            });
            
            player.on('error', error => {
                console.error('Lỗi khi phát audio:', error);
                reject(error);
            });
            
            player.on('stateChange', (oldState, newState) => {
                if (newState.status === 'idle') {
                    console.log('Hoàn thành phát audio');
                    resolve();
                }
            });
        });
    } catch (error) {
        console.error('Lỗi khi phát audio:', error);
        throw error;
    }
}

// Hàm phát nhạc YouTube
async function playYouTubeMusic(connection, url, guildId) {
    try {
        // Kiểm tra URL có phải YouTube không
        if (!ytdl.validateURL(url)) {
            throw new Error('URL YouTube không hợp lệ');
        }
        
        // Lấy thông tin video
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title;
        const duration = info.videoDetails.lengthSeconds;
        
        // Tạo audio stream
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25
        });
        
        const player = createAudioPlayer();
        const resource = createAudioResource(stream);
        
        player.play(resource);
        connection.subscribe(player);
        
        return new Promise((resolve, reject) => {
            player.on('error', error => {
                console.error('Lỗi khi phát nhạc:', error);
                reject(error);
            });
            
            player.on('stateChange', (oldState, newState) => {
                if (newState.status === 'idle') {
                    console.log('Hoàn thành phát nhạc:', title);
                    // Phát bài tiếp theo trong queue
                    playNextInQueue(guildId);
                    resolve();
                }
            });
        });
    } catch (error) {
        console.error('Lỗi khi phát nhạc YouTube:', error);
        throw error;
    }
}

// Hàm phát bài tiếp theo trong queue
async function playNextInQueue(guildId) {
    const queue = musicQueues.get(guildId);
    if (!queue || queue.length === 0) {
        return;
    }
    
    const nextSong = queue.shift();
    const connection = audioPlayers.get(guildId);
    
    if (connection) {
        try {
            await playYouTubeMusic(connection, nextSong.url, guildId);
        } catch (error) {
            console.error('Lỗi khi phát bài tiếp theo:', error);
            // Thử phát bài tiếp theo
            playNextInQueue(guildId);
        }
    }
}

// Hàm thêm bài hát vào queue
function addToQueue(guildId, url, title) {
    if (!musicQueues.has(guildId)) {
        musicQueues.set(guildId, []);
    }
    
    const queue = musicQueues.get(guildId);
    queue.push({ url, title });
    
    return queue.length;
}

// Event khi bot sẵn sàng
client.once(Events.ClientReady, () => {
    console.log(`Bot đã sẵn sàng! Đăng nhập với tên: ${client.user.tag}`);
});

// Xử lý slash commands
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'join') {
        await interaction.deferReply();
        
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        
        if (!voiceChannel) {
            return interaction.editReply('Bạn cần ở trong một voice channel!');
        }
        
        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });
            
            // Lưu connection
            audioPlayers.set(interaction.guild.id, connection);
            
            await interaction.editReply(`Đã join vào ${voiceChannel.name}!`);
        } catch (error) {
            console.error('Lỗi khi join voice channel:', error);
            await interaction.editReply('Không thể join voice channel!');
        }
    }
    
    else if (commandName === 'leave') {
        await interaction.deferReply();
        
        const connection = audioPlayers.get(interaction.guild.id);
        
        if (!connection) {
            return interaction.editReply('Bot không ở trong voice channel nào!');
        }
        
        try {
            connection.destroy();
            audioPlayers.delete(interaction.guild.id);
            await interaction.editReply('Đã rời khỏi voice channel!');
        } catch (error) {
            console.error('Lỗi khi rời voice channel:', error);
            await interaction.editReply('Không thể rời voice channel!');
        }
    }
    
    else if (commandName === 'speak') {
        await interaction.deferReply();
        
        const text = interaction.options.getString('text');
        const connection = audioPlayers.get(interaction.guild.id);
        
        if (!connection) {
            return interaction.editReply('Bot cần join voice channel trước! Sử dụng `/join`');
        }
        
        try {
            // Tạo TTS audio
            const audioUrl = await createTTSAudio(text);
            
            // Phát audio
            await playAudio(connection, audioUrl);
            
            await interaction.editReply(`Đã đọc: "${text}"`);
        } catch (error) {
            console.error('Lỗi khi đọc text:', error);
            await interaction.editReply('Không thể đọc text!');
        }
    }
    
    else if (commandName === 'play') {
        await interaction.deferReply();
        
        const url = interaction.options.getString('url');
        const connection = audioPlayers.get(interaction.guild.id);
        
        if (!connection) {
            return interaction.editReply('Bot cần join voice channel trước! Sử dụng `/join`');
        }
        
        try {
            // Kiểm tra URL có phải YouTube không
            if (!ytdl.validateURL(url)) {
                return interaction.editReply('URL YouTube không hợp lệ!');
            }
            
            // Lấy thông tin video
            const info = await ytdl.getInfo(url);
            const title = info.videoDetails.title;
            const duration = info.videoDetails.lengthSeconds;
            
            // Thêm vào queue
            const queuePosition = addToQueue(interaction.guild.id, url, title);
            
            if (queuePosition === 1) {
                // Phát ngay lập tức nếu là bài đầu tiên
                await playYouTubeMusic(connection, url, interaction.guild.id);
                await interaction.editReply(`🎵 Đang phát: **${title}**`);
            } else {
                await interaction.editReply(`🎵 Đã thêm vào queue (vị trí ${queuePosition}): **${title}**`);
            }
        } catch (error) {
            console.error('Lỗi khi phát nhạc:', error);
            await interaction.editReply('Không thể phát nhạc! Kiểm tra URL hoặc thử lại.');
        }
    }
    
    else if (commandName === 'stop') {
        await interaction.deferReply();
        
        const connection = audioPlayers.get(interaction.guild.id);
        
        if (!connection) {
            return interaction.editReply('Bot không ở trong voice channel nào!');
        }
        
        try {
            // Dừng player hiện tại
            connection.destroy();
            audioPlayers.delete(interaction.guild.id);
            
            // Xóa queue
            musicQueues.delete(interaction.guild.id);
            
            await interaction.editReply('⏹️ Đã dừng nhạc và xóa queue!');
        } catch (error) {
            console.error('Lỗi khi dừng nhạc:', error);
            await interaction.editReply('Không thể dừng nhạc!');
        }
    }
    
    else if (commandName === 'skip') {
        await interaction.deferReply();
        
        const connection = audioPlayers.get(interaction.guild.id);
        
        if (!connection) {
            return interaction.editReply('Bot không ở trong voice channel nào!');
        }
        
        try {
            // Dừng player hiện tại để phát bài tiếp theo
            connection.destroy();
            audioPlayers.delete(interaction.guild.id);
            
            // Phát bài tiếp theo trong queue
            playNextInQueue(interaction.guild.id);
            
            await interaction.editReply('⏭️ Đã bỏ qua bài hát hiện tại!');
        } catch (error) {
            console.error('Lỗi khi bỏ qua:', error);
            await interaction.editReply('Không thể bỏ qua bài hát!');
        }
    }
    
    else if (commandName === 'queue') {
        await interaction.deferReply();
        
        const queue = musicQueues.get(interaction.guild.id);
        
        if (!queue || queue.length === 0) {
            return interaction.editReply('📋 Queue trống!');
        }
        
        try {
            let queueText = '📋 **Danh sách nhạc đang chờ:**\n';
            queue.forEach((song, index) => {
                queueText += `${index + 1}. **${song.title}**\n`;
            });
            
            await interaction.editReply(queueText);
        } catch (error) {
            console.error('Lỗi khi hiển thị queue:', error);
            await interaction.editReply('Không thể hiển thị queue!');
        }
    }
});

// Xử lý tin nhắn thường (prefix commands và TTS)
client.on(Events.MessageCreate, async message => {
    // Bỏ qua tin nhắn từ bot
    if (message.author.bot) return;
    
    // Xử lý prefix commands
    if (message.content.startsWith('p!')) {
        const args = message.content.slice(2).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        
        if (command === 'play') {
            const url = args.join(' ');
            if (!url) {
                return message.reply('Vui lòng cung cấp URL YouTube! Sử dụng: `p!play <url>`');
            }
            
            const connection = audioPlayers.get(message.guild.id);
            if (!connection) {
                return message.reply('Bot cần join voice channel trước! Sử dụng `/join`');
            }
            
            try {
                // Kiểm tra URL có phải YouTube không
                if (!ytdl.validateURL(url)) {
                    return message.reply('URL YouTube không hợp lệ!');
                }
                
                // Lấy thông tin video
                const info = await ytdl.getInfo(url);
                const title = info.videoDetails.title;
                
                // Thêm vào queue
                const queuePosition = addToQueue(message.guild.id, url, title);
                
                if (queuePosition === 1) {
                    // Phát ngay lập tức nếu là bài đầu tiên
                    await playYouTubeMusic(connection, url, message.guild.id);
                    message.reply(`🎵 Đang phát: **${title}**`);
                } else {
                    message.reply(`🎵 Đã thêm vào queue (vị trí ${queuePosition}): **${title}**`);
                }
            } catch (error) {
                console.error('Lỗi khi phát nhạc:', error);
                message.reply('Không thể phát nhạc! Kiểm tra URL hoặc thử lại.');
            }
        }
        
        else if (command === 'stop') {
            const connection = audioPlayers.get(message.guild.id);
            if (!connection) {
                return message.reply('Bot không ở trong voice channel nào!');
            }
            
            try {
                // Dừng player hiện tại
                connection.destroy();
                audioPlayers.delete(message.guild.id);
                
                // Xóa queue
                musicQueues.delete(message.guild.id);
                
                message.reply('⏹️ Đã dừng nhạc và xóa queue!');
            } catch (error) {
                console.error('Lỗi khi dừng nhạc:', error);
                message.reply('Không thể dừng nhạc!');
            }
        }
        
        else if (command === 'skip') {
            const connection = audioPlayers.get(message.guild.id);
            if (!connection) {
                return message.reply('Bot không ở trong voice channel nào!');
            }
            
            try {
                // Dừng player hiện tại để phát bài tiếp theo
                connection.destroy();
                audioPlayers.delete(message.guild.id);
                
                // Phát bài tiếp theo trong queue
                playNextInQueue(message.guild.id);
                
                message.reply('⏭️ Đã bỏ qua bài hát hiện tại!');
            } catch (error) {
                console.error('Lỗi khi bỏ qua:', error);
                message.reply('Không thể bỏ qua bài hát!');
            }
        }
        
        else if (command === 'queue') {
            const queue = musicQueues.get(message.guild.id);
            if (!queue || queue.length === 0) {
                return message.reply('📋 Queue trống!');
            }
            
            try {
                let queueText = '📋 **Danh sách nhạc đang chờ:**\n';
                queue.forEach((song, index) => {
                    queueText += `${index + 1}. **${song.title}**\n`;
                });
                
                message.reply(queueText);
            } catch (error) {
                console.error('Lỗi khi hiển thị queue:', error);
                message.reply('Không thể hiển thị queue!');
            }
        }
        
        return; // Không xử lý TTS nếu là prefix command
    }
    
    // Xử lý TTS (chỉ khi không phải prefix command)
    if (message.mentions.has(client.user) || message.content.toLowerCase().includes('bot đọc')) {
        const connection = audioPlayers.get(message.guild.id);
        
        if (!connection) {
            return message.reply('Bot cần join voice channel trước! Sử dụng `/join`');
        }
        
        // Lấy text cần đọc (bỏ mention và từ khóa)
        let textToRead = message.content
            .replace(/<@!?\d+>/g, '') // Bỏ mention
            .replace(/bot đọc/gi, '') // Bỏ từ khóa "bot đọc"
            .trim();
        
        if (!textToRead) {
            return message.reply('Vui lòng cung cấp text cần đọc!');
        }
        
        try {
            // Tạo TTS audio
            const audioUrl = await createTTSAudio(textToRead);
            
            // Phát audio
            await playAudio(connection, audioUrl);
            
            message.react('✅');
        } catch (error) {
            console.error('Lỗi khi đọc text:', error);
            message.reply('Không thể đọc text!');
        }
    }
});

// Xử lý lỗi
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Đăng nhập bot
client.login(process.env.DISCORD_TOKEN);

