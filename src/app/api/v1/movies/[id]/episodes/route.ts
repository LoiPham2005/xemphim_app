import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { addEpisodeSchema } from "@/schemas/movie.schema";
import { auditService } from "@/services/audit.service";
import { movieService } from "@/services/movie.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Thêm TẬP TIẾP THEO cho phim bộ (`movie:manage`). Video tải lên trước qua `/api/v1/files/uploads`;
 * số tập do máy chủ đánh (lớn nhất + 1). Phim lẻ/chiếu rạp đã có 1 tập thì 409.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "movie:manage");
    const body = await parseJsonBody(request, addEpisodeSchema);

    const episode = await movieService.addEpisode(id, body, session.sub);
    await auditService.record({
      action: "movie.episode_added",
      entity: "movie",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { episodeId: episode.id, number: episode.number },
    });

    return apiOk({ episode }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/movies/[id]/episodes", request });
  }
}
