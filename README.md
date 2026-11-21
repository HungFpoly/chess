# Nước Hay — ứng dụng luyện cờ vua

Web app luyện chiến thuật cờ vua bằng các puzzle mở của Lichess. Bản đi kèm có một shard mẫu để chạy ngay; script nhập dữ liệu có thể tự tải, lọc và chia nhỏ toàn bộ kho Lichess.

## Chạy local

```bash
npm install
npm run dev
```

## Nhập 100.000 puzzle chất lượng cao

Yêu cầu Node.js 22.15 trở lên vì script dùng bộ giải nén Zstandard dạng streaming có sẵn trong Node.

```bash
npm run import:puzzles -- --limit=100000
```

Script tự thực hiện các bước:

1. Tải `lichess_db_puzzle.csv.zst` từ Lichess nếu máy chưa có.
2. Giải nén theo luồng, không giữ toàn bộ file trong RAM.
3. Lọc theo rating, popularity, số lượt chơi và kiểm tra chuỗi nước đi.
4. Tạo các shard JSON nhỏ trong `public/puzzles`.
5. Thay kho cũ sau khi toàn bộ quá trình hoàn tất thành công.

Nhập toàn bộ kho:

```bash
npm run import:puzzles -- --all
```

Điều chỉnh bộ lọc:

```bash
npm run import:puzzles -- --limit=100000 --min-popularity=70 --min-plays=100 --min-rating=600 --max-rating=2800 --shard-size=500
```

Nếu đã tải file `.zst` thủ công, có thể bỏ qua bước tải:

```bash
npm run import:puzzles -- --source="D:\data\lichess_db_puzzle.csv.zst"
```

## Kiểm tra và build

```bash
npm test
npm run build
```

Dữ liệu puzzle: [Lichess Open Database](https://database.lichess.org/#puzzles), giấy phép CC0.
