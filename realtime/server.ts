import { createServer, type Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { verifySession, type SessionPayload } from "@/lib/session";
import { logger } from "@/lib/logger";
import { realtimeEnv } from "./env";

/**
 * Máy chủ realtime — tiến trình RIÊNG, không nằm trong Next.js.
 *
 * Vì sao phải tách: App Router là mô hình request/response, không giữ được kết
 * nối WebSocket lâu dài. Nhét socket vào Next bằng custom server thì phá
 * `output: "standalone"`, và mỗi lần deploy web là rớt sạch kết nối đang mở.
 *
 * Vì sao KHÔNG cần NestJS: tiến trình này chỉ làm một việc, và nó dùng lại
 * `verifySession` cùng tầng service của app chính — web, mobile và socket chung
 * đúng một token, một tầng nghiệp vụ. Khi nào nó phình ra nhiều gateway, queue
 * consumer và cron thì mới đáng cân nhắc framework có DI.
 */

type SocketData = { session: SessionPayload };
type AppSocket = Socket<Record<string, never>, Record<string, never>, never, SocketData>;

/** Mỗi người dùng một "phòng" riêng, để phát tin tới mọi thiết bị của họ. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export type RealtimeHandle = {
  port: number;
  stop: () => Promise<void>;
};

export async function startRealtime(): Promise<RealtimeHandle> {
  const httpServer: HttpServer = createServer((req, res) => {
    // Health check cho Docker/systemd. Một endpoint thì không cần framework HTTP.
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", connections: io.engine.clientsCount }));
      return;
    }
    res.writeHead(404).end();
  });

  const io = new Server<Record<string, never>, Record<string, never>, never, SocketData>(
    httpServer,
    {
      cors: {
        origin: realtimeEnv.REALTIME_CORS_ORIGIN.split(",").map((o) => o.trim()),
        credentials: true,
      },
      // Mạng rớt rồi quay lại trong 2 phút thì nối tiếp phiên cũ thay vì dựng
      // phiên mới — quan trọng với mobile, nơi mạng chập chờn liên tục.
      connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
    },
  );

  const redisClients = await attachRedisAdapter(io);

  /**
   * Xác thực NGAY Ở HANDSHAKE, không phải sau khi đã nối.
   *
   * Cho nối trước rồi mới kiểm tra nghĩa là kẻ tấn công vẫn giữ được kết nối mở
   * và tiêu tài nguyên máy chủ. Ở đây token sai là từ chối bắt tay luôn.
   */
  // socket.io khai báo middleware trả về `void`, nên không await được hàm async
  // truyền thẳng vào. Bọc lại để lỗi trong promise vẫn tới được `next()` thay vì
  // thành unhandled rejection và treo handshake vô thời hạn.
  io.use((socket, next) => {
    void (async () => {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      const session = await verifySession(token);

      if (!session) {
        // Không nói rõ vì sao (thiếu token / sai chữ ký / hết hạn) — chi tiết
        // đó chỉ có ích cho người đang dò.
        next(new Error("unauthorized"));
        return;
      }

      socket.data.session = session;
      next();
    })().catch(() => next(new Error("unauthorized")));
  });

  io.on("connection", (socket: AppSocket) => {
    const { sub: userId } = socket.data.session;

    void socket.join(userRoom(userId));
    logger.info("Socket connected", { userId, socketId: socket.id });

    // Sự kiện mẫu: phát tin tới MỌI thiết bị của một người dùng.
    // Thay bằng logic thật của bạn — gọi service dùng chung, đừng viết truy vấn
    // database trực tiếp ở đây.
    socket.on(
      "ping:user",
      (payload: { toUserId: string; text: string }, ack?: (r: unknown) => void) => {
        io.to(userRoom(payload.toUserId)).emit("message:new", {
          from: userId,
          text: payload.text,
          at: new Date().toISOString(),
        });

        // ack là cách client biết máy chủ đã nhận. Thiếu nó thì client không
        // phân biệt được "đã gửi" với "mất mạng".
        ack?.({ ok: true });
      },
    );

    socket.on("disconnect", (reason) => {
      logger.info("Socket disconnected", { userId, socketId: socket.id, reason });
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(realtimeEnv.REALTIME_PORT, "0.0.0.0", resolve);
  });
  logger.info(`Realtime chạy tại http://0.0.0.0:${realtimeEnv.REALTIME_PORT}`);

  return {
    port: realtimeEnv.REALTIME_PORT,
    // Đóng gọn gàng: client đang mở được báo trước thay vì bị cắt ngang và phải
    // tự đoán là mất mạng.
    stop: async () => {
      await io.close();
      await Promise.all(redisClients.map((client) => client.quit()));
    },
  };
}

async function attachRedisAdapter(io: Server) {
  if (!realtimeEnv.REDIS_URL) {
    // Một instance thì không cần adapter. Nhưng từ instance thứ hai trở đi,
    // client nối vào máy A sẽ KHÔNG nhận được tin phát từ máy B — im lặng,
    // không báo lỗi gì. Nên phải cảnh báo rõ ở đây.
    logger.warn(
      "REDIS_URL chưa set — chạy một instance thì được, nhưng scale ngang sẽ mất tin giữa các instance",
    );
    return [];
  }

  const pubClient = createClient({ url: realtimeEnv.REDIS_URL });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  io.adapter(createAdapter(pubClient, subClient));
  logger.info("Redis adapter đã kết nối");

  return [pubClient, subClient];
}
