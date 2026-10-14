import type { Metadata } from "next";
import Link from "next/link";
import { History, Play } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { formatDuration } from "@/lib/format";
import { listWatchHistorySchema } from "@/schemas/movie.schema";
import { permissionService } from "@/services/permission.service";
import { watchHistoryService, type WatchHistoryItem } from "@/services/watch-history.service";
import { MoviePoster } from "@/components/movie/movie-card";
import { Button } from "@/components/ui/button";
import { ClearHistoryButton, RemoveHistoryButton } from "./history-buttons";

export const metadata: Metadata = { title: "Lịch sử xem" };
// URL poster là URL ký sẵn có hạn — không cache trang.
export const dynamic = "force-dynamic";

const PER_PAGE = 24;

/** Lịch sử xem của chính người đang đăng nhập. Bấm vào phim = xem tiếp đúng tập, đúng giây. */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("movie:watch", "/history");
  const includeUnpublished = await permissionService.can(user.id, "movie:manage");

  const parsed = listWatchHistorySchema.safeParse({ ...(await searchParams), limit: PER_PAGE });
  const query = parsed.success ? parsed.data : listWatchHistorySchema.parse({ limit: PER_PAGE });
  const { items, meta } = await watchHistoryService.list(user.id, query, { includeUnpublished });

  const linkTo = (page: number) => ({ pathname: "/history", query: { page } });

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-content">
          <History className="h-6 w-6 text-brand" /> Lịch sử xem
          <span className="text-base font-normal text-muted">({meta.total})</span>
        </h1>
        {items.length > 0 && <ClearHistoryButton />}
      </div>

      {items.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-brand ring-1 ring-line">
            <History className="h-8 w-8" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-content">Chưa xem phim nào</h2>
          <p className="mt-2 text-muted">Phim bạn xem sẽ hiện ở đây để xem tiếp.</p>
          <Button asChild className="mt-6">
            <Link href="/">Khám phá phim</Link>
          </Button>
        </div>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.movie.id}>
              <HistoryCard item={item} />
            </li>
          ))}
        </ul>
      )}

      {(meta.page > 1 || meta.hasNext) && (
        <div className="mt-10 flex items-center justify-center gap-3">
          {meta.page > 1 && (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href={linkTo(meta.page - 1)}>← Trước</Link>
            </Button>
          )}
          <span className="text-sm text-muted">
            Trang {meta.page}/{meta.totalPages}
          </span>
          {meta.hasNext && (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href={linkTo(meta.page + 1)}>Sau →</Link>
            </Button>
          )}
        </div>
      )}
    </main>
  );
}

/** Thẻ lịch sử: poster nhỏ, tập + thanh tiến độ, nút hành động hợp với trạng thái. */
function HistoryCard({ item }: { item: WatchHistoryItem }) {
  const { movie, episode } = item;
  const isSeries = movie.type === "SERIES";
  const ratio = Math.min(1, item.positionSeconds / item.durationSeconds);

  // Link KHÔNG kèm `?ep=` — trang xem tự chọn đúng tập dở (hoặc tập kế tiếp nếu đã xong) và tua tới.
  const action = !item.finished
    ? `Xem tiếp ${formatDuration(item.positionSeconds)}`
    : item.nextEpisodeNumber !== null
      ? `Xem tập ${item.nextEpisodeNumber}`
      : "Xem lại";

  return (
    <div className="group relative flex gap-4 rounded-token-lg border border-line bg-surface p-3 transition-colors hover:border-brand/50">
      <RemoveHistoryButton movieId={movie.id} title={movie.title} />
      <Link
        href={`/watch/${movie.id}`}
        className="w-20 shrink-0 overflow-hidden rounded-token-md ring-1 ring-line"
      >
        <MoviePoster movie={movie} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/watch/${movie.id}`}
          className="truncate pr-6 font-semibold text-content hover:text-brand"
          title={movie.title}
        >
          {movie.title}
        </Link>
        {isSeries && (
          <p className="truncate text-sm text-muted">
            Tập {episode.number}
            {episode.title && ` — ${episode.title}`}
          </p>
        )}
        <p className="mt-1 text-xs text-muted">
          {item.finished
            ? "Đã xem xong"
            : `${formatDuration(item.positionSeconds)} / ${formatDuration(item.durationSeconds)}`}
          {" · "}
          {item.updatedAt.toLocaleDateString("vi-VN")}
        </p>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-elevated">
          <div
            className={item.finished ? "h-full bg-success" : "h-full bg-brand"}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>

        <Button asChild size="sm" className="mt-auto self-start rounded-full">
          <Link href={`/watch/${movie.id}`}>
            <Play className="h-3.5 w-3.5 fill-current" /> {action}
          </Link>
        </Button>
      </div>
    </div>
  );
}
