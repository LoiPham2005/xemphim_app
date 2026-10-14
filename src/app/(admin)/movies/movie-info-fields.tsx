"use client";

import { Input } from "@/components/ui/input";
import { MOVIE_TYPES, MOVIE_TYPE_LABELS, type MovieType } from "@/schemas/movie.schema";
import type { GenreSummary } from "@/services/movie.service";

export type MovieInfoDefaults = {
  title?: string;
  description?: string | null;
  releaseYear?: number | null;
  type?: MovieType;
  genreIds?: string[];
};

/** Đọc phần thông tin chung từ form — khớp tên trường với `MovieInfoFields`. */
export function readMovieInfo(form: FormData) {
  return {
    title: form.get("title"),
    description: form.get("description"),
    releaseYear: form.get("releaseYear"),
    type: form.get("type"),
    genreIds: form.getAll("genreIds"),
  };
}

/** Ô nhập thông tin phim — dùng chung cho form đăng phim mới và form sửa phim. */
export function MovieInfoFields({
  genres,
  defaults = {},
  disabled,
}: {
  genres: GenreSummary[];
  defaults?: MovieInfoDefaults;
  disabled?: boolean;
}) {
  const selected = new Set(defaults.genreIds ?? []);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_140px_160px]">
        <label className="flex flex-col gap-1 text-sm">
          Tên phim *
          <Input
            name="title"
            required
            maxLength={200}
            defaultValue={defaults.title}
            disabled={disabled}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Năm phát hành
          <Input
            name="releaseYear"
            type="number"
            min={1888}
            max={2100}
            defaultValue={defaults.releaseYear ?? undefined}
            disabled={disabled}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Loại phim *
          <select
            name="type"
            defaultValue={defaults.type ?? "SINGLE"}
            disabled={disabled}
            className="h-10 rounded-md border border-line bg-canvas px-3 text-content"
          >
            {MOVIE_TYPES.map((type) => (
              <option key={type} value={type}>
                {MOVIE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Mô tả
        <textarea
          name="description"
          rows={3}
          maxLength={5000}
          defaultValue={defaults.description ?? undefined}
          disabled={disabled}
          className="rounded-md border border-line bg-transparent px-3 py-2"
        />
      </label>

      {genres.length > 0 && (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-2">Thể loại</legend>
          <div className="flex flex-wrap gap-2">
            {genres.map((genre) => (
              <label key={genre.id} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="genreIds"
                  value={genre.id}
                  defaultChecked={selected.has(genre.id)}
                  disabled={disabled}
                  className="peer sr-only"
                />
                <span className="inline-block rounded-full border border-line px-3 py-1 text-muted transition-colors peer-checked:border-brand peer-checked:bg-brand/15 peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/60">
                  {genre.name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

/** Ô chọn tệp đã tạo kiểu — Tailwind `file:` để nút "Choose File" khớp giao diện tối. */
export const FILE_INPUT_CLASS =
  "block w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-elevated file:px-4 file:py-2 file:text-sm file:font-medium file:text-content hover:file:bg-line";

/** Trạng thái tải lên: dòng chữ + thanh tiến độ + lỗi. */
export function UploadStatus({
  status,
  progress,
  error,
}: {
  status: string | null;
  progress: number | null;
  error: string | null;
}) {
  return (
    <>
      {status && (
        <div>
          <div className="mb-1.5 text-sm">{status}</div>
          {progress !== null && <progress max={1} value={progress} className="w-full" />}
        </div>
      )}
      {error && <div className="alert alert-danger">{error}</div>}
    </>
  );
}
