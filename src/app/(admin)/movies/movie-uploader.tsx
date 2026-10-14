"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile } from "@/lib/upload-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GenreSummary } from "@/services/movie.service";
import { createMovieAction } from "./actions";
import {
  FILE_INPUT_CLASS,
  MovieInfoFields,
  UploadStatus,
  readMovieInfo,
} from "./movie-info-fields";

/**
 * Đăng phim mới kèm tập 1: tải poster (qua máy chủ) và video (thẳng lên kho) TRƯỚC, rồi mới gửi id hai
 * tệp kèm thông tin phim cho Server Action. Bỏ dở giữa chừng thì tệp đã tải thành mồ côi và tự dọn
 * sau 24 giờ. Tập 2, 3... của phim bộ thêm ở trang quản lý từng phim.
 */
export function MovieUploader({ genres }: { genres: GenreSummary[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const video = form.get("video");
    const poster = form.get("poster");
    if (!(video instanceof File) || video.size === 0) {
      setError("Chọn tệp video");
      return;
    }
    setError(null);

    try {
      let posterFileId: string | undefined;
      if (poster instanceof File && poster.size > 0) {
        setStatus("Đang tải poster...");
        setProgress(0);
        posterFileId = (await uploadFile(poster, { folder: "posters", onProgress: setProgress }))
          .id;
      }

      setStatus(`Đang tải video: ${video.name}`);
      setProgress(0);
      const videoFile = await uploadFile(video, { folder: "movies", onProgress: setProgress });

      setStatus("Đang lưu phim...");
      setProgress(null);
      const result = await createMovieAction({
        ...readMovieInfo(form),
        episodeTitle: form.get("episodeTitle"),
        videoFileId: videoFile.id,
        posterFileId,
      });
      if (result.error) throw new Error(result.error);

      formRef.current?.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Đăng phim thất bại");
    } finally {
      setStatus(null);
      setProgress(null);
    }
  }

  const busy = status !== null;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <MovieInfoFields genres={genres} disabled={busy} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Video tập 1 * (MP4/WebM/MOV, tối đa 4GB)
          <input
            name="video"
            type="file"
            required
            accept="video/mp4,video/webm,video/quicktime"
            disabled={busy}
            className={FILE_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Poster (JPG/PNG/WebP, tối đa 5MB)
          <input
            name="poster"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            className={FILE_INPUT_CLASS}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Tên tập 1 (tuỳ chọn, dành cho phim bộ)
        <Input name="episodeTitle" maxLength={200} disabled={busy} />
      </label>

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Đang xử lý..." : "Đăng phim"}
        </Button>
      </div>

      <UploadStatus status={status} progress={progress} error={error} />
    </form>
  );
}
