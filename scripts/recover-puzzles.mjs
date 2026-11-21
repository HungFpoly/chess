import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const publicDirectory = join(projectRoot, "public");
const activeDirectory = join(publicDirectory, "puzzles");
const backupRoot = join(projectRoot, "data", "backups");

function parseArgs(argv) {
  let from = null;
  let limit = null;
  for (const arg of argv) {
    if (arg.startsWith("--from=")) from = arg.slice("--from=".length);
    else if (arg.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length));
    else throw new Error(`Tham số không được hỗ trợ: ${arg}`);
  }
  if (!from) throw new Error("Thiếu --from=<thư mục staging>.");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit phải là số nguyên lớn hơn 0.");
  return { from, limit };
}

function assertSafeStaging(sourceDirectory) {
  const pathFromPublic = relative(publicDirectory, sourceDirectory);
  if (
    pathFromPublic.startsWith("..") ||
    pathFromPublic.includes("/") ||
    pathFromPublic.includes("\\") ||
    !basename(sourceDirectory).startsWith("puzzles.staging-")
  ) {
    throw new Error("Chỉ được khôi phục từ public/puzzles.staging-* trong project này.");
  }
}

function shardInfo(file, puzzles) {
  return {
    file,
    count: puzzles.length,
    minRating: Math.min(...puzzles.map((puzzle) => puzzle.rating)),
    maxRating: Math.max(...puzzles.map((puzzle) => puzzle.rating)),
    themes: [...new Set(puzzles.flatMap((puzzle) => puzzle.themes))].sort(),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceDirectory = resolve(projectRoot, options.from);
  assertSafeStaging(sourceDirectory);

  const files = (await readdir(sourceDirectory))
    .filter((file) => /^shard-\d+\.json$/.test(file))
    .sort();
  if (!files.length) throw new Error("Thư mục staging không có shard nào.");

  const metadata = [];
  let total = 0;
  let keepThroughIndex = -1;
  for (let index = 0; index < files.length && total < options.limit; index += 1) {
    const file = files[index];
    const filename = join(sourceDirectory, file);
    const puzzles = JSON.parse(await readFile(filename, "utf8"));
    if (!Array.isArray(puzzles) || !puzzles.length) throw new Error(`Shard không hợp lệ: ${file}`);
    const remaining = options.limit - total;
    const kept = puzzles.slice(0, remaining);
    if (kept.length < puzzles.length) {
      await writeFile(filename, `${JSON.stringify(kept)}\n`, "utf8");
    }
    metadata.push(shardInfo(file, kept));
    total += kept.length;
    keepThroughIndex = index;
  }
  if (total < options.limit) {
    throw new Error(`Staging chỉ có ${total.toLocaleString("vi-VN")} bài, không đủ ${options.limit.toLocaleString("vi-VN")}.`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDirectory = join(backupRoot, `recover-${stamp}-${process.pid}`);
  const extraDirectory = join(backupDirectory, "extra-puzzles");
  await mkdir(extraDirectory, { recursive: true });
  for (const file of files.slice(keepThroughIndex + 1)) {
    await rename(join(sourceDirectory, file), join(extraDirectory, file));
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "https://database.lichess.org/lichess_db_puzzle.csv.zst",
    recoveredFrom: basename(sourceDirectory),
    total,
    shardSize: 500,
    filters: {
      minPopularity: 70,
      minPlays: 100,
      minRating: 600,
      maxRating: 2800
    },
    shards: metadata,
  };
  await writeFile(join(sourceDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const oldActiveBackup = join(backupDirectory, "previous-active-puzzles");
  await mkdir(dirname(oldActiveBackup), { recursive: true });
  await rename(activeDirectory, oldActiveBackup);
  try {
    await rename(sourceDirectory, activeDirectory);
  } catch (error) {
    await rename(oldActiveBackup, activeDirectory);
    throw error;
  }

  console.log(`Đã kích hoạt ${total.toLocaleString("vi-VN")} puzzle trong ${metadata.length} shard.`);
  console.log(`Dữ liệu cũ và phần dư được giữ tại ${relative(projectRoot, backupDirectory)}.`);
}

main().catch((error) => {
  console.error(`Lỗi khôi phục: ${error.message}`);
  process.exitCode = 1;
});
