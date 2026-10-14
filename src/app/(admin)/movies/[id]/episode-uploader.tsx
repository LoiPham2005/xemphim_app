"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile } from "@/lib/upload-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addEpisodeAction } from "../actions";
import { FILE_INPUT_CLASS, UploadStatus } from "../movie-info-fields";

/** Tải TẬP TIẾP THEO của phim bộ: video thẳng lên kho, rồi báo máy chủ gắn vào phim (số tập tự tăng). */
export function EpisodeUploader({ movieId, nextNumber }: { movieId: string; nextNumber: number }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const video = form.get("video");
    if (!(video instanceof File) || video.size === 0) {
      setError("Chọn tệp video");
      return;
    }
    setError(null);

    try {
      setStatus(`Đang tải video tập ${nextNumber}: ${video.name}`);
      setProgress(0);
      const videoFile = await uploadFile(video, { folder: "movies", onProgress: setProgress });

      setStatus("Đang lưu tập...");
      setProgress(null);
      const result = await addEpisodeAction(movieId, {
        videoFileId: videoFile.id,
        title: form.get("title"),
      });
      if (result.error) throw new Error(result.error);

      formRef.current?.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Thêm tập thất bại");
    } finally {
      setStatus(null);
      setProgress(null);
    }
  }

  const busy = status !== null;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Video tập {nextNumber} * (tối đa 4GB)
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
          Tên tập (tuỳ chọn)
          <Input name="title" maxLength={200} disabled={busy} />
        </label>
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Đang xử lý..." : `Thêm tập ${nextNumber}`}
        </Button>
      </div>
      <UploadStatus status={status} progress={progress} error={error} />
    </form>
  );
}
