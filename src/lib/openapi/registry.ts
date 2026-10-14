import "server-only";
import { z } from "zod";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  verifyTwoFactorSchema,
  confirmTwoFactorSchema,
  disableTwoFactorSchema,
  requestEmailChangeSchema,
  confirmEmailChangeSchema,
  requestPhoneOtpSchema,
  verifyPhoneOtpSchema,
  registerPasskeySchema,
  loginPasskeySchema,
  renamePasskeySchema,
} from "@/schemas/auth.schema";
import {
  createUserSchema,
  updateUserSchema,
  setUserStatusSchema,
  publicUserSchema,
  assignRolesSchema,
  setUserPermissionSchema,
} from "@/schemas/user.schema";
import { createRoleSchema, updateRoleSchema } from "@/schemas/role.schema";
import { sendNotificationSchema, registerDeviceSchema } from "@/schemas/notification.schema";
import { API_PREFIX } from "@/lib/api/version";
import { FILE_KINDS, createUploadSchema, renameFileSchema } from "@/schemas/file.schema";
import {
  MOVIE_TYPES,
  addEpisodeSchema,
  createGenreSchema,
  createMovieSchema,
  setMoviePublishedSchema,
  updateMovieSchema,
} from "@/schemas/movie.schema";

/**
 * Đặc tả OpenAPI cho toàn bộ REST API mobile (`/api/v1/**`).
 *
 * Tái dùng THẲNG các Zod schema đã có trong `src/schemas/*.ts` — không định
 * nghĩa lại. Đây chính là bài học từ `src/types/api.ts` đã xoá trước đó: 2 nơi
 * mô tả cùng 1 hợp đồng thì sớm muộn cũng lệch nhau, một nơi thì không thể.
 *
 * ---
 * VÌ SAO KHÔNG DÙNG `@asteasolutions/zod-to-openapi`
 *
 * Thư viện đó gắn `.openapi()` vào `ZodType.prototype` bằng một module chỉ có
 * side effect, và đòi module ấy chạy TRƯỚC khi bất kỳ schema nào được tạo.
 * Điều kiện đó không giữ được: Turbopack đánh giá `src/schemas/*` trước module
 * vá khi gom bundle production, nên `next dev` và `vitest` chạy đúng còn
 * `next build` thì đổ với `t.openapi is not a function` — kiểu lỗi chỉ lộ ra ở
 * bước cuối cùng trước khi deploy.
 *
 * Zod 4 đã có `z.toJSONSchema()` dựng sẵn nên không cần thư viện đó nữa: bớt
 * một dependency 78KB, bớt một lần vá prototype, và thứ tự nạp module không
 * còn ảnh hưởng gì.
 */

// ---------------------------------------------------------------------------
// Đặt tên cho schema
// ---------------------------------------------------------------------------

/*
 * VÌ SAO PHẢI ĐẶT TÊN
 *
 * Schema viết thẳng (inline) vào từng endpoint vẫn cho ra đặc tả đúng, nhưng
 * nó KHÔNG có tên. Công cụ sinh code phía client buộc phải bịa tên từ method
 * và đường dẫn, và kết quả rất khó đọc:
 *
 *     AuthLoginPostRequest          ← inline
 *     AuthMeGet200ResponseUser      ← inline
 *     RolesKeyPatchRequest          ← inline
 *
 * Đặt tên thì client nhận `LoginRequest`, `UserResponse`, `UpdateRoleRequest`.
 * Sửa MỘT lần ở đây, mọi ngôn ngữ client đều hưởng — Dart, TypeScript, Kotlin,
 * Swift. Đó là lý do việc này thuộc về backend chứ không phải từng client tự
 * đổi tên sau khi sinh (đổi tay thì lần sinh sau lại mất).
 *
 * ⚠️ Tên là HỢP ĐỒNG công khai. Đổi tên = breaking change với client đã sinh
 * code. Đặt tên cẩn thận ngay từ đầu.
 */

type Meta = { id: string };

/*
 * Hai sổ đăng ký tách biệt vì cùng một Zod schema cho ra HAI hình dạng JSON
 * khác nhau: `z.coerce.date()` ở đầu vào là chuỗi, ở đầu ra là Date; field có
 * `.default()` ở đầu vào là optional, ở đầu ra thì luôn có. Gộp một sổ là buộc
 * phải nói dối một trong hai chiều.
 */
const inputSchemas = z.registry<Meta>();
const outputSchemas = z.registry<Meta>();

/** schema → tên đã đăng ký. Tra ngược để `ref()` không phải nhận chuỗi. */
const schemaNames = new Map<z.ZodType, string>();

function named<T extends z.ZodType>(id: string, schema: T, io: "input" | "output" = "output"): T {
  (io === "input" ? inputSchemas : outputSchemas).add(schema, { id });
  schemaNames.set(schema, id);
  return schema;
}

/**
 * `$ref` tới một schema đã đặt tên.
 *
 * Nhận chính schema chứ không nhận chuỗi tên: gõ sai `ref(userSchema)` thì
 * TypeScript báo ngay, còn gõ sai `ref("Usr")` thì phải tự đọc JSON mới thấy.
 */
function ref(schema: z.ZodType) {
  const id = schemaNames.get(schema);
  if (!id) throw new Error("Schema chưa được đặt tên — gọi named() trước khi ref()");
  return { $ref: `#/components/schemas/${id}` };
}

// ---------------------------------------------------------------------------
// Response chung
// ---------------------------------------------------------------------------

const apiErrorSchema = named(
  "ApiError",
  z.object({
    error: z.object({
      /** Client nên switch theo trường này, KHÔNG phải theo `message`. */
      code: z.string(),
      message: z.string(),
      fields: z.record(z.string(), z.array(z.string())).optional(),
    }),
  }),
);

const ERROR_LABELS: Record<number, string> = {
  401: "Chưa đăng nhập / token sai hoặc hết hạn",
  403: "Không đủ quyền",
  404: "Không tìm thấy tài nguyên",
  409: "Xung đột (email/username đã tồn tại, tự thao tác lên chính mình...)",
  422: "Dữ liệu gửi lên không hợp lệ",
  423: "Tài khoản đang khoá tạm do sai mật khẩu liên tiếp",
  429: "Vượt rate limit",
};

function errorResponses(...statuses: (401 | 403 | 404 | 409 | 422 | 423 | 429)[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description: ERROR_LABELS[status],
        content: { "application/json": { schema: ref(apiErrorSchema) } },
      },
    ]),
  );
}

function okResponse(envelopeSchema: z.ZodType, description = "Thành công") {
  return { 200: { description, content: { "application/json": { schema: ref(envelopeSchema) } } } };
}

