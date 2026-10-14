import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { genreService } from "@/services/genre.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Xoá thể loại (`movie:manage`) — chỉ gỡ nhãn khỏi các phim, không xoá phim. */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await requireApiPermission(request, "movie:manage");
    await genreService.remove(id);
    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/genres/[id]", request });
  }
}
