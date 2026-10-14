import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { watchHistoryService } from "@/services/watch-history.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ movieId: string }> };

/** Bỏ một phim khỏi lịch sử của người gọi. Không có thì vẫn 200 — xoá lặp lại không phải lỗi. */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { movieId } = await params;
    const session = await requireApiPermission(request, "movie:watch");
    await watchHistoryService.remove(session.sub, movieId);
    return apiOk({ movieId });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/watch-history/[movieId]", request });
  }
}
