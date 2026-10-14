import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, EyeOff, SkipForward } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { EpisodeNotFoundError, MovieNotFoundError } from "@/lib/errors";
import { cn } from "@/lib/cn";
import { MOVIE_TYPE_LABELS } from "@/schemas/movie.schema";
import { movieService, type WatchableMovie } from "@/services/movie.service";
import { permissionService } from "@/services/permission.service";
import { resumeTarget, watchHistoryService } from "@/services/watch-history.service";
import { MoviePoster, MovieRow } from "@/components/movie/movie-card";
import { VideoPlayer } from "@/components/movie/video-player";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Xem phim" };
// URL video là URL ký sẵn có hạn — trang không được cache, nếu không người sau nhận URL đã hết hạn.
export const dynamic = "force-dynamic";

const SUGGESTION_COUNT = 12;

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ep?: string }>;
}) {
  const { id } = await params;
  const { ep } = await searchParams;
  const user = await requirePermission("movie:watch", `/watch/${id}`);
  // Người quản lý xem thử được phim chưa xuất bản.
  const includeUnpublished = await permissionService.can(user.id, "movie:manage");

  // `?ep=abc` hay `?ep=0` thì coi như không chọn tập, không báo lỗi cả trang.
  const parsedEp = Number(ep);
  const requestedEp = Number.isInteger(parsedEp) && parsedEp > 0 ? parsedEp : undefined;

  // Không chọn tập -> mở đúng tập đang xem dở (hoặc tập sau nếu đã xem xong); chưa xem -> tập đầu.
  const resume = resumeTarget(await watchHistoryService.getProgress(user.id, id));
  const episodeNumber = requestedEp ?? resume?.episodeNumber;

  let movie: WatchableMovie;
  try {
    movie = await movieService.getForWatch(id, episodeNumber, { includeUnpublished });
  } catch (error) {
    if (error instanceof MovieNotFoundError || error instanceof EpisodeNotFoundError) notFound();
    throw error;
  }

  // Gợi ý: phim đã xuất bản mới cập nhật, trừ phim đang xem.
  const others = await movieService.latest(
    { limit: SUGGESTION_COUNT + 1 },
    { includeUnpublished: false },
  );
  const suggestions = others.filter((item) => item.id !== movie.id).slice(0, SUGGESTION_COUNT);

  const isSeries = movie.type === "SERIES";
  const index = movie.episodes.findIndex((item) => item.id === movie.current.id);
  const previous = movie.episodes[index - 1];
  const next = movie.episodes[index + 1];
  const episodeHref = (number: number) => ({
    pathname: `/watch/${movie.id}`,
    query: { ep: number },
  });

  return (
    <main>
      {/* Khung chiếu: nền đen tràn ngang, video giữa. `key` = id tập để đổi tập là dựng lại trình phát. */}
      <section className="bg-black">
        <div className="mx-auto max-w-6xl">
          <VideoPlayer
            key={movie.current.id}
            src={movie.current.video.url}
            poster={movie.posterUrl ?? undefined}
            episodeId={movie.current.id}
            // Chỉ tua khi tập đang mở CHÍNH LÀ tập đang dở — chọn tập khác thì phát từ đầu.
            startAt={
              resume && resume.episodeNumber === movie.current.number ? resume.positionSeconds : 0
            }
          />
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-content"
          >
            <ChevronLeft className="h-4 w-4" /> Danh sách phim
          </Link>
          {isSeries && (
            <div className="flex gap-2">
              {previous && (
                <Button asChild size="sm" variant="outline" className="rounded-full">
                  <Link href={episodeHref(previous.number)}>
                    <ChevronLeft className="h-4 w-4" /> Tập {previous.number}
                  </Link>
                </Button>
              )}
              {next && (
                <Button asChild size="sm" className="rounded-full">
                  <Link href={episodeHref(next.number)}>
                    Tập tiếp <SkipForward className="h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-6">
          <div className="hidden w-36 shrink-0 overflow-hidden rounded-token-md ring-1 ring-line sm:block">
            <MoviePoster movie={movie} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-content sm:text-3xl">
              {movie.title}
            </h1>
            {isSeries && (
              <p className="mt-1 text-lg font-semibold text-brand">
                Tập {movie.current.number}
                {movie.current.title && (
                  <span className="font-normal text-muted"> — {movie.current.title}</span>
                )}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-brand/15 px-2 py-0.5 font-semibold text-brand ring-1 ring-inset ring-brand/30">
                {MOVIE_TYPE_LABELS[movie.type]}
              </span>
              {movie.releaseYear && (
                <span className="rounded bg-accent/15 px-2 py-0.5 font-semibold text-accent ring-1 ring-inset ring-accent/30">
                  {movie.releaseYear}
                </span>
              )}
              {isSeries && (
                <span className="rounded bg-elevated px-2 py-0.5 text-muted">
                  {movie.episodes.length} tập
                </span>
              )}
              {movie.genres.map((genre) => (
                <Link
                  key={genre.id}
                  href={{ pathname: "/", query: { genre: genre.slug } }}
                  className="rounded bg-elevated px-2 py-0.5 text-muted transition-colors hover:text-content"
                >
                  {genre.name}
                </Link>
              ))}
              {!movie.published && (
                <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-2 py-0.5 font-semibold text-warning ring-1 ring-inset ring-warning/30">
                  <EyeOff className="h-3.5 w-3.5" /> Đang ẩn — chỉ quản trị thấy
                </span>
              )}
            </div>
            {movie.description ? (
              <p className="mt-4 max-w-3xl whitespace-pre-line leading-relaxed text-muted">
                {movie.description}
              </p>
            ) : (
              <p className="mt-4 text-sm italic text-muted">Chưa có mô tả.</p>
            )}
          </div>
        </div>

        {isSeries && (
          <section className="mt-10">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-content">
              <span className="h-5 w-1 rounded-full bg-brand" />
              Danh sách tập
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
              {movie.episodes.map((item) => {
                const active = item.id === movie.current.id;
                return (
                  <Link
                    key={item.id}
                    href={episodeHref(item.number)}
                    title={item.title ?? `Tập ${item.number}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-center gap-1 rounded-token-md border px-3 py-2 text-sm font-semibold transition-colors",
                      active
                        ? "border-brand bg-brand text-white"
                        : "border-line bg-surface text-content hover:border-brand/60 hover:text-brand",
                    )}
                  >
                    Tập {item.number}
                    {active && <ChevronRight className="h-3.5 w-3.5" />}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {suggestions.length > 0 && (
          <div className="mt-14">
            <MovieRow title="Phim khác" movies={suggestions} />
          </div>
        )}
      </div>
    </main>
  );
}
