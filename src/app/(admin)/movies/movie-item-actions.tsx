"use client";

import { useTransition } from "react";
import { deleteMovieAction, setMoviePublishedAction } from "./actions";
import { Button } from "@/components/ui/button";

export function MovieItemActions({
  id,
  title,
  published,
}: {
  id: string;
  title: string;
  published: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(async () => {
      const res = await setMoviePublishedAction(id, !published);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
    });
  };

  const handleDelete = () => {
    if (!window.confirm(`Xoá phim "${title}"? Video sẽ bị xoá khỏi kho, không khôi phục được.`))
      return;
    startTransition(async () => {
      const res = await deleteMovieAction(id);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant={published ? "outline" : "default"}
        disabled={isPending}
        onClick={handleToggle}
      >
        {published ? "Ẩn" : "Xuất bản"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={isPending}
        onClick={handleDelete}
      >
        {isPending ? "Đang xử lý..." : "Xoá"}
      </Button>
    </div>
  );
}
