import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { MOVIE_TYPE_LABELS, listMoviesSchema } from "@/schemas/movie.schema";
import { genreService } from "@/services/genre.service";
import { movieService } from "@/services/movie.service";
import { MoviePoster } from "@/components/movie/movie-card";
import { Button } from "@/components/ui/button";
import { GenreManager } from "./genre-manager";
import { MovieItemActions } from "./movie-item-actions";
import { MovieUploader } from "./movie-uploader";

export const metadata: Metadata = { title: "Quản lý phim" };
export const dynamic = "force-dynamic";

const PER_PAGE = 24;

export default async function ManageMoviesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Lớp bảo vệ ở tầng trang. Server Action tự kiểm lại — layout KHÔNG phải ranh giới bảo mật.
  await requirePermission("movie:manage", "/movies");

  const parsed = listMoviesSchema.safeParse({ ...(await searchParams), limit: PER_PAGE });
  const query = parsed.success ? parsed.data : listMoviesSchema.parse({ limit: PER_PAGE });
  const [{ items, meta }, genres] = await Promise.all([
    movieService.list(query, { includeUnpublished: true }),
    genreService.list(),
  ]);

  const linkTo = (page: number) => ({ pathname: "/movies", query: { page } });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="page-title">Quản lý phim</h1>
        <span className="badge badge-primary">Tổng: {meta.total}</span>
      </div>

      <section className="card">
        <h2 className="mb-2 text-lg font-semibold">Đăng phim mới</h2>
        <p className="mb-5 text-sm text-muted">
          Phim mới ở trạng thái <b>ẩn</b> — xem thử rồi bấm &quot;Xuất bản&quot;. Phim bộ: đăng tập
          1 ở đây, các tập sau thêm trong trang &quot;Quản lý&quot; của phim. Nên dùng MP4 (H.264 +
          AAC) để mọi trình duyệt phát được.
        </p>
        <MovieUploader genres={genres} />
      </section>

      <section className="card">
        {items.length === 0 ? (
          <p className="py-8 text-center text-muted">Chưa có phim nào.</p>
        ) : (
          <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 p-0">
            {items.map((movie) => (
              <li
                key={movie.id}
                className="flex flex-col gap-2 rounded-token-md border border-line p-3"
              >
                <Link
                  href={`/movies/${movie.id}`}
                  className="block overflow-hidden rounded-token-md ring-1 ring-line"
                >
                  <MoviePoster movie={movie} />
                </Link>
                <div className="truncate font-semibold" title={movie.title}>
                  {movie.title}
                  {movie.releaseYear && <span className="text-muted"> ({movie.releaseYear})</span>}
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded bg-elevated px-2 py-0.5">
                    {MOVIE_TYPE_LABELS[movie.type]}
                  </span>
                  {movie.type === "SERIES" && (
                    <span className="rounded bg-elevated px-2 py-0.5">
                      {movie.episodeCount} tập
                    </span>
                  )}
                  {movie.published ? (
                    <span className="badge badge-success">Đã xuất bản</span>
                  ) : (
                    <span className="badge badge-warning">Đang ẩn</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/movies/${movie.id}`}>Quản lý</Link>
                  </Button>
                  <MovieItemActions id={movie.id} title={movie.title} published={movie.published} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {(meta.page > 1 || meta.hasNext) && (
          <div className="mt-5 flex items-center justify-between">
            <span className="text-sm text-muted">
              Trang {meta.page}/{meta.totalPages}
            </span>
            <div className="flex gap-2">
              {meta.page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={linkTo(meta.page - 1)}>← Trước</Link>
                </Button>
              )}
              {meta.hasNext && (
                <Button asChild variant="outline" size="sm">
                  <Link href={linkTo(meta.page + 1)}>Sau →</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">Thể loại</h2>
        <GenreManager genres={genres} />
      </section>
    </>
  );
}
