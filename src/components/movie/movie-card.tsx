import Link from "next/link";
import { Film, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PublicMovie } from "@/services/movie.service";

/** Ảnh poster tỉ lệ 2:3, không có poster thì hiện khung giữ chỗ. */
export function MoviePoster({ movie, className }: { movie: PublicMovie; className?: string }) {
  return movie.posterUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- ảnh nằm trên kho S3, URL ký sẵn
    <img
      src={movie.posterUrl}
      alt={movie.title}
      loading="lazy"
      className={cn("aspect-[2/3] w-full object-cover", className)}
    />
  ) : (
    <div
      className={cn(
        "flex aspect-[2/3] w-full items-center justify-center bg-gradient-to-br from-elevated to-surface text-muted",
        className,
      )}
    >
      <Film className="h-10 w-10" />
    </div>
  );
}

/** Thẻ phim trong lưới/hàng: rê chuột thì phóng nhẹ và hiện nút phát. */
export function MovieCard({ movie, className }: { movie: PublicMovie; className?: string }) {
  return (
    <Link href={`/watch/${movie.id}`} className={cn("group block", className)}>
      <div className="relative overflow-hidden rounded-token-md bg-surface ring-1 ring-line transition duration-300 group-hover:-translate-y-1 group-hover:ring-brand/60 group-hover:shadow-xl group-hover:shadow-brand/10">
        <MoviePoster
          movie={movie}
          className="transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/40">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </div>
        {movie.releaseYear && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-accent backdrop-blur">
            {movie.releaseYear}
          </span>
        )}
        {movie.type === "SERIES" && (
          <span className="absolute right-2 top-2 rounded bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-white shadow">
            {movie.episodeCount} tập
          </span>
        )}
        {movie.type === "THEATRICAL" && (
          <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-black shadow">
            Chiếu rạp
          </span>
        )}
      </div>
      <div
        className="mt-2 truncate text-sm font-semibold text-content transition-colors group-hover:text-brand"
        title={movie.title}
      >
        {movie.title}
      </div>
    </Link>
  );
}

/** Hàng phim cuộn ngang, kiểu "Mới cập nhật". */
export function MovieRow({ title, movies }: { title: string; movies: PublicMovie[] }) {
  if (movies.length === 0) return null;
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-content">
        <span className="h-5 w-1 rounded-full bg-brand" />
        {title}
      </h2>
      <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {movies.map((movie) => (
          <MovieCard key={movie.id} movie={movie} className="w-36 shrink-0 snap-start sm:w-44" />
        ))}
      </div>
    </section>
  );
}
