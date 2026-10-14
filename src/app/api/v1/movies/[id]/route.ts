import { z } from "zod";
import { requireApiPermission } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { updateMovieSchema, watchMovieQuerySchema } from "@/schemas/movie.schema";
import { auditService } from "@/services/audit.service";
import { movieService } from "@/services/movie.service";
import { permissionService } from "@/services/permission.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Chi tiết phim + URL phát của một tập (`?ep=`, bỏ trống = tập đầu). URL là URL ký sẵn, hết hạn sau
 * vài giờ — client đừng lưu lại, mở lại thì gọi lại endpoint này. Phim ẩn chỉ `movie:manage` thấy.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "movie:watch");

    const url = new URL(request.url);
    const parsed = watchMovieQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);
    }

    const includeUnpublished = await permissionService.can(session.sub, "movie:manage");
    const movie = await movieService.getForWatch(id, parsed.data.ep, { includeUnpublished });
    return apiOk({ movie });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/movies/[id]", request });
  }
}

/** Sửa thông tin phim (`movie:manage`). `posterFileId` có mặt = thay poster. */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "movie:manage");
    const body = await parseJsonBody(request, updateMovieSchema);

    await movieService.update(id, body, session.sub);
    await auditService.record({
      action: "movie.updated",
      entity: "movie",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
    });

    return apiOk({ movie: await movieService.getForManage(id) });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/movies/[id]", request });
  }
}

/** Xoá phim cùng mọi tập (`movie:manage`). Video/poster bị dọn khỏi kho sau đó bởi `db:purge`. */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "movie:manage");

    await movieService.remove(id);
    await auditService.record({
      action: "movie.deleted",
      entity: "movie",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
    });

    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/movies/[id]", request });
  }
}
