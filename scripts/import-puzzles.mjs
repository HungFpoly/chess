import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createZstdDecompress } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";
import { parseCliArgs, parseCsvLine } from "./lib/csv.mjs";

const SOURCE_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const projectRoot = resolve(import.meta.dirname, "..");
const rawDirectory = join(projectRoot, "data", "raw");
const defaultSource = join(rawDirectory, "lichess_db_puzzle.csv.zst");
const outputDirectory = join(projectRoot, "public", "puzzles");

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadSource(destination) {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.download`;
  await rm(temporary, { force: true });
  console.log(`Đang tải dữ liệu từ ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Tải dữ liệu thất bại: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length") || 0);
  let received = 0;
  let lastReported = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received - lastReported >= 25 * 1024 * 1024) {
        lastReported = received;
        const suffix = total ? ` / ${formatBytes(total)} (${Math.round((received / total) * 100)}%)` : "";
        console.log(`  ${formatBytes(received)}${suffix}`);
      }
      callback(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(temporary));
  await rename(temporary, destination);
  console.log(`Đã tải xong ${formatBytes(received)}.`);
}

function rowToPuzzle(values, columns) {
  const get = (name) => values[columns.get(name)] ?? "";
  return {
    id: get("PuzzleId"),
    fen: get("FEN"),
    moves: get("Moves").trim().split(/\s+/).filter(Boolean),
    rating: Number(get("Rating")),
    popularity: Number(get("Popularity")),
    plays: Number(get("NbPlays")),
    themes: get("Themes").trim().split(/\s+/).filter(Boolean),
    gameUrl: get("GameUrl") || undefined,
    openingTags: get("OpeningTags").trim().split(/\s+/).filter(Boolean),
  };
}

function isQualityPuzzle(puzzle, options) {
  return (
    puzzle.id &&
    puzzle.moves.length >= 2 &&
    puzzle.moves.every((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) &&
    puzzle.popularity >= options.minPopularity &&
    puzzle.plays >= options.minPlays &&
    puzzle.rating >= options.minRating &&
    puzzle.rating <= options.maxRating
  );
}

function hasValidLine(puzzle) {
  try {
    const game = new Chess(puzzle.fen);
    for (const uci of puzzle.moves) {
      game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    }
    return true;
  } catch {
    return false;
  }
}

async function writeShard(stagingDirectory, puzzles, index, shardMetadata) {
  const file = `shard-${String(index).padStart(5, "0")}.json`;
  await writeFile(join(stagingDirectory, file), `${JSON.stringify(puzzles)}\n`, "utf8");
  shardMetadata.push({
    file,
    count: puzzles.length,
    minRating: Math.min(...puzzles.map((puzzle) => puzzle.rating)),
    maxRating: Math.max(...puzzles.map((puzzle) => puzzle.rating)),
    themes: [...new Set(puzzles.flatMap((puzzle) => puzzle.themes))].sort(),
  });
}

async function replaceOutput(stagingDirectory) {
  const backup = `${outputDirectory}.backup-${process.pid}`;
  await rm(backup, { recursive: true, force: true });
  if (await exists(outputDirectory)) await rename(outputDirectory, backup);
  try {
    await rename(stagingDirectory, outputDirectory);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (await exists(backup)) await rename(backup, outputDirectory);
    throw error;
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const sourcePath = options.source ? resolve(options.source) : defaultSource;
  if (!options.source && (options.refresh || !(await exists(sourcePath)))) {
    await downloadSource(sourcePath);
  }
  if (!(await exists(sourcePath))) {
    throw new Error(`Không tìm thấy file nguồn: ${sourcePath}`);
  }

  const stagingDirectory = `${outputDirectory}.staging-${process.pid}`;
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });

  console.log("Đang giải nén, lọc và chia nhỏ kho puzzle…");
  const decompressor = createZstdDecompress();
  const input = createReadStream(sourcePath).pipe(decompressor);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const shardMetadata = [];
  let columns = null;
  let accepted = 0;
  let scanned = 0;
  let shard = [];
  let shardIndex = 0;

  for await (const line of lines) {
    if (!columns) {
      columns = new Map(parseCsvLine(line).map((name, index) => [name, index]));
      continue;
    }
    scanned += 1;
    const puzzle = rowToPuzzle(parseCsvLine(line), columns);
    if (!isQualityPuzzle(puzzle, options) || !hasValidLine(puzzle)) continue;
    shard.push(puzzle);
    accepted += 1;

    if (shard.length >= options.shardSize) {
      await writeShard(stagingDirectory, shard, shardIndex, shardMetadata);
      shard = [];
      shardIndex += 1;
    }
    if (accepted % 10_000 === 0) console.log(`  Đã chọn ${accepted.toLocaleString("vi-VN")} bài…`);
    if (accepted >= options.limit) break;
  }

  if (shard.length) await writeShard(stagingDirectory, shard, shardIndex, shardMetadata);
  if (!accepted) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw new Error("Không có puzzle nào vượt qua bộ lọc; dữ liệu cũ vẫn được giữ nguyên.");
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    total: accepted,
    shardSize: options.shardSize,
    filters: {
      minPopularity: options.minPopularity,
      minPlays: options.minPlays,
      minRating: options.minRating,
      maxRating: options.maxRating,
    },
    shards: shardMetadata,
  };
  await writeFile(join(stagingDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await replaceOutput(stagingDirectory);
  console.log(`Hoàn tất: ${accepted.toLocaleString("vi-VN")} / ${scanned.toLocaleString("vi-VN")} bài được chọn.`);
  console.log(`Đã tạo ${shardMetadata.length.toLocaleString("vi-VN")} shard tại public/puzzles.`);
}

main().catch((error) => {
  console.error(`Lỗi nhập dữ liệu: ${error.message}`);
  process.exitCode = 1;
});
