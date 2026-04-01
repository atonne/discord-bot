# Discord Bot Commands

## Slash Commands

| Command | Description |
|---------|-------------|
| `/join` | Bot join vao voice channel cua ban |
| `/leave` | Bot roi khoi voice channel |
| `/speak <text>` | Doc text tieng Viet bang Google TTS |
| `/play <url>` | Phat nhac tu YouTube |
| `/stop` | Dung nhac va xoa queue |
| `/skip` | Bo qua bai hat hien tai |
| `/queue` | Xem danh sach nhac dang cho |

## Prefix Commands

Prefix: `p!`

| Command | Description |
|---------|-------------|
| `p!play <url>` | Phat nhac tu YouTube |
| `p!stop` | Dung nhac va xoa queue |
| `p!skip` | Bo qua bai hat hien tai |
| `p!queue` | Xem danh sach nhac dang cho |

## TTS (Text-to-Speech)

Bot doc text tieng Viet khi:
- Mention bot + text: `@Bot xin chao moi nguoi`
- Keyword "bot doc": `bot doc xin chao moi nguoi`

## Usage Flow

1. `/join` - Bot join voice channel truoc
2. `/speak <text>` hoac `/play <url>` - Su dung cac lenh
3. `/leave` - Bot roi voice channel khi xong

## Notes

- Bot can join voice channel truoc khi co the doc text hoac phat nhac
- Queue system tu dong phat bai tiep theo
- Google TTS co gioi han do dai text
- Mot so video YouTube co the bi han che phat
