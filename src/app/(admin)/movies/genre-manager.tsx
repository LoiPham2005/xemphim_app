"use client";

import { useRef, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GenreSummary } from "@/services/movie.service";
import { createGenreAction, deleteGenreAction } from "./actions";

/** Thêm/xoá thể loại. Xoá thể loại chỉ gỡ nhãn khỏi các phim, không xoá phim. */
export function GenreManager({ genres }: { genres: GenreSummary[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  const handleAdd = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = inputRef.current?.value.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createGenreAction(name);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
      else if (inputRef.current) inputRef.current.value = "";
    });
  };

  const handleDelete = (genre: GenreSummary) => {
    if (!window.confirm(`Xoá thể loại "${genre.name}"? Các phim chỉ bị gỡ nhãn này.`)) return;
    startTransition(async () => {
      const res = await deleteGenreAction(genre.id);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {genres.map((genre) => (
          <span
            key={genre.id}
            className="inline-flex items-center gap-1 rounded-full border border-line py-1 pl-3 pr-1 text-sm"
          >
            {genre.name}
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleDelete(genre)}
              title={`Xoá thể loại ${genre.name}`}
              className="rounded-full p-1 text-muted transition-colors hover:bg-elevated hover:text-danger"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={handleAdd} className="flex max-w-sm gap-2">
        <Input ref={inputRef} name="name" placeholder="Thể loại mới..." maxLength={50} />
        <Button type="submit" variant="secondary" disabled={isPending}>
          Thêm
        </Button>
      </form>
    </div>
  );
}
