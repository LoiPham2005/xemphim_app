"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadFile } from "@/lib/upload-client";
import { Button } from "@/components/ui/button";

/**
 * Tải tệp lên thư viện. `retain: true`: tệp tải từ thư viện không gắn vào bản ghi nào, thiếu cờ này
 * thì bị dọn sau 24 giờ.
 */
export function FileUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);

    for (const [index, file] of [...files].entries()) {
      setStatus(`Đang tải ${index + 1}/${files.length}: ${file.name}`);
      setProgress(0);
      try {
        await uploadFile(file, { retain: true, onProgress: setProgress });
      } catch (cause) {
        setError(`${file.name}: ${cause instanceof Error ? cause.message : "tải lên thất bại"}`);
        break;
      }
    }

    setStatus(null);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  const busy = status !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Đang tải lên..." : "Chọn tệp để tải lên"}
        </Button>
        <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Ảnh 5MB · Tài liệu (PDF, Word, Excel, PowerPoint) 20MB · Âm thanh 50MB · Video 4GB
        </span>
      </div>

      {busy && (
        <div>
          <div style={{ fontSize: "0.9rem", marginBottom: 6 }}>{status}</div>
          <progress max={1} value={progress ?? 0} style={{ width: "100%" }} />
        </div>
      )}
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
