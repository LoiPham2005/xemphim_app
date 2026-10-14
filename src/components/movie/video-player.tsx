"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { API_PREFIX } from "@/lib/api/version";
import { formatDuration } from "@/lib/format";

/** Gửi vị trí bao lâu một lần khi đang phát. Mất điện giữa chừng thì lệch tối đa chừng này. */
const REPORT_INTERVAL_MS = 15_000;
/** Dưới mốc này chưa coi là "đã xem" — tránh ghi đè tiến độ cũ bằng 0 khi vừa mở trang đã thoát. */
const MIN_REPORT_SECONDS = 3;

/**
 * Trình phát có "xem tiếp": mở ra thì tua tới `startAt`, trong lúc xem thì báo vị trí về
 * `POST /api/v1/watch-history` (cùng endpoint app mobile dùng).
 *
 * Báo vào lúc: mỗi 15 giây khi đang phát, khi tạm dừng, khi hết tập, khi tab bị ẩn, và khi rời
 * trang/đổi tập. Hai trường hợp cuối dùng `fetch(..., { keepalive: true })` — request vẫn đi dù trang
 * đang đóng (thay cho `sendBeacon`, vốn không gửi được `Content-Type: application/json`).
 */
export function VideoPlayer({
  src,
  poster,
  episodeId,
  startAt,
}: {
  src: string;
  poster?: string;
  episodeId: string;
  startAt: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let lastSent = -1;
    const report = () => {
      const duration = Math.floor(video.duration);
      const position = video.ended ? duration : Math.floor(video.currentTime);
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (position < MIN_REPORT_SECONDS || position === lastSent) return;
      lastSent = position;

      void fetch(`${API_PREFIX}/watch-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId, positionSeconds: position, durationSeconds: duration }),
        keepalive: true,
      }).catch(() => {
        // Mất mạng thì bỏ qua — lần báo sau sẽ ghi đè, mất vài giây tiến độ không đáng làm phiền người xem.
      });
    };

    const seekToStart = () => {
      // Chừa 5 giây cuối: tua sát đuôi thì video kết thúc ngay khi vừa mở.
      if (startAt > 0 && startAt < video.duration - 5) {
        video.currentTime = startAt;
        setResumedFrom(startAt);
      }
    };
    if (video.readyState >= 1) seekToStart();
    else video.addEventListener("loadedmetadata", seekToStart, { once: true });

    const timer = window.setInterval(() => {
      if (!video.paused) report();
    }, REPORT_INTERVAL_MS);
    const onHidden = () => {
      if (document.visibilityState === "hidden") report();
    };

    video.addEventListener("pause", report);
    video.addEventListener("ended", report);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", report);

    return () => {
      // Đổi tập bằng link trong app thì component bị gỡ — báo lần cuối trước khi đi.
      report();
      window.clearInterval(timer);
      video.removeEventListener("loadedmetadata", seekToStart);
      video.removeEventListener("pause", report);
      video.removeEventListener("ended", report);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", report);
    };
  }, [episodeId, startAt]);

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play();
    setResumedFrom(null);
  };

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={src}
        controls
        autoPlay
        preload="metadata"
        playsInline
        poster={poster}
        className="aspect-video max-h-[80vh] w-full bg-black"
      />
      {resumedFrom !== null && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/75 py-1 pl-3 pr-1 text-xs text-white backdrop-blur">
          Đang xem tiếp từ {formatDuration(resumedFrom)}
          <button
            type="button"
            onClick={restart}
            className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 font-semibold transition-colors hover:bg-white/25"
          >
            <RotateCcw className="h-3 w-3" /> Xem từ đầu
          </button>
        </div>
      )}
    </div>
  );
}
