import { NextResponse } from "next/server";
import { getOpenApiDocument } from "@/lib/openapi/registry";

export const dynamic = "force-dynamic";

/**
 * Đặc tả OpenAPI cho `/api/v1/**`, sinh từ Zod schema thật (xem
 * `src/lib/openapi/registry.ts`) — không phải file viết tay có thể lệch dần
 * khỏi code.
 *
 * Dán URL này vào editor.swagger.io, Postman ("Import từ link"), hoặc bất kỳ
 * tool sinh client nào để có tài liệu tương tác — repo này không tự kèm UI
 * riêng để tránh thêm dependency chỉ cho việc hiển thị.
 */
export function GET() {
  return NextResponse.json(getOpenApiDocument());
}
