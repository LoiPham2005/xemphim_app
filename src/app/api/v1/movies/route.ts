import { z } from "zod";
import { requireApiPermission } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { createMovieSchema, listMoviesQuerySchema } from "@/schemas/movie.schema";
import { auditService } from "@/services/audit.service";
import { movieService } from "@/services/movie.service";
import { permissionService } from "@/services/permission.service";

export const dynamic = "force-dynamic";

/**
 * Danh sách phim (`movie:watch`). Lọc `q`/`type`/`genre`, phân trang theo số trang. Phim đang ẩn chỉ
 * hiện khi gửi `includeUnpublished=true` VÀ có `movie:manage`.
 */
export async function GET(request: Request) {
  try {
    const session = await requireApiPermission(request, "movie:watch");

    const url = new URL(request.url);
    const parsed = listMoviesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);
    }

    const { includeUnpublished, ...query } = parsed.data;
    const canManage =
      includeUnpublished === true && (await permissionService.can(session.sub, "movie:manage"));

    const { items, meta } = await movieService.list(query, { includeUnpublished: canManage });
    return apiOk({ items, meta });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/movies", request });
  }
}

/**
 * Tạo phim kèm tập 1 (`movie:manage`). Video và poster phải tải lên TRƯỚC qua `/api/v1/files*` rồi gửi
 * `id` vào đây — phim mới ở trạng thái ẩn.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission(request, "movie:manage");
    const body = await parseJsonBody(request, createMovieSchema);

    const movie = await movieService.create(body, session.sub);
    await auditService.record({
      action: "movie.created",
      entity: "movie",
      entityId: movie.id,
      actorId: session.sub,
      actorEmail: session.email,
    });

    return apiOk({ movie }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/movies", request });
  }
}
