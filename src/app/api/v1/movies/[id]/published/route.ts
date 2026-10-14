import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { setMoviePublishedSchema } from "@/schemas/movie.schema";
import { auditService } from "@/services/audit.service";
import { movieService } from "@/services/movie.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Xuất bản / ẩn phim (`movie:manage`). */
export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "movie:manage");
    const { published } = await parseJsonBody(request, setMoviePublishedSchema);

    await movieService.setPublished(id, published);
    await auditService.record({
      action: published ? "movie.published" : "movie.unpublished",
      entity: "movie",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
    });

    return apiOk({ id, published });
  } catch (error) {
    return handleApiError(error, { route: "PUT /api/v1/movies/[id]/published", request });
  }
}
