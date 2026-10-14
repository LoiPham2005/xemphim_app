import { z } from "zod";
import { paginationSchema } from "@/schemas/common.schema";

export const listAuditLogsSchema = paginationSchema.extend({
  actorId: z.string().optional(),
  action: z.string().max(100).optional(),
  entity: z.string().max(100).optional(),
  entityId: z.string().optional(),
  /** Lọc theo khoảng thời gian, dạng ISO 8601. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;

/**
 * Tên hành động đã dùng sẵn trong bộ khung.
 *
 * Hằng số thay vì chuỗi rời rạc: nhật ký chỉ tra cứu được khi tên hành động
 * nhất quán, mà `"user.ban"` với `"user.banned"` thì không có gì báo lỗi cả.
 */
export const AUDIT_ACTIONS = {
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_DELETED: "user.deleted",
  USER_STATUS_CHANGED: "user.status_changed",
  USER_ROLES_ASSIGNED: "user.roles_assigned",
  USER_PERMISSION_OVERRIDDEN: "user.permission_overridden",
  PASSWORD_CHANGED: "auth.password_changed",
  PASSWORD_RESET: "auth.password_reset",
  LOGIN_SUCCEEDED: "auth.login_succeeded",
  LOGIN_FAILED: "auth.login_failed",
  SESSION_REVOKED: "auth.session_revoked",
  EMAIL_CHANGE_REQUESTED: "auth.email_change_requested",
  EMAIL_CHANGED: "auth.email_changed",
  PHONE_VERIFIED: "auth.phone_verified",
  TWO_FACTOR_FAILED: "auth.two_factor_failed",
  PASSKEY_REGISTERED: "auth.passkey_registered",
  PASSKEY_REMOVED: "auth.passkey_removed",
  TWO_FACTOR_ENABLED: "auth.two_factor_enabled",
  TWO_FACTOR_DISABLED: "auth.two_factor_disabled",
  TWO_FACTOR_RECOVERY_REGENERATED: "auth.two_factor_recovery_regenerated",
  REFRESH_TOKEN_REUSED: "auth.refresh_token_reused",
  ROLE_CREATED: "role.created",
  ROLE_UPDATED: "role.updated",
  ROLE_DELETED: "role.deleted",
  NOTIFICATION_SENT: "notification.sent",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});
