import Link from "next/link";
import { Clapperboard, Film, Lock, Play, Upload } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  MOVIE_TYPES,
  MOVIE_TYPE_LABELS,
  listMoviesSchema,
  type ListMoviesInput,
} from "@/schemas/movie.schema";
import { genreService } from "@/services/genre.service";
import { movieService, type GenreSummary, type PublicMovie } from "@/services/movie.service";
import { permissionService } from "@/services/permission.service";
import { MovieCard, MovieRow } from "@/components/movie/movie-card";
import { Button } from "@/components/ui/button";

// URL poster là URL ký sẵn có hạn — không cache trang.
export const dynamic = "force-dynamic";

const PER_PAGE = 24;
const ROW_COUNT = 12;

type Filters = Pick<ListMoviesInput, "q" | "type" | "genre">;

/**
 * Trang chủ. Chưa đăng nhập hoặc không có `movie:watch` thì chỉ thấy trang chào — danh sách phim
 * không lộ ra ngoài. Có quyền:
 *   - không lọc: banner phim mới nhất, hàng "Mới cập nhật" + một hàng cho mỗi loại, lưới tất cả phim.
 *   - có `?q=` / `?type=` / `?genre=`: chỉ hiện lưới kết quả lọc.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  const [canWatch, canManage] = user
    ? await Promise.all([
        permissionService.can(user.id, "movie:watch"),
        permissionService.can(user.id, "movie:manage"),
      ])
    : [false, false];

  if (!canWatch) return <Welcome signedIn={user !== null} />;

  const parsed = listMoviesSchema.safeParse({ ...(await searchParams), limit: PER_PAGE });
  const query = parsed.success ? parsed.data : listMoviesSchema.parse({ limit: PER_PAGE });
  const filters: Filters = { q: query.q, type: query.type, genre: query.genre };
  const viewer = { includeUnpublished: false };
  const genres = await genreService.list();

  if (filters.q || filters.type || filters.genre) {
    const { items, meta } = await movieService.list(query, viewer);
    const genreName = genres.find((genre) => genre.slug === filters.genre)?.name;
    const heading = filters.q
      ? `Kết quả cho “${filters.q}”`
      : [filters.type && MOVIE_TYPE_LABELS[filters.type], genreName].filter(Boolean).join(" · ");

    return (
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-content">
          {heading || "Phim"}
          <span className="ml-2 text-base font-normal text-muted">{meta.total} phim</span>
        </h1>
        <FilterBar genres={genres} filters={filters} />
        {items.length === 0 ? (
          <EmptyState title="Không tìm thấy phim nào" text="Thử bộ lọc hoặc từ khoá khác." />
        ) : (
          <MovieGrid movies={items} />
        )}
        <Pagination meta={meta} filters={filters} />
      </main>
    );
  }

  // Hàng phim dùng `latest()` (không transaction); chỉ lưới phân trang mới cần `list()`.
  const row = { limit: ROW_COUNT };
  const [latest, series, single, theatrical, all] = await Promise.all([
    movieService.latest(row, viewer),
    movieService.latest({ ...row, type: "SERIES" }, viewer),
    movieService.latest({ ...row, type: "SINGLE" }, viewer),
    movieService.latest({ ...row, type: "THEATRICAL" }, viewer),
    movieService.list(query, viewer),
  ]);
  const featured = latest[0];

  if (!featured) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <EmptyState
          title="Chưa có phim nào"
          text={canManage ? "Đăng bộ phim đầu tiên để bắt đầu." : "Quay lại sau nhé."}
          action={
            canManage ? (
              <Button asChild>
                <Link href="/movies">
                  <Upload className="h-4 w-4" /> Đăng phim
                </Link>
              </Button>
            ) : null
          }
        />
      </main>
    );
  }

  return (
    <main>
      <Hero movie={featured} />

      <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-10 sm:px-6 lg:px-8">
        <FilterBar genres={genres} filters={filters} />
        <MovieRow title="Mới cập nhật" movies={latest} />
        <MovieRow title="Phim bộ" movies={series} />
        <MovieRow title="Phim lẻ" movies={single} />
        <MovieRow title="Chiếu rạp" movies={theatrical} />

        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-content">
            <span className="h-5 w-1 rounded-full bg-brand" />
            Tất cả phim
            <span className="text-sm font-normal text-muted">({all.meta.total})</span>
          </h2>
          <MovieGrid movies={all.items} />
          <Pagination meta={all.meta} filters={filters} />
        </section>
      </div>
    </main>
  );
}

/** Lọc theo loại (tab) và thể loại (chip). Bấm lại chip đang chọn = bỏ lọc thể loại. */
function FilterBar({ genres, filters }: { genres: GenreSummary[]; filters: Filters }) {
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm transition-colors",
      active
        ? "border-brand bg-brand text-white"
        : "border-line text-muted hover:border-brand/60 hover:text-content",
    );
  const withFilters = (next: Filters) => ({
    pathname: "/" as const,
    query: Object.fromEntries(Object.entries(next).filter(([, value]) => value)),
  });

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Link href={withFilters({ genre: filters.genre })} className={chip(!filters.type)}>
          Tất cả
        </Link>
        {MOVIE_TYPES.map((type) => (
          <Link
            key={type}
            href={withFilters({ type, genre: filters.genre })}
            className={chip(filters.type === type)}
          >
            {MOVIE_TYPE_LABELS[type]}
          </Link>
        ))}
      </div>
      {genres.length > 0 && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {genres.map((genre) => {
            const active = filters.genre === genre.slug;
            return (
              <Link
                key={genre.id}
                href={withFilters({ type: filters.type, genre: active ? undefined : genre.slug })}
                className={cn(chip(active), "shrink-0 text-xs")}
              >
                {genre.name}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Banner phim nổi bật: poster phóng to làm phông mờ phía sau, poster thật bên phải. */
function Hero({ movie }: { movie: PublicMovie }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-line/60">
      {movie.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh nằm trên kho S3, URL ký sẵn
        <img
          src={movie.posterUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 -z-20 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
        />
      )}
      <div className="cinema-backdrop absolute inset-0 -z-30" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-canvas via-canvas/80 to-canvas/30" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-t from-canvas to-transparent" />

      <div className="mx-auto flex max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:px-8">
        <div className="max-w-2xl flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand ring-1 ring-inset ring-brand/30">
            <Clapperboard className="h-3.5 w-3.5" /> Mới nhất
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-content sm:text-5xl lg:text-6xl">
            {movie.title}
          </h1>
          {movie.releaseYear && (
            <p className="mt-3 text-sm font-semibold text-accent">{movie.releaseYear}</p>
          )}
          {movie.description && (
            <p className="mt-4 line-clamp-3 max-w-xl leading-relaxed text-muted sm:text-lg">
              {movie.description}
            </p>
          )}
          <div className="mt-8">
            <Button asChild size="lg" className="rounded-full px-8 shadow-lg shadow-brand/30">
              <Link href={`/watch/${movie.id}`}>
                <Play className="h-5 w-5 fill-current" /> Xem ngay
              </Link>
            </Button>
          </div>
        </div>

        <Link
          href={`/watch/${movie.id}`}
          className="hidden w-56 shrink-0 overflow-hidden rounded-token-lg shadow-2xl shadow-black/60 ring-1 ring-white/10 transition-transform hover:scale-[1.02] md:block lg:w-64"
        >
          {movie.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- ảnh nằm trên kho S3, URL ký sẵn
            <img
              src={movie.posterUrl}
              alt={movie.title}
              className="aspect-[2/3] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[2/3] w-full items-center justify-center bg-surface text-muted">
              <Film className="h-12 w-12" />
            </div>
          )}
        </Link>
      </div>
    </section>
  );
}

function MovieGrid({ movies }: { movies: PublicMovie[] }) {
  return (
    <ul className="mt-6 grid list-none grid-cols-2 gap-x-4 gap-y-6 p-0 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {movies.map((movie) => (
        <li key={movie.id}>
          <MovieCard movie={movie} />
        </li>
      ))}
    </ul>
  );
}

