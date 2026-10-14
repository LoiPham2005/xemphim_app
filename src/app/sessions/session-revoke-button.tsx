"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { revokeSessionAction } from "./actions";

export function SessionRevokeButton({ sessionId, label }: { sessionId: string; label: string }) {
  const [isPending, startTransition] = useTransition();

  const handleRevoke = () => {
    if (typeof window === "undefined") return;

    // Hỏi lại vì thao tác này KHÔNG hoàn tác được: thiết bị kia bị đăng xuất
    // ngay lập tức và phải nhập lại mật khẩu.
    if (!window.confirm(`Đăng xuất khỏi ${label}?`)) return;

    startTransition(async () => {
      const res = await revokeSessionAction(sessionId);
      if (res.error) window.alert(`Lỗi: ${res.error}`);
    });
  };

  return (
    <Button type="button" onClick={handleRevoke} disabled={isPending} variant="outline" size="sm">
      {isPending ? "Đang xử lý…" : "Đăng xuất"}
    </Button>
  );
}