/**
 * Đăng ký một envelope `{ data: ... }` có TÊN.
 *
 * ---
 * VÌ SAO LỚP BỌC PHẢI CÓ TRONG ĐẶC TẢ
 *
 * `apiOk()` luôn trả `{ "data": ... }` (xem `src/lib/api/response.ts`), nhưng
 * một bản trước từng khai schema THẲNG là kiểu bên trong. Đặc tả nói body là
 * `TokenPair`, còn server thật sự trả `{ data: TokenPair }`.
 *
 * Hậu quả: mọi client sinh tự động — Dart, TypeScript, Kotlin — đều giải mã
 * hỏng, kèm thông báo cực khó truy vì nó chỉ nói một trường nào đó bị null:
 *
 *     Tried to construct class "User" with null for non-nullable field "id"
 *
 * Không lỗi nào phía backend phát hiện được: unit test gọi thẳng service, còn
 * trang tài liệu chỉ hiển thị lại chính đặc tả sai đó. Nó chỉ lộ ra khi một
 * client THẬT giải mã response THẬT.
 *
 * ---
 * VÌ SAO ĐẶT TÊN VÀ DÙNG LẠI
 *
 * Envelope viết inline khiến công cụ sinh code bịa tên theo đường dẫn:
 * `AuthLoginPost200Response`, `UsersIdGet200Response`… Đặt tên một lần rồi
 * dùng lại cho mọi endpoint cùng hình dạng thì 7 endpoint trả về user dùng
 * CHUNG một kiểu, thay vì 7 kiểu giống hệt nhau.
 */
function envelope(name: string, dataSchema: z.ZodType) {
  return named(name, z.object({ data: dataSchema }));
}

// ---------------------------------------------------------------------------
// Schema có tên
// ---------------------------------------------------------------------------

const userSchema = named("User", publicUserSchema);

const loginRequest = named("LoginRequest", loginSchema, "input");
const registerRequest = named("RegisterRequest", registerSchema, "input");
const refreshRequest = named("RefreshRequest", z.object({ refreshToken: z.string() }), "input");
const changePasswordRequest = named("ChangePasswordRequest", changePasswordSchema, "input");
const forgotPasswordRequest = named("ForgotPasswordRequest", forgotPasswordSchema, "input");
const resetPasswordRequest = named("ResetPasswordRequest", resetPasswordSchema, "input");
const verifyEmailRequest = named("VerifyEmailRequest", verifyEmailSchema, "input");

const createUserRequest = named("CreateUserRequest", createUserSchema, "input");
const updateUserRequest = named("UpdateUserRequest", updateUserSchema, "input");
const updateUserStatusRequest = named("UpdateUserStatusRequest", setUserStatusSchema, "input");

const verifyTwoFactorRequest = named("VerifyTwoFactorRequest", verifyTwoFactorSchema, "input");
const confirmTwoFactorRequest = named("ConfirmTwoFactorRequest", confirmTwoFactorSchema, "input");
const disableTwoFactorRequest = named("DisableTwoFactorRequest", disableTwoFactorSchema, "input");
const requestEmailChangeRequest = named(
  "RequestEmailChangeRequest",
  requestEmailChangeSchema,
  "input",
);
const confirmEmailChangeRequest = named(
  "ConfirmEmailChangeRequest",
  confirmEmailChangeSchema,
  "input",
);
const requestPhoneOtpRequest = named("RequestPhoneOtpRequest", requestPhoneOtpSchema, "input");
const verifyPhoneOtpRequest = named("VerifyPhoneOtpRequest", verifyPhoneOtpSchema, "input");
const registerPasskeyRequest = named("RegisterPasskeyRequest", registerPasskeySchema, "input");
const loginPasskeyRequest = named("LoginPasskeyRequest", loginPasskeySchema, "input");
const renamePasskeyRequest = named("RenamePasskeyRequest", renamePasskeySchema, "input");
const assignRolesRequest = named("AssignRolesRequest", assignRolesSchema, "input");
const setUserPermissionRequest = named(
  "SetUserPermissionRequest",
  setUserPermissionSchema,
  "input",
);
const sendNotificationRequest = named("SendNotificationRequest", sendNotificationSchema, "input");
const registerDeviceRequest = named("RegisterDeviceRequest", registerDeviceSchema, "input");

const createRoleRequest = named("CreateRoleRequest", createRoleSchema, "input");
const updateRoleRequest = named("UpdateRoleRequest", updateRoleSchema, "input");

const emptyResponse = envelope("EmptyResponse", z.object({}));
const userResponse = envelope("UserResponse", z.object({ user: userSchema }));
const idResponse = envelope("IdResponse", z.object({ id: z.string() }));

const tokenPairSchema = named(
  "TokenPair",
  z.object({
    user: userSchema,
    accessToken: z.string(),
    expiresIn: z.number().int(),
    tokenType: z.literal("Bearer"),
    refreshToken: z.string(),
    refreshExpiresAt: z.iso.datetime(),
    /**
     * Id phiên vừa cấp (`familyId`). Không phải bí mật. Client lưu lại để đánh
     * dấu "thiết bị này" trên `GET /auth/sessions`. KHÔNG đổi qua các lần
     * refresh, nên lưu một lần là đủ.
     */
    sessionId: z.string(),
  }),
);
const tokenResponse = envelope("TokenResponse", tokenPairSchema);