function Pagination({
  meta,
  filters,
}: {
  meta: { page: number; totalPages: number; hasNext: boolean };
  filters: Filters;
}) {
  if (meta.page <= 1 && !meta.hasNext) return null;
  const linkTo = (page: number) => ({
    pathname: "/" as const,
    query: { ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), page },
  });

  return (
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
  );
}

function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-brand ring-1 ring-line">
        <Film className="h-8 w-8" />
      </div>
      <h2 className="mt-5 text-xl font-bold text-content">{title}</h2>
      <p className="mt-2 text-muted">{text}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Trang chào cho người chưa đăng nhập / chưa được cấp quyền xem. */
function Welcome({ signedIn }: { signedIn: boolean }) {
  const features = [
    { icon: Play, title: "Xem mọi lúc", text: "Phát ngay trên trình duyệt, tua thoải mái." },
    { icon: Upload, title: "Kho của riêng bạn", text: "Phim do quản trị viên tự đăng tải." },
    { icon: Lock, title: "Riêng tư", text: "Chỉ tài khoản được cấp quyền mới xem được." },
  ];

  return (
    <main className="cinema-backdrop relative -mt-16 overflow-hidden pt-16">
      <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 md:py-32">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-white shadow-xl shadow-brand/40">
          <Clapperboard className="h-8 w-8" />
        </div>
        <h1 className="mt-8 text-4xl font-extrabold tracking-tight text-content sm:text-6xl">
          Rạp phim <span className="text-brand">của riêng bạn</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted">
          {signedIn
            ? "Tài khoản của bạn chưa được cấp quyền xem phim. Liên hệ quản trị viên."
            : "Đăng nhập để vào kho phim."}
        </p>
        {!signedIn && (
          <div className="mt-10 flex justify-center gap-3">
            <Button asChild size="lg" className="rounded-full px-8 shadow-lg shadow-brand/30">
              <Link href="/login">
                <Play className="h-5 w-5 fill-current" /> Đăng nhập
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-8">
              <Link href="/register">Tạo tài khoản</Link>
            </Button>
          </div>
        )}

        <div className="mt-20 grid gap-4 text-left sm:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-token-lg border border-white/5 bg-white/[0.03] p-5 backdrop-blur"
            >
              <Icon className="h-5 w-5 text-brand" />
              <h3 className="mt-3 font-semibold text-content">{title}</h3>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
