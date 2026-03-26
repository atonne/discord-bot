# Discord TTS Bot - Tiếng Việt

Bot Discord sử dụng Google Text-to-Speech để đọc tiếng Việt trong voice channel.

## Tính năng

- ✅ Join/leave voice channel
- ✅ Đọc text tiếng Việt bằng Google TTS
- ✅ Phát nhạc từ YouTube
- ✅ Queue system cho nhạc
- ✅ Slash commands và tin nhắn thường
- ✅ Hỗ trợ đa server

## Cài đặt

### 1. Cài đặt dependencies

```bash
npm install
```

### 2. Tạo Discord Application

1. Truy cập [Discord Developer Portal](https://discord.com/developers/applications)
2. Tạo New Application
3. Vào tab "Bot" và tạo bot
4. Copy Bot Token
5. Vào tab "General Information" và copy Application ID

### 3. Cấu hình

1. Copy file `env.example` thành `.env`
2. Điền thông tin:

```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_application_id_here
```

### 4. Cấp quyền cho bot

Trong Discord Developer Portal:
- Bot permissions: `Send Messages`, `Use Slash Commands`, `Connect`, `Speak`
- Privileged Gateway Intents: `Message Content Intent`

### 5. Mời bot vào server

Sử dụng link sau (thay CLIENT_ID):
```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=3148800&scope=bot%20applications.commands
```

## Sử dụng

### Slash Commands

- `/join` - Bot join vào voice channel của bạn
- `/leave` - Bot rời khỏi voice channel
- `/speak <text>` - Bot đọc text tiếng Việt
- `/play <url>` - Phát nhạc từ YouTube
- `/stop` - Dừng nhạc và xóa queue
- `/skip` - Bỏ qua bài hát hiện tại
- `/queue` - Xem danh sách nhạc đang chờ

### Prefix Commands (Tin nhắn thường)

- `p!play <url>` - Phát nhạc từ YouTube
- `p!stop` - Dừng nhạc và xóa queue
- `p!skip` - Bỏ qua bài hát hiện tại
- `p!queue` - Xem danh sách nhạc đang chờ

### Tin nhắn thường (TTS)

- Mention bot + text: `@Bot xin chào mọi người`
- Hoặc: `bot đọc xin chào mọi người`

## Chạy bot

```bash
# Chạy bình thường
npm start

# Chạy với auto-reload (development)
npm run dev
```

## Lưu ý

- Bot cần join voice channel trước khi có thể đọc text hoặc phát nhạc
- Sử dụng Google TTS API (miễn phí)
- Hỗ trợ tiếng Việt hoàn toàn
- Có thể chạy trên nhiều server cùng lúc
- YouTube music sử dụng ytdl-core
- Queue system tự động phát bài tiếp theo

## Troubleshooting

### Bot không join được voice channel
- Kiểm tra quyền của bot trong server
- Đảm bảo bot có quyền `Connect` và `Speak`

### Không nghe được giọng đọc
- Kiểm tra volume của voice channel
- Đảm bảo bot đã join voice channel
- Kiểm tra kết nối internet

### Lỗi TTS
- Google TTS có giới hạn độ dài text
- Thử text ngắn hơn nếu gặp lỗi

### Lỗi YouTube Music
- Kiểm tra URL YouTube có hợp lệ không
- Một số video có thể bị hạn chế phát
- Thử video khác nếu gặp lỗi

