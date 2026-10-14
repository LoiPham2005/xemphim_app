import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getOpenApiDocument } from "./registry";

/**
 * Đặc tả OpenAPI được dựng ở tầng module, nên hỏng ở đây là hỏng lúc CHẠY chứ
 * không phải lúc biên dịch — `/api/v1/openapi.json` trả 500 và không có gì
 * trong typecheck báo trước.
 *
 * Chuyện đó đã xảy ra thật: bản trước dùng `@asteasolutions/zod-to-openapi`,
 * thư viện gắn `.openapi()` vào prototype của Zod bằng một module chỉ có side
 * effect và đòi module ấy chạy TRƯỚC mọi schema. Turbopack không giữ thứ tự đó
 * khi gom bundle production, nên `next dev` chạy đúng còn `next build` thì đổ.
 */
const API_ROOT = path.resolve(import.meta.dirname, "../../app/api/v1");

/** HTTP method mà một `route.ts` thật sự export. */
const METHOD_EXPORT = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

/** Đường dẫn route THẬT trên đĩa, dạng `POST /auth/login`. */
function actualRoutes(dir = API_ROOT, prefix = ""): Set<string> {
  const found = new Set<string>();

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // `[id]` trên đĩa ↔ `{id}` trong OpenAPI. Route group `(...)` không nằm
      // trong URL nên bị bỏ qua hoàn toàn.
      const segment = entry.name.startsWith("(")
        ? ""
        : `/${entry.name.replace(/^\[(?:\.\.\.)?(.+)\]$/, "{$1}")}`;

      for (const item of actualRoutes(path.join(dir, entry.name), prefix + segment)) {
        found.add(item);
      }
      continue;
    }

    // `openapi.json` mô tả chính đặc tả, nó không thuộc hợp đồng được mô tả.
    if (entry.name !== "route.ts" || prefix === "/openapi.json") continue;

    const source = readFileSync(path.join(dir, entry.name), "utf8");
    for (const match of source.matchAll(METHOD_EXPORT)) {
      found.add(`${match[1]} ${prefix}`);
    }
  }

  return found;
}

describe("đặc tả OpenAPI", () => {
  const document = getOpenApiDocument();

  it("dựng được và đúng phiên bản", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
  });

  /**
   * Bài test quan trọng nhất của file này.
   *
   * Tài liệu lệch code không làm request nào lỗi — nó chỉ khiến công cụ sinh
   * client dựng ra một SDK thiếu hàm, hoặc thừa một hàm gọi vào 404. Cả hai
   * đều lộ ra ở phía client, nhiều ngày sau, và ở một repo khác.
   *
   * So khớp hai chiều với thư mục route thật nên thêm endpoint mà quên khai
   * báo là đỏ ngay tại đây.
   */
  it("mọi route thật đều có trong đặc tả, và ngược lại", () => {
    const documented = new Set<string>();
    for (const [routePath, operations] of Object.entries(document.paths)) {
      for (const method of Object.keys(operations)) {
        documented.add(`${method.toUpperCase()} ${routePath}`);
      }
    }

    expect([...actualRoutes()].sort()).toEqual([...documented].sort());
  });

  it("mọi $ref đều trỏ tới một schema có thật", () => {
    // `$ref` gãy không làm request nào lỗi — nó chỉ làm công cụ sinh client
    // dựng ra kiểu rỗng, và lỗi lộ ra ở phía client, nhiều ngày sau.
    const schemas = document.components.schemas;
    const refs = [...JSON.stringify(document).matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1]);

    expect(refs.length).toBeGreaterThan(0);

    for (const target of new Set(refs)) {
      const name = target!.replace("#/components/schemas/", "");
      expect(schemas[name], `$ref gãy: ${target}`).toBeDefined();
    }
  });

  it("Date được khai là chuỗi ISO, không phải kiểu rỗng", () => {
    // `z.date()` không biểu diễn được trong JSON Schema. Bỏ qua nó thì client
    // nhận `dynamic`/`Any` và mất kiểm tra kiểu ở đúng chỗ dễ sai nhất.
    const user = document.components.schemas.User as {
      properties: Record<string, { type?: string; format?: string }>;
    };

    expect(user.properties.createdAt).toMatchObject({ type: "string", format: "date-time" });
  });

  it("response bọc trong { data: ... } đúng như apiOk() trả về", () => {
    const response = document.components.schemas.UserResponse as {
      properties: { data: { properties: { user: { $ref: string } } } };
    };

    expect(response.properties.data.properties.user.$ref).toBe("#/components/schemas/User");
  });

  it("không rò siêu dữ liệu JSON Schema sang OpenAPI", () => {
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      expect(schema, `${name} còn $schema`).not.toHaveProperty("$schema");
      expect(schema, `${name} còn $id`).not.toHaveProperty("$id");
    }
  });
});
