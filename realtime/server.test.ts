import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { signSession } from "@/lib/session";

/**
 * Test tích hợp thật: dựng máy chủ realtime, nối client thật qua WebSocket.
 *
 * Điều đáng khoá chặt nhất là handshake — nếu ai đó lỡ tay bỏ middleware xác
 * thực, socket trở thành cửa sau đi vòng qua toàn bộ phân quyền của app.
 */

const PORT = 34567;
process.env.REALTIME_PORT = String(PORT);
process.env.REALTIME_CORS_ORIGIN = "http://localhost:3000";
delete process.env.REDIS_URL; // chạy một instance, không cần adapter

const URL = `http://127.0.0.1:${PORT}`;

let stopServer: (() => Promise<void>) | undefined;
const openClients: ClientSocket[] = [];

function connect(token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = createClient(URL, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
    });
    openClients.push(socket);

    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error) => reject(error));
  });
}

beforeAll(async () => {
  const { startRealtime } = await import("./server");
  const handle = await startRealtime();
  stopServer = handle.stop;
}, 20_000);

afterAll(async () => {
  for (const socket of openClients) socket.close();
  await stopServer?.();
});

describe("handshake", () => {
  it("từ chối kết nối KHÔNG có token", async () => {
    await expect(connect()).rejects.toThrow(/unauthorized/);
  });

  it("từ chối token rác", async () => {
    await expect(connect("khong-phai-jwt")).rejects.toThrow(/unauthorized/);
  });

  it("từ chối token bị sửa nội dung", async () => {
    const token = await signSession({
      sub: "u1",
      email: "a@b.com",
      typ: "access" as const,
      roles: ["USER"],
    });
    const [header, body, signature] = token.split(".");
    const tampered = JSON.parse(atob(body!)) as Record<string, unknown>;
    tampered.role = "ADMIN";
    const forged = `${header}.${btoa(JSON.stringify(tampered)).replaceAll("=", "")}.${signature}`;

    await expect(connect(forged)).rejects.toThrow(/unauthorized/);
  });

  it("chấp nhận token hợp lệ", async () => {
    const token = await signSession({
      sub: "u1",
      email: "a@b.com",
      typ: "access" as const,
      roles: ["USER"],
    });
    const socket = await connect(token);

    expect(socket.connected).toBe(true);
  });
});

describe("phát tin theo người dùng", () => {
  it("tin nhắn tới MỌI thiết bị của người nhận, không lọt sang người khác", async () => {
    const alice = await connect(
      await signSession({
        sub: "alice",
        email: "alice@x.com",
        typ: "access" as const,
        roles: ["USER"],
      }),
    );
    // Bob mở hai thiết bị — cả hai phải cùng nhận.
    const bobPhone = await connect(
      await signSession({
        sub: "bob",
        email: "bob@x.com",
        typ: "access" as const,
        roles: ["USER"],
      }),
    );
    const bobLaptop = await connect(
      await signSession({
        sub: "bob",
        email: "bob@x.com",
        typ: "access" as const,
        roles: ["USER"],
      }),
    );
    const carol = await connect(
      await signSession({
        sub: "carol",
        email: "carol@x.com",
        typ: "access" as const,
        roles: ["USER"],
      }),
    );

    const received: string[] = [];
    bobPhone.on("message:new", () => received.push("phone"));
    bobLaptop.on("message:new", () => received.push("laptop"));
    carol.on("message:new", () => received.push("carol")); // KHÔNG được nhận

    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      alice.emit("ping:user", { toUserId: "bob", text: "hi" }, resolve);
    });

    expect(ack.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 300));
    expect(received.sort()).toEqual(["laptop", "phone"]);
  }, 15_000);
});
