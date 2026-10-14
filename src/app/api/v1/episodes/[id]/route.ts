import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { auditService } from "@/services/audit.service";
import { movieService } from "@/services/movie.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Xoá một tập (`movie:manage`). Tập duy nhất còn lại thì 409 — xoá cả phim thay vào. */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "movie:manage");

    const { movieId } = await movieService.removeEpisode(id);
    await auditService.record({
      action: "movie.episode_deleted",
      entity: "movie",
      entityId: movieId,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { episodeId: id },
    });

    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/episodes/[id]", request });
  }
}
