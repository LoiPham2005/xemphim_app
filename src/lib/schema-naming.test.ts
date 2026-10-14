import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Postgres hạ MỌI định danh không nằm trong nháy kép về chữ thường. Một cột tên
 * `createdAt` vì thế chỉ gọi được bằng `"createdAt"`: `select createdAt from
 * users` đổ lỗi `column "createdat" does not exist`.
 *
 * Chuyện đã xảy ra thật ở bộ khung này: bảng thì snake_case (`@@map`) còn cột
 * thì camelCase vì thiếu `@map`, nên chính comment trong migration —
 * `WHERE deleted_at IS NULL` — trỏ vào một cột không tồn tại. Typecheck không
 * thấy (tên trong TypeScript vẫn đúng), test service không thấy (mock Prisma),
 * chỉ SQL viết tay mới lộ ra. Bài test này giữ hai phía không lệch lại nữa.
 */
const SCHEMA = path.resolve(import.meta.dirname, "../../prisma/schema.prisma");
const MIGRATIONS = path.resolve(import.meta.dirname, "../../prisma/migrations");

const SCALARS = new Set([
  "String",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
]);

const snake = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

type Block = { kind: "model" | "enum"; name: string; lines: string[] };

function parseBlocks(source: string): Block[] {
  const out: Block[] = [];
  let current: Block | null = null;

  for (const line of source.split("\n")) {
    const open = /^\s*(model|enum)\s+(\w+)\s*\{/.exec(line);
    if (open && open[1] && open[2]) {
      current = { kind: open[1] as Block["kind"], name: open[2], lines: [] };
      continue;
    }
    if (current && /^\s*\}\s*$/.test(line)) {
      out.push(current);
      current = null;
      continue;
    }
    current?.lines.push(line);
  }

  return out;
}

const blocks = parseBlocks(readFileSync(SCHEMA, "utf8"));
const models = blocks.filter((b) => b.kind === "model");
const enums = blocks.filter((b) => b.kind === "enum");
const modelNames = new Set(models.map((b) => b.name));
const enumNames = new Set(enums.map((b) => b.name));

/** Chỉ CỘT thật mới cần `@map` — field quan hệ không tồn tại phía database. */
function columnsOf(block: Block) {
  return block.lines.flatMap((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) return [];

    const field = /^(\w+)\s+(\w+)/.exec(line);
    if (!field || !field[1] || !field[2]) return [];

    const name = field[1];
    const type = field[2];
    if (modelNames.has(type)) return [];
    if (!SCALARS.has(type) && !enumNames.has(type)) return [];

    return [{ name, line }];
  });
}

const mapped = (line: string) => /@map\("([^"]+)"\)/.exec(line)?.[1];
const blockMapped = (block: Block) =>
  block.lines.map((l) => /@@map\("([^"]+)"\)/.exec(l.trim())?.[1]).find(Boolean);

describe("quy ước đặt tên schema: TypeScript camelCase — database snake_case", () => {
  it("mọi cột có chữ hoa đều kèm @map đúng dạng snake_case", () => {
    const sai = models.flatMap((model) =>
      columnsOf(model)
        // Tên đã toàn chữ thường thì `@map` là thừa, không phải thiếu.
        .filter(({ name, line }) => (mapped(line) ?? name) !== snake(name))
        .map(({ name, line }) => `${model.name}.${name} → ${mapped(line) ?? "thiếu @map"}`),
    );

    expect(sai).toEqual([]);
  });

  it("mọi model đều kèm @@map, tên bảng viết thường", () => {
    const sai = models
      .filter((m) => !/^[a-z][a-z0-9_]*$/.test(blockMapped(m) ?? ""))
      .map((m) => `${m.name} → ${blockMapped(m) ?? "thiếu @@map"}`);

    expect(sai).toEqual([]);
  });

  it("mọi enum đều kèm @@map, tên kiểu viết thường", () => {
    const sai = enums
      .filter((e) => blockMapped(e) !== snake(e.name))
      .map((e) => `${e.name} → ${blockMapped(e) ?? "thiếu @@map"}`);

    expect(sai).toEqual([]);
  });

  it("migration không còn định danh camelCase trong nháy kép", () => {
    const sai = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const file = path.join(MIGRATIONS, entry.name, "migration.sql");
        const found = readFileSync(file, "utf8").match(/"[A-Za-z_][A-Za-z0-9_]*"/g) ?? [];
        return found.filter((token) => /[A-Z]/.test(token)).map((t) => `${entry.name}: ${t}`);
      });

    expect(sai).toEqual([]);
  });
});
