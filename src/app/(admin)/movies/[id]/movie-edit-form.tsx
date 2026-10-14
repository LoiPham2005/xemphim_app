"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile } from "@/lib/upload-client";
import { Button } from "@/components/ui/button";
import type { GenreSummary, ManagedMovie } from "@/services/movie.service";
import { updateMovieAction } from "../actions";
import {
  FILE_INPUT_CLASS,
  MovieInfoFields,
  UploadStatus,
  readMovieInfo,
} from "../movie-info-fields";

/** Sửa thông tin phim. Chọn poster mới thì tải lên trước rồi gửi id; bỏ trống = giữ poster cũ. */
export function MovieEditForm({ movie, genres }: { movie: ManagedMovie; genres: GenreSummary[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const poster = form.get("poster");
    setError(null);
    setSaved(false);

    try {
      let posterFileId: string | undefined;
      if (poster instanceof File && poster.size > 0) {
        setStatus("Đang tải poster...");
        setProgress(0);
        posterFileId = (await uploadFile(poster, { folder: "posters", onProgress: setProgress }))
          .id;
      }

      setStatus("Đang lưu...");
      setProgress(null);
      const result = await updateMovieAction(movie.id, { ...readMovieInfo(form), posterFileId });
      if (result.error) throw new Error(result.error);

      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lưu thất bại");
    } finally {
      setStatus(null);
      setProgress(null);
    }
  }

  const busy = status !== null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <MovieInfoFields
        genres={genres}
        disabled={busy}
        defaults={{ ...movie, genreIds: movie.genres.map((genre) => genre.id) }}
      />
      <label className="flex flex-col gap-1 text-sm">
        Đổi poster (bỏ trống = giữ poster cũ)
        <input
          name="poster"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          className={FILE_INPUT_CLASS}
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Đang lưu..." : "Lưu thay đổi"}
        </Button>
        {saved && <span className="text-sm text-success">Đã lưu.</span>}
      </div>
      <UploadStatus status={status} progress={progress} error={error} />
    </form>
  );
}
