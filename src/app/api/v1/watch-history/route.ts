import { z } from "zod";
import { requireApiPermission } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { listWatchHistorySchema, saveWatchProgressSchema } from "@/schemas/movie.schema";
import { permissionService } from "@/services/permission.service";
import { watchHistoryService } from "@/services/watch-history.service";

export const dynamic = "force-dynamic";

/** Lịch sử xem của CHÍNH người gọi, xem gần nhất trước. */
export async function GET(request: Request) {
  try {
    const session = await requireApiPermission(request, "movie:watch");

    const url = new URL(request.url);
    const parsed = listWatchHistorySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);
    }

    const includeUnpublished = await permissionService.can(session.sub, "movie:manage");
    const { items, meta } = await watchHistoryService.list(session.sub, parsed.data, {
      includeUnpublished,
    });
    return apiOk({ items, meta });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/watch-history", request });
  }
}

/**
 * Lưu vị trí đang xem. Trình phát web gọi định kỳ khi đang phát, khi tạm dừng và khi rời trang
 * (`fetch` + `keepalive`); app mobile gọi tương tự. Mỗi phim chỉ một dòng — gọi dày không phình bảng.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission(request, "movie:watch");
    const body = await parseJsonBody(request, saveWatchProgressSchema);

    const includeUnpublished = await permissionService.can(session.sub, "movie:manage");
    await watchHistoryService.saveProgress(session.sub, body, { includeUnpublished });
    return apiOk({ saved: true });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/watch-history", request });
  }
}

/** Xoá TOÀN BỘ lịch sử xem của người gọi. */
export async function DELETE(request: Request) {
  try {
    const session = await requireApiPermission(request, "movie:watch");
    return apiOk({ deleted: await watchHistoryService.clear(session.sub) });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/watch-history", request });
  }
}
