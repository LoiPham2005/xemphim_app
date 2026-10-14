import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { createGenreSchema } from "@/schemas/movie.schema";
import { genreService } from "@/services/genre.service";

export const dynamic = "force-dynamic";

/** Danh sách thể loại (`movie:watch`) — dùng `slug` để lọc `GET /movies?genre=`. */
export async function GET(request: Request) {
  try {
    await requireApiPermission(request, "movie:watch");
    return apiOk({ genres: await genreService.list() });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/genres", request });
  }
}

/** Thêm thể loại (`movie:manage`). Trùng tên/slug thì 409. */
export async function POST(request: Request) {
  try {
    await requireApiPermission(request, "movie:manage");
    const body = await parseJsonBody(request, createGenreSchema);
    return apiOk({ genre: await genreService.create(body) }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/genres", request });
  }
}
