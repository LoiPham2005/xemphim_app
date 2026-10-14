import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { exchangeCodeForToken } from "@/lib/oauth/client";
import { consumeOAuthFlowCookie } from "@/lib/oauth/flow-cookie";
import { fetchOAuthProfile, type AppleFormPostUser } from "@/lib/oauth/profile";
import { AccountBannedError, InvalidCredentialsError } from "@/lib/errors";
import {
  OAuthEmailRequiredError,
  OAuthExchangeError,
  OAuthProviderNotConfiguredError,
  OAuthStateMismatchError,
  isOAuthProviderId,
} from "@/lib/oauth/types";
import { oauthService } from "@/services/oauth.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

type CallbackPayload = {
  code?: string;
  state?: string;
  /** `error=access_denied` khi người dùng bấm Huỷ ở màn hình consent của provider. */
  error?: string;
  /** Chỉ Apple gửi, và CHỈ trong lần cấp quyền đầu tiên — xem `profile.ts`. */
  appleUser?: AppleFormPostUser;
};

/**
 * Mã lỗi ngắn gắn vào `?oauthError=` để trang /login hiển thị thông báo phù
 * hợp — không đi qua `handleApiError`/JSON vì đây là luồng redirect trình
 * duyệt, không phải API cho mobile.
 */
function errorCode(error: unknown): string {
  if (error instanceof OAuthStateMismatchError) return "state_mismatch";
  if (error instanceof OAuthEmailRequiredError) return "email_required";
  if (error instanceof OAuthProviderNotConfiguredError) return "not_configured";
  if (error instanceof OAuthExchangeError) return "exchange_failed";
  if (error instanceof AccountBannedError) return "banned";
  if (error instanceof InvalidCredentialsError) return "account_unavailable";
  return "unknown";
}

async function handleCallback(
  request: Request,
  provider: string,
  payload: CallbackPayload,
): Promise<NextResponse> {
  if (!isOAuthProviderId(provider)) {
    return NextResponse.redirect(new URL("/login?oauthError=invalid_provider", request.url));
  }

  // Người dùng tự huỷ ở màn hình consent — không phải lỗi, không log.
  if (payload.error) {
    return NextResponse.redirect(
      new URL(`/login?oauthError=${encodeURIComponent(payload.error)}`, request.url),
    );
  }

  const flow = await consumeOAuthFlowCookie();

  try {
    if (!flow || flow.provider !== provider || !payload.state || flow.state !== payload.state) {
      throw new OAuthStateMismatchError();
    }
    if (!payload.code) throw new OAuthStateMismatchError();

    const tokens = await exchangeCodeForToken(provider, payload.code, flow.codeVerifier);
    const profile = await fetchOAuthProfile(provider, tokens, payload.appleUser);
    const user = await oauthService.loginWithProfile(profile);

    await createSession({ typ: "access", sub: user.id, email: user.email, roles: user.roles });
    logger.info("OAuth login", { userId: user.id, provider });

    return NextResponse.redirect(new URL(flow.next, request.url));
  } catch (error) {
    const code = errorCode(error);
    if (code === "unknown") {
      logger.error("OAuth callback thất bại", error, { provider });
    } else {
      logger.warn("OAuth callback bị từ chối", { provider, code });
    }
    return NextResponse.redirect(new URL(`/login?oauthError=${code}`, request.url));
  }
}

/** Google, Github, Facebook — provider redirect ngược lại bằng GET kèm query string. */
export async function GET(request: Request, { params }: RouteContext) {
  const { provider } = await params;
  const url = new URL(request.url);

  return handleCallback(request, provider, {
    code: url.searchParams.get("code") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
  });
}

/** Apple bắt buộc `response_mode=form_post` khi xin scope name/email — xem `config.ts`. */
export async function POST(request: Request, { params }: RouteContext) {
  const { provider } = await params;
  const form = await request.formData();

  const rawUser = form.get("user");
  let appleUser: AppleFormPostUser | undefined;
  if (typeof rawUser === "string") {
    try {
      appleUser = JSON.parse(rawUser) as AppleFormPostUser;
    } catch {
      appleUser = undefined;
    }
  }

  const code = form.get("code");
  const state = form.get("state");
  const error = form.get("error");

  return handleCallback(request, provider, {
    code: typeof code === "string" ? code : undefined,
    state: typeof state === "string" ? state : undefined,
    error: typeof error === "string" ? error : undefined,
    appleUser,
  });
}
