import { z } from "zod";
import { paginationSchema } from "@/schemas/common.schema";

export const notificationTypeSchema = z.enum(["DIRECT", "TOPIC", "BROADCAST"]);
export const devicePlatformSchema = z.enum(["IOS", "ANDROID", "WEB"]);

export const sendNotificationSchema = z
  .object({
    title: z.string().trim().min(1, "Tiêu đề không được để trống").max(200),
    body: z.string().trim().min(1, "Nội dung không được để trống").max(2000),
    imageUrl: z.string().url().optional(),
    actionUrl: z.string().max(500).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    type: notificationTypeSchema.default("DIRECT"),
    /** Bắt buộc khi `type = DIRECT`. Bỏ trống với BROADCAST. */
    userIds: z.array(z.string()).optional(),
  })
  .refine((value) => value.type !== "DIRECT" || (value.userIds?.length ?? 0) > 0, {
    message: "Thông báo DIRECT phải chỉ định ít nhất một người nhận",
    path: ["userIds"],
  });
export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;

export const listNotificationsSchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;

export const registerDeviceSchema = z.object({
  platform: devicePlatformSchema,
  fcmToken: z.string().min(1, "Thiếu FCM token"),
  deviceId: z.string().max(128).optional(),
  deviceName: z.string().max(128).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
