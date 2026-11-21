export function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

export function parseCliArgs(argv) {
  const options = {
    limit: 100_000,
    minPopularity: 70,
    minPlays: 100,
    minRating: 600,
    maxRating: 2800,
    shardSize: 500,
    source: null,
    refresh: false,
  };

  for (const arg of argv) {
    if (arg === "--all") options.limit = Number.POSITIVE_INFINITY;
    else if (arg === "--refresh") options.refresh = true;
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.split("=")[1]);
    else if (arg.startsWith("--min-popularity=")) options.minPopularity = Number(arg.split("=")[1]);
    else if (arg.startsWith("--min-plays=")) options.minPlays = Number(arg.split("=")[1]);
    else if (arg.startsWith("--min-rating=")) options.minRating = Number(arg.split("=")[1]);
    else if (arg.startsWith("--max-rating=")) options.maxRating = Number(arg.split("=")[1]);
    else if (arg.startsWith("--shard-size=")) options.shardSize = Number(arg.split("=")[1]);
    else if (arg.startsWith("--source=")) options.source = arg.slice("--source=".length);
    else throw new Error(`Tham số không được hỗ trợ: ${arg}`);
  }

  const positiveNumbers = [options.minPlays, options.minRating, options.maxRating, options.shardSize];
  if (positiveNumbers.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Các tham số số phải hợp lệ và không âm.");
  }
  if (options.limit !== Number.POSITIVE_INFINITY && (!Number.isFinite(options.limit) || options.limit < 1)) {
    throw new Error("--limit phải lớn hơn 0.");
  }
  return options;
}
