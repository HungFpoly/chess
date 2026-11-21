import { open } from "node:fs/promises";

const ZSTD_FRAME_MAGIC = 0xfd2fb528;
const SKIPPABLE_MIN = 0x184d2a50;
const SKIPPABLE_MAX = 0x184d2a5f;

export function inspectZstdPrefix(bytes) {
  if (bytes.length < 4) return { kind: "incomplete" };
  const magic = bytes.readUInt32LE(0);
  if (magic === ZSTD_FRAME_MAGIC) return { kind: "frame" };
  if (magic >= SKIPPABLE_MIN && magic <= SKIPPABLE_MAX) {
    if (bytes.length < 8) return { kind: "incomplete" };
    return { kind: "skippable", length: bytes.readUInt32LE(4) };
  }
  return { kind: "unknown", magic };
}

export async function findZstdFrameOffset(filename) {
  const handle = await open(filename, "r");
  let offset = 0;
  try {
    for (let index = 0; index < 32; index += 1) {
      const header = Buffer.alloc(8);
      const { bytesRead } = await handle.read(header, 0, header.length, offset);
      if (bytesRead < 4) throw new Error("File dữ liệu quá ngắn hoặc tải chưa hoàn tất.");
      const prefix = inspectZstdPrefix(header.subarray(0, bytesRead));
      if (prefix.kind === "frame") return offset;
      if (prefix.kind === "skippable") {
        offset += 8 + prefix.length;
        continue;
      }
      throw new Error(
        "File nguồn không phải dữ liệu Zstandard của Lichess. Hãy chạy lại với --refresh.",
      );
    }
    throw new Error("File có quá nhiều Zstandard skippable frame ở phần đầu.");
  } finally {
    await handle.close();
  }
}
