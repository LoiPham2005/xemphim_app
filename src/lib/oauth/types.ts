/**
 * Bốn provider hỗ trợ. Union cứng — thêm provider mới bắt buộc phải cập nhật
 * `PROVIDERS` trong `config.ts`, TypeScript sẽ bắt lỗi mọi chỗ code còn thiếu.
 */
export const OAUTH_PROVIDERS = ["google", "github", "facebook", "apple"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Hồ sơ đã chuẩn hoá, giống nhau bất kể provider nào — phần còn lại của hệ
 * thống (route callback, `oauthService`) không cần biết Google khác Github ở
 * đâu.
 */
export type OAuthProfile = {
  provider: OAuthProviderId;
  providerAccountId: string;
  /** null nếu provider không trả email (vd Github ẩn email) hoặc chưa xác thực. */
  email: string | null;
  fullName: string | null;
};

export class OAuthProviderNotConfiguredError extends Error {
  constructor(readonly provider: OAuthProviderId) {
    super(`Đăng nhập bằng ${provider} chưa được cấu hình`);
    this.name = "OAuthProviderNotConfiguredError";
  }
}

export class OAuthStateMismatchError extends Error {
  constructor() {
    super("Phiên đăng nhập OAuth không hợp lệ hoặc đã hết hạn");
    this.name = "OAuthStateMismatchError";
  }
}

export class OAuthEmailRequiredError extends Error {
  constructor(readonly provider: OAuthProviderId) {
    super(
      `Tài khoản ${provider} của bạn không có email đã xác thực để liên kết. ` +
        `Vui lòng công khai/xác thực email trên ${provider} rồi thử lại.`,
    );
    this.name = "OAuthEmailRequiredError";
  }
}

export class OAuthExchangeError extends Error {
  constructor(provider: OAuthProviderId, cause?: unknown) {
    super(`Không đăng nhập được bằng ${provider}. Vui lòng thử lại.`);
    this.name = "OAuthExchangeError";
    this.cause = cause;
  }
}
