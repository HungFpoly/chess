import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Chess } from "chess.js";
import { parseCliArgs, parseCsvLine } from "../scripts/lib/csv.mjs";

test("parseCsvLine đọc được giá trị có dấu phẩy và dấu ngoặc kép", () => {
  assert.deepEqual(parseCsvLine('a,"b,c","d""e"'), ["a", "b,c", 'd"e']);
});

test("parseCliArgs dùng 100.000 bài theo mặc định", () => {
  const options = parseCliArgs([]);
  assert.equal(options.limit, 100_000);
  assert.equal(options.shardSize, 500);
});

test("parseCliArgs hỗ trợ nhập toàn bộ kho", () => {
  const options = parseCliArgs(["--all", "--min-popularity=80"]);
  assert.equal(options.limit, Number.POSITIVE_INFINITY);
  assert.equal(options.minPopularity, 80);
});

test("mọi puzzle mẫu có FEN và chuỗi nước đi hợp lệ", async () => {
  const raw = await readFile(new URL("../public/puzzles/shard-00000.json", import.meta.url), "utf8");
  const puzzles = JSON.parse(raw);
  assert.ok(puzzles.length > 0);
  for (const puzzle of puzzles) {
    const game = new Chess(puzzle.fen);
    for (const uci of puzzle.moves) {
      assert.doesNotThrow(() =>
        game.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci[4] || undefined,
        }),
      );
    }
  }
});
