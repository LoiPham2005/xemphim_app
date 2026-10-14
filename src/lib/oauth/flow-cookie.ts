import "server-only";
import { cookies } from "next/headers";
import { isProduction } from "@/lib/env";
import type { OAuthProviderId } from "./types";

/**
 * Trạng thái tạm giữa bước `start` (redirect sang provider) và `callback`
 * (provider redirect ngược lại): provider nào, `state` để đối chiếu chống
 * CSRF, `codeVerifier` cho PKCE (không phải provider nào cũng cần), và
 * `next` — trang muốn quay lại sau khi đăng nhập xong.
 *
 * Gộp một cookie JSON thay vì ba cookie rời: callback luôn cần đọc cả ba cùng
 * lúc, và gộp lại thì không có chuyện đọc được `state` nhưng thiếu
 * `codeVerifier` do cookie kia bị trình duyệt/proxy nào đó chặn riêng.
 */
type OAuthFlowState = {
  provider: OAuthProviderId;
  state: string;
  codeVerifier?: string;
  next: string;
};

const COOKIE_NAME = "oauth_flow";

/** 10 phút — đủ để người dùng đăng nhập ở phía provider, ngắn để giảm cửa sổ replay. */
const MAX_AGE_SECONDS = 10 * 60;

export async function setOAuthFlowCookie(flow: OAuthFlowState): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, JSON.stringify(flow), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Đọc VÀ xoá cookie — state một lần dùng, dùng lại là dấu hiệu replay. */
export async function consumeOAuthFlowCookie(): Promise<OAuthFlowState | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  store.delete(COOKIE_NAME);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as OAuthFlowState;
  } catch {
    return null;
  }
}
