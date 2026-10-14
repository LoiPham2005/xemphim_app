"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteEpisodeAction } from "../actions";

export function EpisodeDeleteButton({ id, label }: { id: string; label: string }) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!window.confirm(`Xoá ${label}? Video sẽ bị xoá khỏi kho, không khôi phục được.`)) return;
    startTransition(async () => {
      const res = await deleteEpisodeAction(id);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
    });
  };

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      disabled={isPending}
      onClick={handleDelete}
      title={`Xoá ${label}`}
    >
      <Trash2 className="h-4 w-4" />
      <span className="sr-only">Xoá {label}</span>
    </Button>
  );
}
