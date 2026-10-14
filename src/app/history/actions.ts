"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/define-action";
import { logger } from "@/lib/logger";
import { watchHistoryService } from "@/services/watch-history.service";

type ActionResult = { error?: string };

/** Bỏ một phim khỏi lịch sử CỦA CHÍNH người gọi — `actorId` lấy từ phiên, không nhận từ client. */
export const removeHistoryItemAction = defineAction(
  "movie:watch",
  async (ctx, movieId: string): Promise<ActionResult> => {
    try {
      await watchHistoryService.remove(ctx.actorId, movieId);
    } catch (error) {
      logger.error("Xoá lịch sử xem thất bại", error, { movieId });
      return { error: "Không xoá được lúc này. Vui lòng thử lại." };
    }
    revalidatePath("/history");
    return {};
  },
);

export const clearHistoryAction = defineAction(
  "movie:watch",
  async (ctx): Promise<ActionResult> => {
    try {
      await watchHistoryService.clear(ctx.actorId);
    } catch (error) {
      logger.error("Xoá toàn bộ lịch sử xem thất bại", error);
      return { error: "Không xoá được lúc này. Vui lòng thử lại." };
    }
    revalidatePath("/history");
    return {};
  },
);