const sessionSchema = named(
  "Session",
  z.object({
    /** Đối chiếu với `sessionId` nhận lúc đăng nhập/refresh. */
    id: z.string(),
    userAgent: z.string().nullable(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
);
const sessionsResponse = envelope(
  "SessionsResponse",
  z.object({ sessions: z.array(sessionSchema) }),
);

const paginationMetaSchema = named(
  "PaginationMeta",
  z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
    hasNext: z.boolean(),
  }),
);
const usersListResponse = envelope(
  "UsersListResponse",
  z.object({ items: z.array(userSchema), meta: paginationMetaSchema }),
);

/**
 * Hình dạng vai trò trả ra ngoài.
 *
 * Viết riêng thay vì suy ra từ `createRoleSchema`: schema đầu vào và dữ liệu
 * đầu ra khác nhau thật (`isSystem`, `userCount` chỉ có ở đầu ra), gộp lại là
 * tài liệu nói sai.
 */
const roleSchema = named(
  "Role",
  z.object({
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    level: z.number().int(),
    permissions: z.array(z.string()),
    userCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);
/**
 * Vé 2FA — hình dạng response THỨ HAI của `POST /auth/login`.
 *
 * Khác hẳn `TokenResponse` có chủ đích: client buộc phải rẽ nhánh tường minh,
 * thay vì đọc phải một object thiếu `accessToken` rồi hỏng ở đâu đó xa hơn.
 */
const twoFactorChallengeResponse = envelope(
  "TwoFactorChallengeResponse",
  z.object({
    twoFactorRequired: z.literal(true),
    challengeToken: z.string(),
    expiresIn: z.number().int(),
  }),
);

const twoFactorStatusResponse = envelope(
  "TwoFactorStatusResponse",
  z.object({
    enabled: z.boolean(),
    enabledAt: z.iso.datetime().nullable(),
    remainingRecoveryCodes: z.number().int(),
    /** `false` = máy chủ chưa cấu hình `ENCRYPTION_KEY`; giao diện nên ẩn nút bật. */
    available: z.boolean(),
  }),
);

const twoFactorSetupResponse = envelope(
  "TwoFactorSetupResponse",
  z.object({
    secret: z.string(),
    /** `otpauth://` — dựng mã QR từ chuỗi này. */
    uri: z.string(),
  }),
);

/** ⚠️ Lần DUY NHẤT mã khôi phục tồn tại ở dạng đọc được. */
const recoveryCodesResponse = envelope(
  "RecoveryCodesResponse",
  z.object({ recoveryCodes: z.array(z.string()) }),
);

const passkeySchema = named(
  "Passkey",
  z.object({
    id: z.string(),
    name: z.string().nullable(),
    deviceType: z.string().nullable(),
    backedUp: z.boolean(),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
  }),
);
const passkeyResponse = envelope("PasskeyResponse", z.object({ passkey: passkeySchema }));
const passkeysListResponse = envelope(
  "PasskeysListResponse",
  z.object({ passkeys: z.array(passkeySchema), available: z.boolean() }),
);

/**
 * `options` để nguyên dạng tự do: đó là đối tượng của chuẩn WebAuthn, client
 * truyền THẲNG vào `navigator.credentials.*` mà không đọc từng field. Mô tả
 * lại nó ở đây chỉ tạo thêm một bản sao sẽ lỗi thời khi chuẩn đổi.
 */
const webAuthnOptionsResponse = envelope(
  "WebAuthnOptionsResponse",
  z.object({ options: z.record(z.string(), z.unknown()), challengeToken: z.string() }),
);

const notificationSchema = named(
  "Notification",
  z.object({
    /** Id bản ghi NGƯỜI NHẬN, không phải id thông báo — dùng cho `/read`. */
    id: z.string(),
    title: z.string(),
    body: z.string(),
    type: z.string(),
    data: z.record(z.string(), z.unknown()).nullable(),
    isRead: z.boolean(),
    readAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  }),
);
const notificationsListResponse = envelope(
  "NotificationsListResponse",
  z.object({
    items: z.array(notificationSchema),
    meta: z.object({
      page: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
      hasNext: z.boolean(),
      unreadCount: z.number().int(),
    }),
  }),
);

const deviceSchema = named(
  "Device",
  z.object({
    id: z.string(),
    platform: z.string(),
    deviceName: z.string().nullable(),
    lastSeenAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  }),
);
const devicesListResponse = envelope(
  "DevicesListResponse",
  z.object({ devices: z.array(deviceSchema) }),
);

const auditLogSchema = named(
  "AuditLog",
  z.object({
    id: z.string(),
    action: z.string(),
    entity: z.string(),
    entityId: z.string().nullable(),
    actorId: z.string().nullable(),
    actorEmail: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
);
const auditLogsListResponse = envelope(
  "AuditLogsListResponse",
  z.object({ items: z.array(auditLogSchema), meta: paginationMetaSchema }),
);

/** Một quyền, kèm NGUỒN của nó — vai trò nào cấp, hay ngoại lệ riêng. */
const permissionExplanationSchema = named(
  "PermissionExplanation",
  z.object({
    key: z.string(),
    granted: z.boolean(),
    fromRoles: z.array(z.string()),
    override: z.enum(["granted", "denied"]).nullable(),
  }),
);
const userPermissionsResponse = envelope(
  "UserPermissionsResponse",
  z.object({ permissions: z.array(permissionExplanationSchema) }),
);

const permissionCatalogResponse = envelope(
  "PermissionCatalogResponse",
  z.object({
    permissions: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        category: z.string(),
        description: z.string(),
      }),
    ),
  }),
);

const oauthProvidersResponse = envelope(
  "OAuthProvidersResponse",
  z.object({ providers: z.array(z.string()) }),
);
const oauthLinkedResponse = envelope(
  "OAuthLinkedResponse",
  z.object({
    linked: z.array(z.object({ provider: z.string(), createdAt: z.iso.datetime() })),
  }),
);

const fileSchema = named(
  "File",
  z.object({
    /** Gửi `id` này kèm form nghiệp vụ để gắn tệp (vd. `avatarFileId`). Không gắn trong 24h thì bị dọn. */
    id: z.string(),
    key: z.string(),
    url: z.string(),
    originalName: z.string(),
    contentType: z.string(),
    kind: z.enum(FILE_KINDS).nullable(),
    size: z.number().int(),
    attached: z.boolean(),
    retained: z.boolean(),
    uploadedById: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
);
const fileResponse = envelope("FileResponse", z.object({ file: fileSchema }));
const filesListResponse = envelope(
  "FilesListResponse",
  z.object({ items: z.array(fileSchema), meta: paginationMetaSchema }),
);
const directUploadResponse = envelope(
  "DirectUploadResponse",
  z.object({
    file: fileSchema,
    upload: z.object({
      url: z.string(),
      method: z.literal("PUT"),
      headers: z.record(z.string(), z.string()),
      expiresAt: z.iso.datetime(),
    }),
  }),
);
const renameFileRequest = named("RenameFileRequest", renameFileSchema, "input");
const createUploadRequest = named("CreateUploadRequest", createUploadSchema, "input");

const genreSchema = named(
  "Genre",
  z.object({ id: z.string(), name: z.string(), slug: z.string() }),
);
const movieSchema = named(
  "Movie",
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    releaseYear: z.number().int().nullable(),
    type: z.enum(MOVIE_TYPES),
    published: z.boolean(),
    /** URL KÝ SẴN, hết hạn sau vài giờ — đừng lưu lại. */
    posterUrl: z.string().nullable(),
    genres: z.array(genreSchema),
    episodeCount: z.number().int(),
    createdAt: z.iso.datetime(),
  }),
);
const episodeSchema = named(
  "Episode",
  z.object({ id: z.string(), number: z.number().int(), title: z.string().nullable() }),
);
const watchableMovieSchema = named(
  "WatchableMovie",
  movieSchema.extend({
    episodes: z.array(episodeSchema),
    current: episodeSchema.extend({
      video: z.object({
        /** URL KÝ SẴN (hết hạn sau vài giờ) — phát trực tiếp, hỗ trợ Range để tua. */
        url: z.string(),
        contentType: z.string(),
        size: z.number().int(),
      }),
    }),
  }),
);
const managedMovieSchema = named(
  "ManagedMovie",
  movieSchema.extend({
    episodes: z.array(
      episodeSchema.extend({ size: z.number().int(), createdAt: z.iso.datetime() }),
    ),
  }),
);
const moviesListResponse = envelope(
  "MoviesListResponse",
  z.object({ items: z.array(movieSchema), meta: paginationMetaSchema }),
);
const movieResponse = envelope("MovieResponse", z.object({ movie: movieSchema }));
const watchableMovieResponse = envelope(
  "WatchableMovieResponse",
  z.object({ movie: watchableMovieSchema }),
);
const managedMovieResponse = envelope(
  "ManagedMovieResponse",
  z.object({ movie: managedMovieSchema }),
);
const moviePublishedResponse = envelope(
  "MoviePublishedResponse",
  z.object({ id: z.string(), published: z.boolean() }),
);
const episodeResponse = envelope("EpisodeResponse", z.object({ episode: episodeSchema }));
const genresListResponse = envelope(
  "GenresListResponse",
  z.object({ genres: z.array(genreSchema) }),
);
const genreResponse = envelope("GenreResponse", z.object({ genre: genreSchema }));
const createMovieRequest = named("CreateMovieRequest", createMovieSchema, "input");
const updateMovieRequest = named("UpdateMovieRequest", updateMovieSchema, "input");
const setMoviePublishedRequest = named(
  "SetMoviePublishedRequest",
  setMoviePublishedSchema,
  "input",
);
const addEpisodeRequest = named("AddEpisodeRequest", addEpisodeSchema, "input");
const createGenreRequest = named("CreateGenreRequest", createGenreSchema, "input");

const roleResponse = envelope("RoleResponse", z.object({ role: roleSchema }));
const roleKeyResponse = envelope("RoleKeyResponse", z.object({ key: z.string() }));
const rolesListResponse = envelope(
  "RolesListResponse",
  z.object({
    roles: z.array(roleSchema),
    permissions: z.array(z.object({ key: z.string(), description: z.string() })),
  }),
);

// ---------------------------------------------------------------------------
// Đường dẫn
// ---------------------------------------------------------------------------

const SECURED = [{ bearerAuth: [] }];

function jsonBody(schema: z.ZodType) {
  return { required: true, content: { "application/json": { schema: ref(schema) } } };
}

function pathParam(name: string, description?: string) {
  return { name, in: "path", required: true, schema: { type: "string" }, description };
}

function queryParam(name: string, schema: Record<string, unknown>, description?: string) {
  return { name, in: "query", required: false, schema, description };
}

const paths = {
  "/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Đăng nhập — trả về token, HOẶC vé 2FA nếu tài khoản đã bật",
      requestBody: jsonBody(loginRequest),
      responses: {
        200: {
          description: "Thành công, hoặc cần bước 2FA — xem `oneOf`",
          content: {
            "application/json": {
              schema: {
                oneOf: [ref(tokenResponse), ref(twoFactorChallengeResponse)],
              },
            },
          },
        },
        ...errorResponses(401, 422, 423, 429),
      },
    },
  },
  "/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Tạo tài khoản mới — luôn gán vai trò USER",
      requestBody: jsonBody(registerRequest),
      responses: {
        ...okResponse(tokenResponse, "Tạo thành công"),
        ...errorResponses(409, 422, 429),
      },
    },
  },
  "/auth/refresh": {
    post: {
      tags: ["Auth"],
      summary: "Đổi refresh token lấy access token mới",
      requestBody: jsonBody(refreshRequest),
      responses: { ...okResponse(tokenResponse), ...errorResponses(401, 429) },
    },
  },
  "/auth/logout": {
    post: {
      tags: ["Auth"],
      security: SECURED,
      summary: "Thu hồi refresh token hiện tại",
      responses: { ...okResponse(emptyResponse, "Đã đăng xuất"), ...errorResponses(401) },
    },
  },
  "/auth/me": {
    get: {
      tags: ["Auth"],
      security: SECURED,
      summary: "Hồ sơ user đang đăng nhập — luôn đọc lại từ database, không tin token",
      responses: { ...okResponse(userResponse), ...errorResponses(401, 404) },
    },
  },
  "/auth/change-password": {
    post: {
      tags: ["Auth"],
      security: SECURED,
      summary: "Đổi mật khẩu khi đang đăng nhập — thu hồi mọi phiên khác",
      requestBody: jsonBody(changePasswordRequest),
      responses: {
        ...okResponse(emptyResponse, "Đổi thành công"),
        ...errorResponses(401, 422, 429),
      },
    },
  },
  "/auth/forgot-password": {
    post: {
      tags: ["Auth"],
      summary: "Gửi link đặt lại mật khẩu — LUÔN trả 200 dù email có tồn tại hay không",
      requestBody: jsonBody(forgotPasswordRequest),
      responses: {
        ...okResponse(emptyResponse, "Đã gửi (nếu email tồn tại)"),
        ...errorResponses(422, 429),
      },
    },
  },
  "/auth/reset-password": {
    post: {
      tags: ["Auth"],
      summary: "Đặt lại mật khẩu bằng token trong email",
      requestBody: jsonBody(resetPasswordRequest),
      responses: {
        ...okResponse(emptyResponse, "Đặt lại thành công"),
        ...errorResponses(422, 429),
      },
    },
  },
  "/auth/verify-email": {
    post: {
      tags: ["Auth"],
      summary: "Xác thực email bằng token trong link",
      requestBody: jsonBody(verifyEmailRequest),
      responses: { ...okResponse(userResponse), ...errorResponses(422) },
    },
  },
  "/auth/verify-email/request": {
    post: {
      tags: ["Auth"],
      security: SECURED,
      summary: "Gửi lại email xác thực",
      responses: { ...okResponse(emptyResponse, "Đã gửi"), ...errorResponses(401, 429) },
    },
  },
  "/auth/2fa": {
    get: {
      tags: ["2FA"],
      security: SECURED,
      summary: "Trạng thái 2FA của tài khoản hiện tại",
      responses: { ...okResponse(twoFactorStatusResponse), ...errorResponses(401) },
    },
    delete: {
      tags: ["2FA"],
      security: SECURED,
      summary: "Tắt 2FA — cần mật khẩu và một mã hợp lệ",
      requestBody: jsonBody(disableTwoFactorRequest),
      responses: {
        ...okResponse(emptyResponse, "Đã tắt"),
        ...errorResponses(401, 422, 429),
      },
    },
  },
  "/auth/2fa/setup": {
    post: {
      tags: ["2FA"],
      security: SECURED,
      summary: "Bước 1 — sinh bí mật và URI cho mã QR (CHƯA bật)",
      responses: { ...okResponse(twoFactorSetupResponse), ...errorResponses(401, 409) },
    },
  },
  "/auth/2fa/enable": {
    post: {
      tags: ["2FA"],
      security: SECURED,
      summary: "Bước 3 — xác nhận mã và bật 2FA, trả về mã khôi phục (chỉ hiện MỘT lần)",
      requestBody: jsonBody(confirmTwoFactorRequest),
      responses: { ...okResponse(recoveryCodesResponse), ...errorResponses(401, 422, 429) },
    },
  },
  "/auth/2fa/recovery-codes": {
    post: {
      tags: ["2FA"],
      security: SECURED,
      summary: "Cấp lại bộ mã khôi phục — mã cũ mất hiệu lực ngay",
      requestBody: jsonBody(confirmTwoFactorRequest),
      responses: { ...okResponse(recoveryCodesResponse), ...errorResponses(401, 422, 429) },
    },
  },
  "/auth/2fa/verify": {
    post: {
      tags: ["2FA"],
      summary: "Đổi vé 2FA + mã lấy token thật (KHÔNG cần access token)",
      requestBody: jsonBody(verifyTwoFactorRequest),
      responses: { ...okResponse(tokenResponse), ...errorResponses(401, 422, 429) },
    },
  },
  "/auth/passkeys": {
    get: {
      tags: ["Passkeys"],
      security: SECURED,
      summary: "Danh sách passkey của tài khoản hiện tại",
      responses: { ...okResponse(passkeysListResponse), ...errorResponses(401) },
    },
  },
  "/auth/passkeys/register/options": {
    post: {
      tags: ["Passkeys"],
      security: SECURED,
      summary: "Bước 1 — tuỳ chọn cho navigator.credentials.create()",
      responses: { ...okResponse(webAuthnOptionsResponse), ...errorResponses(401) },
    },
  },
  "/auth/passkeys/register/verify": {
    post: {
      tags: ["Passkeys"],
      security: SECURED,
      summary: "Bước 2 — xác minh và lưu passkey",
      requestBody: jsonBody(registerPasskeyRequest),
      responses: {
        201: {
          description: "Đã lưu",
          content: { "application/json": { schema: ref(passkeyResponse) } },
        },
        ...errorResponses(401, 422, 429),
      },
    },
  },
  "/auth/passkeys/login/options": {
    post: {
      tags: ["Passkeys"],
      summary:
        "Bước 1 — tuỳ chọn cho navigator.credentials.get(). " +
        "KHÔNG nhận tham số: bắt nhập email trước vừa thừa một bước, vừa biến " +
        "endpoint thành công cụ dò xem email nào đã đăng ký.",
      responses: { ...okResponse(webAuthnOptionsResponse), ...errorResponses(429) },
    },
  },
  "/auth/passkeys/login/verify": {
    post: {
      tags: ["Passkeys"],
      summary:
        "Bước 2 — đăng nhập bằng passkey. Không cần mật khẩu và KHÔNG hỏi thêm " +
        "2FA: passkey với userVerification=required đã là hai yếu tố.",
      requestBody: jsonBody(loginPasskeyRequest),
      responses: { ...okResponse(tokenResponse), ...errorResponses(401, 422, 429) },
    },
  },
  "/auth/passkeys/{id}": {
    patch: {
      tags: ["Passkeys"],
      security: SECURED,
      summary: "Đổi tên passkey",
      parameters: [pathParam("id")],
      requestBody: jsonBody(renamePasskeyRequest),
      responses: { ...okResponse(passkeyResponse), ...errorResponses(401, 404, 422) },
    },
    delete: {
      tags: ["Passkeys"],
      security: SECURED,
      summary: "Xoá passkey — từ chối nếu đây là cách đăng nhập CUỐI CÙNG",
      parameters: [pathParam("id")],
      responses: { ...okResponse(idResponse), ...errorResponses(401, 404, 409) },
    },
  },
  "/auth/change-email": {
    post: {
      tags: ["Auth"],
      security: SECURED,
      summary:
        "Xin đổi email — gửi link xác nhận tới địa chỉ MỚI. Email chỉ đổi thật " +
        "khi link được bấm; đổi ngay thì gõ nhầm một ký tự là mất đường đăng nhập.",
      requestBody: jsonBody(requestEmailChangeRequest),
      responses: {
        ...okResponse(emptyResponse, "Đã gửi link xác nhận"),
        ...errorResponses(401, 409, 422, 429),
      },
    },
  },
  "/auth/change-email/confirm": {
    post: {
      tags: ["Auth"],
      summary: "Xác nhận đổi email bằng token trong link (KHÔNG cần đăng nhập)",
      requestBody: jsonBody(confirmEmailChangeRequest),
      responses: { ...okResponse(userResponse), ...errorResponses(409, 422, 429) },
    },
  },
  "/auth/phone/request-otp": {
    post: {
      tags: ["Auth"],
      security: SECURED,
      summary:
        "Gửi OTP xác thực số điện thoại. ⚠️ MẶC ĐỊNH TẮT " +
        "(PHONE_VERIFICATION_ENABLED=0) vì mỗi SMS tốn tiền thật.",
      requestBody: jsonBody(requestPhoneOtpRequest),
      responses: {
        ...okResponse(emptyResponse, "Đã gửi"),
        ...errorResponses(401, 409, 422, 429),
      },
    },
  },
  "/auth/phone/verify": {
    post: {
      tags: ["Auth"],
      security: SECURED,
      summary: "Xác nhận OTP số điện thoại",
      requestBody: jsonBody(verifyPhoneOtpRequest),
      responses: { ...okResponse(userResponse), ...errorResponses(401, 422, 429) },
    },
  },
  "/auth/oauth/providers": {
    get: {
      tags: ["OAuth"],
      summary: "Nhà cung cấp ĐÃ cấu hình — màn đăng nhập dùng để biết vẽ nút nào",
      responses: { ...okResponse(oauthProvidersResponse) },
    },
  },
  "/auth/oauth/linked": {
    get: {
      tags: ["OAuth"],
      security: SECURED,
      summary: "Tài khoản mạng xã hội đã liên kết",
      responses: { ...okResponse(oauthLinkedResponse), ...errorResponses(401) },
    },
  },
  "/auth/oauth/{provider}/start": {
    get: {
      tags: ["OAuth"],
      summary:
        "Bắt đầu luồng OAuth — trả 302 tới nhà cung cấp. Mở bằng TRÌNH DUYỆT " +
        "(hoặc Custom Tab / ASWebAuthenticationSession trên mobile), không phải " +
        "bằng fetch: nhà cung cấp cần một phiên trình duyệt thật.",
      parameters: [pathParam("provider")],
      responses: {
        302: { description: "Chuyển hướng tới trang đăng nhập của nhà cung cấp" },
        ...errorResponses(404),
      },
    },
  },
  "/auth/oauth/{provider}/callback": {
    get: {
      tags: ["OAuth"],
      summary:
        "Nhà cung cấp gọi lại sau khi người dùng đồng ý. Trả 302 về ứng dụng — " +
        "KHÔNG trả JSON, vì đích đến là thanh địa chỉ của trình duyệt.",
      parameters: [
        pathParam("provider"),
        queryParam("code", { type: "string" }),
        queryParam("state", { type: "string" }),
        queryParam("error", { type: "string" }),
      ],
      responses: { 302: { description: "Chuyển hướng về ứng dụng" } },
    },
    post: {
      tags: ["OAuth"],
      summary:
        "Cùng luồng nhưng nhận form POST — Apple bắt buộc response_mode=form_post " +
        "khi xin scope name/email.",
      parameters: [pathParam("provider")],
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              properties: {
                code: { type: "string" },
                state: { type: "string" },
                error: { type: "string" },
                user: { type: "string", description: "JSON họ tên, Apple chỉ gửi LẦN ĐẦU" },
              },
            },
          },
        },
      },
      responses: { 302: { description: "Chuyển hướng về ứng dụng" } },
    },
  },
  "/auth/oauth/{provider}": {
    delete: {
      tags: ["OAuth"],
      security: SECURED,
      summary: "Gỡ liên kết — từ chối nếu đây là cách đăng nhập cuối cùng",
      parameters: [pathParam("provider")],
      responses: { ...okResponse(emptyResponse), ...errorResponses(401, 404, 409) },
    },
  },
  "/notifications": {
    get: {
      tags: ["Notifications"],
      security: SECURED,
      summary: "Hộp thư của CHÍNH mình — userId lấy từ token, không từ tham số",
      parameters: [
        queryParam("page", { type: "integer", minimum: 1, default: 1 }),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
        queryParam("unreadOnly", { type: "boolean", default: false }),
      ],
      responses: { ...okResponse(notificationsListResponse), ...errorResponses(401, 422) },
    },
    post: {
      tags: ["Notifications"],
      security: SECURED,
      summary: "Gửi thông báo — cần notification:send",
      requestBody: jsonBody(sendNotificationRequest),
      responses: {
        201: {
          description: "Đã gửi",
          content: { "application/json": { schema: ref(emptyResponse) } },
        },
        ...errorResponses(401, 403, 422),
      },
    },
  },
  "/notifications/unread-count": {
    get: {
      tags: ["Notifications"],
      security: SECURED,
      summary: "Số thông báo chưa đọc — cho chấm đỏ trên chuông",
      responses: { ...okResponse(emptyResponse), ...errorResponses(401) },
    },
  },
  "/notifications/read-all": {
    post: {
      tags: ["Notifications"],
      security: SECURED,
      summary: "Đánh dấu đã đọc tất cả",
      responses: { ...okResponse(emptyResponse), ...errorResponses(401) },
    },
  },
  "/notifications/{id}/read": {
    post: {
      tags: ["Notifications"],
      security: SECURED,
      summary: "Đánh dấu đã đọc MỘT thông báo (id là bản ghi người nhận)",
      parameters: [pathParam("id")],
      responses: { ...okResponse(idResponse), ...errorResponses(401, 404) },
    },
  },
  "/devices": {
    get: {
      tags: ["Devices"],
      security: SECURED,
      summary: "Thiết bị đang nhận push",
      responses: { ...okResponse(devicesListResponse), ...errorResponses(401) },
    },
    post: {
      tags: ["Devices"],
      security: SECURED,
      summary:
        "Đăng ký thiết bị nhận push. `fcmToken` UNIQUE toàn bảng: cùng một máy " +
        "có thể được hai người đăng nhập lần lượt và FCM cấp lại đúng token đó.",
      requestBody: jsonBody(registerDeviceRequest),
      responses: {
        201: {
          description: "Đã đăng ký",
          content: { "application/json": { schema: ref(emptyResponse) } },
        },
        ...errorResponses(401, 422),
      },
    },
    delete: {
      tags: ["Devices"],
      security: SECURED,
      summary: "Gỡ thiết bị khỏi danh sách nhận push — gọi lúc đăng xuất trên máy đó",
      responses: { ...okResponse(emptyResponse), ...errorResponses(401, 422) },
    },
  },
  "/audit-logs": {
    get: {
      tags: ["Audit"],
      security: SECURED,
      summary: "Nhật ký thao tác. Chỉ ĐỌC — không có đường ghi, sửa hay xoá qua HTTP",
      parameters: [
        queryParam("page", { type: "integer", minimum: 1, default: 1 }),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
        queryParam("actorId", { type: "string" }),
        queryParam("action", { type: "string" }),
        queryParam("entity", { type: "string" }),
        queryParam("entityId", { type: "string" }),
        queryParam("from", { type: "string", format: "date-time" }),
        queryParam("to", { type: "string", format: "date-time" }),
      ],
      responses: { ...okResponse(auditLogsListResponse), ...errorResponses(401, 403, 422) },
    },
  },
  "/permissions": {
    get: {
      tags: ["Roles"],
      security: SECURED,
      summary:
        "Danh mục quyền TỒN TẠI. Đến từ CODE (src/lib/permissions.ts), không phải " +
        "database — database chỉ giữ việc GÁN quyền cho vai trò.",
      responses: { ...okResponse(permissionCatalogResponse), ...errorResponses(401, 403) },
    },
  },
  "/files": {
    get: {
      tags: ["Files"],
      security: SECURED,
      summary:
        "Danh sách tệp — người thường (file:upload) chỉ thấy tệp CỦA MÌNH, file:manage thấy tất cả.",
      parameters: [
        queryParam("page", { type: "integer", minimum: 1, default: 1 }),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
        queryParam("kind", { type: "string", enum: [...FILE_KINDS] }),
        queryParam("q", { type: "string" }, "Tìm theo tên tệp"),
        queryParam(
          "attached",
          { type: "string", enum: ["true", "false"] },
          "false = mồ côi, sắp bị dọn",
        ),
        queryParam("uploadedById", { type: "string" }, "Chỉ có tác dụng với file:manage"),
      ],
      responses: { ...okResponse(filesListResponse), ...errorResponses(401, 403, 422) },
    },
    post: {
      tags: ["Files"],
      security: SECURED,
      summary:
        "Tải tệp lên QUA MÁY CHỦ (multipart) — ảnh 5MB, tài liệu 20MB, âm thanh 50MB. Video đi " +
        "POST /files/uploads. Kiểm MAGIC BYTES chứ không tin Content-Type do client khai. Trả " +
        "`file.id` — gửi kèm form nghiệp vụ (vd. `avatarFileId`) để gắn; không gắn trong 24 giờ sẽ bị dọn.",
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: { type: "string", format: "binary" },
                folder: { type: "string" },
                retain: {
                  type: "string",
                  enum: ["true", "false"],
                  description: "Giữ trong thư viện, không dọn — chỉ file:manage",
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Đã tải lên",
          content: { "application/json": { schema: ref(fileResponse) } },
        },
        ...errorResponses(401, 403, 422, 429),
      },
    },
  },
  "/files/uploads": {
    post: {
      tags: ["Files"],
      security: SECURED,
      summary:
        "Tải TRỰC TIẾP lên kho (video, tệp lớn): nhận URL ký sẵn -> client PUT nội dung kèm đúng " +
        "`upload.headers` -> gọi POST /files/{id}/complete. Chỉ có khi kho là S3 (409 nếu không).",
      requestBody: jsonBody(createUploadRequest),
      responses: {
        201: {
          description: "Đã cấp URL tải lên",
          content: { "application/json": { schema: ref(directUploadResponse) } },
        },
        ...errorResponses(401, 403, 409, 422, 429),
      },
    },
  },
  "/files/{id}": {
    get: {
      tags: ["Files"],
      security: SECURED,
      summary: "Chi tiết tệp — tệp của người khác (không có file:manage) trả 404",
      parameters: [pathParam("id")],
      responses: { ...okResponse(fileResponse), ...errorResponses(401, 403, 404) },
    },
    patch: {
      tags: ["Files"],
      security: SECURED,
      summary: "Đổi TÊN hiển thị. Nội dung không sửa được — tải tệp mới rồi gắn lại.",
      parameters: [pathParam("id")],
      requestBody: jsonBody(renameFileRequest),
      responses: { ...okResponse(fileResponse), ...errorResponses(401, 403, 404, 422) },
    },
    delete: {
      tags: ["Files"],
      security: SECURED,
      summary: "Xoá tệp khỏi kho. Tệp đang được dùng (vd. làm avatar) trả 409 — gỡ ra trước.",
      parameters: [pathParam("id")],
      responses: { ...okResponse(idResponse), ...errorResponses(401, 403, 404, 409) },
    },
  },
  "/files/{id}/complete": {
    post: {
      tags: ["Files"],
      security: SECURED,
      summary:
        "Xác nhận đã PUT xong (tải trực tiếp). Máy chủ kiểm tệp THẬT trên kho: tồn tại, dung lượng, " +
        "chữ ký đầu tệp. Không đạt thì xoá luôn và trả 422.",
      parameters: [pathParam("id")],
      responses: { ...okResponse(fileResponse), ...errorResponses(401, 403, 404, 422) },
    },
  },
  "/movies": {
    get: {
      tags: ["Movies"],
      security: SECURED,
      summary:
        "Danh sách phim (movie:watch), mới cập nhật trước. Phim đang ẩn chỉ hiện khi gửi " +
        "includeUnpublished=true VÀ có movie:manage.",
      parameters: [
        queryParam("page", { type: "integer", minimum: 1, default: 1 }),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
        queryParam("q", { type: "string" }, "Tìm theo tên phim"),
        queryParam("type", { type: "string", enum: [...MOVIE_TYPES] }),
        queryParam("genre", { type: "string" }, "Slug thể loại, lấy từ GET /genres"),
        queryParam("includeUnpublished", { type: "string", enum: ["true", "false"] }),
      ],
      responses: { ...okResponse(moviesListResponse), ...errorResponses(401, 403, 422) },
    },
    post: {
      tags: ["Movies"],
      security: SECURED,
      summary:
        "Tạo phim kèm TẬP 1 (movie:manage). Tải video (POST /files/uploads) và poster (POST /files) " +
        "TRƯỚC, rồi gửi id vào đây. Phim mới ở trạng thái ẩn.",
      requestBody: jsonBody(createMovieRequest),
      responses: {
        201: {
          description: "Đã tạo",
          content: { "application/json": { schema: ref(movieResponse) } },
        },
        ...errorResponses(401, 403, 422),
      },
    },
  },
  "/movies/{id}": {
    get: {
      tags: ["Movies"],
      security: SECURED,
      summary:
        "Chi tiết phim + URL phát của một tập (movie:watch). URL ký sẵn có hạn — mở lại thì gọi lại.",
      parameters: [
        pathParam("id"),
        queryParam("ep", { type: "integer", minimum: 1 }, "Số tập, bỏ trống = tập đầu"),
      ],
      responses: { ...okResponse(watchableMovieResponse), ...errorResponses(401, 403, 404, 422) },
    },
    patch: {
      tags: ["Movies"],
      security: SECURED,
      summary:
        "Sửa thông tin phim (movie:manage). Có posterFileId = thay poster. Phim bộ nhiều tập không " +
        "đổi sang phim lẻ/chiếu rạp được (409).",
      parameters: [pathParam("id")],
      requestBody: jsonBody(updateMovieRequest),
      responses: {
        ...okResponse(managedMovieResponse),
        ...errorResponses(401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: ["Movies"],
      security: SECURED,
      summary: "Xoá phim cùng mọi tập (movie:manage). Video/poster được dọn khỏi kho sau đó.",
      parameters: [pathParam("id")],
      responses: { ...okResponse(idResponse), ...errorResponses(401, 403, 404) },
    },
  },
  "/movies/{id}/published": {
    put: {
      tags: ["Movies"],
      security: SECURED,
      summary: "Xuất bản / ẩn phim (movie:manage)",
      parameters: [pathParam("id")],
      requestBody: jsonBody(setMoviePublishedRequest),
      responses: { ...okResponse(moviePublishedResponse), ...errorResponses(401, 403, 404, 422) },
    },
  },
  "/movies/{id}/episodes": {
    post: {
      tags: ["Movies"],
      security: SECURED,
      summary:
        "Thêm TẬP TIẾP THEO cho phim bộ (movie:manage). Số tập do máy chủ đánh. Phim lẻ/chiếu rạp " +
        "đã có 1 tập thì 409.",
      parameters: [pathParam("id")],
      requestBody: jsonBody(addEpisodeRequest),
      responses: {
        201: {
          description: "Đã thêm tập",
          content: { "application/json": { schema: ref(episodeResponse) } },
        },
        ...errorResponses(401, 403, 404, 409, 422),
      },
    },
  },
  "/episodes/{id}": {
    delete: {
      tags: ["Movies"],
      security: SECURED,
      summary: "Xoá một tập (movie:manage). Tập duy nhất còn lại thì 409 — xoá cả phim thay vào.",
      parameters: [pathParam("id")],
      responses: { ...okResponse(idResponse), ...errorResponses(401, 403, 404, 409) },
    },
  },
  "/genres": {
    get: {
      tags: ["Genres"],
      security: SECURED,
      summary: "Danh sách thể loại (movie:watch)",
      responses: { ...okResponse(genresListResponse), ...errorResponses(401, 403) },
    },
    post: {
      tags: ["Genres"],
      security: SECURED,
      summary: "Thêm thể loại (movie:manage). Trùng tên thì 409.",
      requestBody: jsonBody(createGenreRequest),
      responses: {
        201: {
          description: "Đã thêm",
          content: { "application/json": { schema: ref(genreResponse) } },
        },
        ...errorResponses(401, 403, 409, 422),
      },
    },
  },
  "/genres/{id}": {
    delete: {
      tags: ["Genres"],
      security: SECURED,
      summary: "Xoá thể loại (movie:manage) — chỉ gỡ nhãn khỏi phim, không xoá phim",
      parameters: [pathParam("id")],
      responses: { ...okResponse(idResponse), ...errorResponses(401, 403, 404) },
    },
  },
  "/users/{id}/roles": {
    put: {
      tags: ["Users"],
      security: SECURED,
      summary: "THAY TOÀN BỘ danh sách vai trò (PUT, không phải PATCH) — gửi thiếu là gỡ mất",
      parameters: [pathParam("id")],
      requestBody: jsonBody(assignRolesRequest),
      responses: { ...okResponse(userResponse), ...errorResponses(401, 403, 404, 409, 422) },
    },
  },
  "/users/{id}/permissions": {
    get: {
      tags: ["Users"],
      security: SECURED,
      summary: "Quyền của một người, kèm NGUỒN: vai trò nào cấp, hay ngoại lệ riêng",
      parameters: [pathParam("id")],
      responses: { ...okResponse(userPermissionsResponse), ...errorResponses(401, 403, 404) },
    },
    put: {
      tags: ["Users"],
      security: SECURED,
      summary:
        "Ngoại lệ quyền cho TỪNG người, đè lên vai trò. Thứ tự: hợp vai trò → " +
        "cộng phần cấp thêm → TRỪ phần bị tước. Cấm luôn thắng.",
      parameters: [pathParam("id")],
      requestBody: jsonBody(setUserPermissionRequest),
      responses: { ...okResponse(userPermissionsResponse), ...errorResponses(401, 403, 404, 422) },
    },
  },
  "/users/{id}/permissions/{permissionKey}": {
    delete: {
      tags: ["Users"],
      security: SECURED,
      summary: "Gỡ ngoại lệ, trả người dùng về đúng quyền của vai trò họ đang mang",
      parameters: [pathParam("id"), pathParam("permissionKey")],
      responses: { ...okResponse(userPermissionsResponse), ...errorResponses(401, 403, 404) },
    },
  },
  "/auth/sessions": {
    get: {
      tags: ["Auth"],
      security: SECURED,
      summary:
        "Thiết bị đang đăng nhập — CHỈ của chính mình. " +
        "Response không tự đánh dấu phiên hiện tại: client đối chiếu với `sessionId` " +
        "nhận được lúc đăng nhập/refresh (access token không mang thông tin đó).",
      responses: { ...okResponse(sessionsResponse), ...errorResponses(401) },
    },
    delete: {
      tags: ["Auth"],
      security: SECURED,
      summary:
        "Đăng xuất MỌI thiết bị khác. Giữ lại phiên hiện tại (nhận ra qua `sid` " +
        "trong access token) — đăng xuất luôn người đang bấm nút thì họ phải " +
        "đăng nhập lại ngay.",
      responses: { ...okResponse(emptyResponse), ...errorResponses(401) },
    },
  },
  "/auth/sessions/{id}": {
    delete: {
      tags: ["Auth"],
      security: SECURED,
      summary:
        "Đăng xuất một thiết bị. Trả 404 cho cả phiên không tồn tại lẫn phiên của " +
        "người khác — phân biệt hai ca đó là xác nhận id có thật.",
      parameters: [pathParam("id")],
      responses: { ...okResponse(idResponse), ...errorResponses(401, 404) },
    },
  },
  "/users": {
    get: {
      tags: ["Users"],
      security: SECURED,
      summary: "Danh sách user — phân trang theo số trang, kèm tổng số bản ghi",
      parameters: [
        queryParam("page", { type: "integer", minimum: 1, default: 1 }),
        queryParam("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
        queryParam("q", { type: "string" }, "Tìm theo email / username / số điện thoại / họ tên"),
        queryParam("status", { type: "string", enum: ["ACTIVE", "INACTIVE", "BANNED"] }),
        queryParam("roleKey", { type: "string" }),
      ],
      responses: { ...okResponse(usersListResponse), ...errorResponses(401, 403) },
    },
    post: {
      tags: ["Users"],
      security: SECURED,
      summary: "Admin tạo user mới, được phép chỉ định vai trò",
      requestBody: jsonBody(createUserRequest),
      responses: {
        ...okResponse(userResponse, "Tạo thành công"),
        ...errorResponses(401, 403, 409, 422),
      },
    },
  },
  "/users/{id}": {
    get: {
      tags: ["Users"],
      security: SECURED,
      summary: "Xem 1 user — chính mình cần profile:read:own, xem người khác cần user:read",
      parameters: [pathParam("id")],
      responses: { ...okResponse(userResponse), ...errorResponses(401, 403, 404) },
    },
    patch: {
      tags: ["Users"],
      security: SECURED,
      summary:
        "Sửa hồ sơ — chính mình cần profile:update:own, sửa người khác cần user:update. " +
        "Riêng roleKeys LUÔN đòi user:update, kể cả khi đang sửa chính mình.",
      parameters: [pathParam("id")],
      requestBody: jsonBody(updateUserRequest),
      responses: { ...okResponse(userResponse), ...errorResponses(401, 403, 404, 409, 422) },
    },
    delete: {
      tags: ["Users"],
      security: SECURED,
      summary: "Xoá mềm user — không tự xoá được chính mình",
      parameters: [pathParam("id")],
      responses: { ...okResponse(idResponse), ...errorResponses(401, 403, 409) },
    },
  },
  "/users/{id}/status": {
    patch: {
      tags: ["Users"],
      security: SECURED,
      summary: "Khoá/mở khoá tài khoản — không tự khoá được chính mình",
      parameters: [pathParam("id")],
      requestBody: jsonBody(updateUserStatusRequest),
      responses: { ...okResponse(userResponse), ...errorResponses(401, 403, 404, 409, 422) },
    },
  },
  "/users/{id}/unlock": {
    post: {
      tags: ["Users"],
      security: SECURED,
      summary: "Mở khoá sớm — xoá lockedUntil do sai mật khẩu liên tiếp, thay vì đợi hết hạn",
      parameters: [pathParam("id")],
      responses: { ...okResponse(userResponse), ...errorResponses(401, 403, 404) },
    },
  },
  "/roles": {
    get: {
      tags: ["Roles"],
      security: SECURED,
      summary:
        "Danh sách vai trò kèm bảng phân quyền, VÀ danh mục quyền tồn tại. " +
        "Danh mục đến từ code (src/lib/permissions.ts), không phải database.",
      responses: { ...okResponse(rolesListResponse), ...errorResponses(401, 403) },
    },
    post: {
      tags: ["Roles"],
      security: SECURED,
      summary: "Tạo vai trò mới — key không đổi được sau khi tạo",
      requestBody: jsonBody(createRoleRequest),
      responses: {
        ...okResponse(roleResponse, "Tạo thành công"),
        ...errorResponses(401, 403, 409, 422),
      },
    },
  },
  "/roles/{key}": {
    get: {
      tags: ["Roles"],
      security: SECURED,
      summary: "Chi tiết một vai trò",
      parameters: [pathParam("key")],
      responses: { ...okResponse(roleResponse), ...errorResponses(401, 403, 404) },
    },
    patch: {
      tags: ["Roles"],
      security: SECURED,
      summary:
        "Đổi tên/mô tả và/hoặc thay TOÀN BỘ danh sách quyền. " +
        "`permissions` là thay thế, không phải thêm vào — gửi thiếu là gỡ mất.",
      parameters: [pathParam("key")],
      requestBody: jsonBody(updateRoleRequest),
      responses: { ...okResponse(roleResponse), ...errorResponses(401, 403, 404, 422) },
    },
    delete: {
      tags: ["Roles"],
      security: SECURED,
      summary: "Xoá vai trò — không xoá được vai trò hệ thống hoặc vai trò còn người dùng",
      parameters: [pathParam("key")],
      responses: { ...okResponse(roleKeyResponse), ...errorResponses(401, 403, 404, 409) },
    },
  },
};

// ---------------------------------------------------------------------------
// Sinh tài liệu
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

/**
 * `z.date()` không có biểu diễn trong JSON Schema nên Zod mặc định ném lỗi
 * (`unrepresentable: "throw"`). Ở đây chúng luôn được `JSON.stringify` thành
 * chuỗi ISO, nên khai đúng như vậy.
 *
 * ⚠️ Đi kèm `unrepresentable: "any"`, tức là kiểu KHÁC cũng không biểu diễn
 * được (`bigint`, `symbol`…) sẽ lặng lẽ thành `{}` thay vì báo lỗi. Đừng dùng
 * chúng trong schema của API công khai — client sinh tự động sẽ nhận `dynamic`
 * / `Any` và mất hết kiểm tra kiểu.
 */
function dateToIsoString(ctx: { zodSchema: z.core.$ZodType; jsonSchema: JsonSchema }) {
  if (ctx.zodSchema._zod.def.type === "date") {
    ctx.jsonSchema.type = "string";
    ctx.jsonSchema.format = "date-time";
  }
}

function buildComponentSchemas(): Record<string, JsonSchema> {
  const options = {
    uri: (id: string) => `#/components/schemas/${id}`,
    target: "draft-2020-12" as const,
    unrepresentable: "any" as const,
    override: dateToIsoString,
  };

  const merged: Record<string, JsonSchema> = {
    ...z.toJSONSchema(inputSchemas, { ...options, io: "input" }).schemas,
    ...z.toJSONSchema(outputSchemas, { ...options, io: "output" }).schemas,
  };

  // `$schema`/`$id` là siêu dữ liệu của JSON Schema đứng một mình. Trong
  // OpenAPI chúng thừa, và một số công cụ sinh client coi `$id` là tên kiểu
  // rồi đẻ ra `#/components/schemas/User` làm tên class.
  for (const schema of Object.values(merged)) {
    delete schema.$schema;
    delete schema.$id;
  }

  return merged;
}

export function getOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "xemphim API",
      version: "1.0.0",
      description:
        "REST API cho client mobile — dùng Bearer token, khác cookie session của web. " +
        "Tự sinh từ Zod schema thật trong src/schemas/*.ts, không phải viết tay riêng.",
    },
    servers: [{ url: API_PREFIX }],
    components: {
      schemas: buildComponentSchemas(),
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Access token từ /auth/login, /auth/register, hoặc /auth/refresh",
        },
      },
    },
    paths,
  };
}
