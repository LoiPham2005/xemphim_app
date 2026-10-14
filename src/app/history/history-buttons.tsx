"use client";

import { useTransition } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearHistoryAction, removeHistoryItemAction } from "./actions";

export function RemoveHistoryButton({ movieId, title }: { movieId: string; title: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      title={`Xoá "${title}" khỏi lịch sử`}
      onClick={() =>
        startTransition(async () => {
          const res = await removeHistoryItemAction(movieId);
          if (res.error) window.alert(`Lỗi: ${res.error}`);
        })
      }
      className="absolute right-2 top-2 z-10 rounded-full bg-black/70 p-1.5 text-white opacity-0 backdrop-blur transition-opacity hover:bg-danger group-hover:opacity-100 focus-visible:opacity-100"
    >
      <X className="h-3.5 w-3.5" />
      <span className="sr-only">Xoá khỏi lịch sử</span>
    </button>
  );
}

export function ClearHistoryButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="rounded-full"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm("Xoá toàn bộ lịch sử xem?")) return;
        startTransition(async () => {
          const res = await clearHistoryAction();
          if (res.error) window.alert(`Lỗi: ${res.error}`);
        });
      }}
    >
      <Trash2 className="h-4 w-4" /> Xoá tất cả
    </Button>
  );
}
