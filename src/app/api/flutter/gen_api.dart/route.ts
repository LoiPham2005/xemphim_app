import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Script sinh REST client Flutter (Retrofit + Freezed) từ đặc tả OpenAPI của CHÍNH backend này.
 *
 * Phía Flutter không giữ tool nào — chỉ chạy một lệnh ở thư mục gốc app:
 *
 *   curl -fsSL <APP_URL>/api/flutter/gen_api.dart -o .dart_tool/gen_api.dart && dart run .dart_tool/gen_api.dart
 *
 * Mã nguồn script nằm ở `public/flutter/gen_api.dart`; route này chỉ điền sẵn URL
 * `/api/v1/openapi.json` vào đó để người dùng khỏi gõ domain hai lần. Script đi cùng bản deploy
 * nên luôn khớp đúng hợp đồng API mà backend đang phục vụ.
 *
 * CÔNG KHAI, không kiểm quyền — có chủ đích, giống `/api/v1/openapi.json`: chỉ là script sinh
 * code từ đặc tả vốn đã công khai, không chứa dữ liệu hay bí mật nào.
 */
export async function GET(request: Request): Promise<Response> {
  const template = await readFile(path.join(process.cwd(), "public/flutter/gen_api.dart"), "utf8");
  const schemaUrl = new URL("/api/v1/openapi.json", publicOrigin(request)).toString();

  return new Response(template.replace("__SCHEMA_URL__", schemaUrl), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Domain công khai của backend. Ưu tiên `APP_URL`; thiếu thì đọc header reverse proxy (Traefik/Caddy
 * gắn `x-forwarded-host`/`x-forwarded-proto`) — KHÔNG dùng `request.url`: sau proxy nó là địa chỉ nội bộ
 * container (gặp thật trên Dokploy: script nhận `https://0.0.0.0:3000/...`, Flutter kết nối bị từ chối).
 */
function publicOrigin(request: Request): string {
  if (env.APP_URL) return env.APP_URL;

  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  const proto =
    first(request.headers.get("x-forwarded-proto")) ?? new URL(request.url).protocol.slice(0, -1);

  return host ? `${proto}://${host}` : new URL(request.url).origin;
}
