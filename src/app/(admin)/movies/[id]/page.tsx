import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Play } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { MovieNotFoundError } from "@/lib/errors";
import { MOVIE_TYPE_LABELS } from "@/schemas/movie.schema";
import { genreService } from "@/services/genre.service";
import { movieService, type ManagedMovie } from "@/services/movie.service";
import { MoviePoster } from "@/components/movie/movie-card";
import { Button } from "@/components/ui/button";
import { MovieItemActions } from "../movie-item-actions";
import { EpisodeDeleteButton } from "./episode-delete-button";
import { EpisodeUploader } from "./episode-uploader";
import { MovieEditForm } from "./movie-edit-form";

export const metadata: Metadata = { title: "Quản lý phim" };
export const dynamic = "force-dynamic";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Quản lý MỘT phim: sửa thông tin, danh sách tập, thêm tập tiếp theo (phim bộ). */
export default async function ManageMoviePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("movie:manage", `/movies/${id}`);

  let movie: ManagedMovie;
  try {
    movie = await movieService.getForManage(id);
  } catch (error) {
    if (error instanceof MovieNotFoundError) notFound();
    throw error;
  }
  const genres = await genreService.list();
  const nextNumber = (movie.episodes.at(-1)?.number ?? 0) + 1;
  const canAddEpisode = movie.type === "SERIES" || movie.episodes.length === 0;

  return (
    <>
      <Link
        href="/movies"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-content"
      >
        <ChevronLeft className="h-4 w-4" /> Quản lý phim
      </Link>

      <div className="mb-6 mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 overflow-hidden rounded ring-1 ring-line">
            <MoviePoster movie={movie} />
          </div>
          <div>
            <h1 className="page-title">{movie.title}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              <span className="rounded bg-elevated px-2 py-0.5">
                {MOVIE_TYPE_LABELS[movie.type]}
              </span>
              {movie.published ? (
                <span className="badge badge-success">Đã xuất bản</span>
              ) : (
                <span className="badge badge-warning">Đang ẩn</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/watch/${movie.id}`}>
              <Play className="h-4 w-4" /> Xem thử
            </Link>
          </Button>
          <MovieItemActions id={movie.id} title={movie.title} published={movie.published} />
        </div>
      </div>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">
          Danh sách tập{" "}
          <span className="text-sm font-normal text-muted">({movie.episodes.length})</span>
        </h2>
        <ul className="flex list-none flex-col divide-y divide-line p-0">
          {movie.episodes.map((episode) => {
            const label = `Tập ${episode.number}`;
            return (
              <li key={episode.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link
                  href={{ pathname: `/watch/${movie.id}`, query: { ep: episode.number } }}
                  className="min-w-0 flex-1 truncate hover:text-brand"
                >
                  <span className="font-semibold">{label}</span>
                  {episode.title && <span className="text-muted"> — {episode.title}</span>}
                </Link>
                <span className="shrink-0 text-xs text-muted">
                  {formatSize(episode.size)} · {episode.createdAt.toLocaleDateString("vi-VN")}
                </span>
                {movie.episodes.length > 1 && <EpisodeDeleteButton id={episode.id} label={label} />}
              </li>
            );
          })}
        </ul>
      </section>

      {canAddEpisode ? (
        <section className="card">
          <h2 className="mb-4 text-lg font-semibold">Thêm tập tiếp theo</h2>
          <EpisodeUploader movieId={movie.id} nextNumber={nextNumber} />
        </section>
      ) : (
        <p className="mb-6 text-sm text-muted">
          {MOVIE_TYPE_LABELS[movie.type]} chỉ có 1 tập. Muốn thêm tập thì đổi loại sang Phim bộ ở
          form bên dưới.
        </p>
      )}

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">Thông tin phim</h2>
        <MovieEditForm movie={movie} genres={genres} />
      </section>
    </>
  );
}
