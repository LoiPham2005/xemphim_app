"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  beginTwoFactorSetupAction,
  disableTwoFactorAction,
  enableTwoFactorAction,
  regenerateRecoveryCodesAction,
} from "./actions";

type Props = {
  enabled: boolean;
  available: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
};

/**
 * Bật/tắt 2FA.
 *
 * Luồng bật là BA bước, không phải một — bước xác nhận mã chứng minh app xác
 * thực ĐÃ lưu đúng bí mật. Bật ngay sau khi hiện QR thì người quét hỏng sẽ bị
 * khoá vĩnh viễn khỏi tài khoản của chính mình.
 */
export function TwoFactorManager({ enabled, available, enabledAt, recoveryCodesRemaining }: Props) {
  const [isPending, startTransition] = useTransition();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!setup || !canvasRef.current) return;

    // Nạp động: thư viện QR chỉ cần khi người dùng thật sự bật 2FA, không phải
    // trong bundle của mọi lần mở trang.
    const canvas = canvasRef.current;
    void import("qrcode").then(({ default: QRCode }) => {
      void QRCode.toCanvas(canvas, setup.uri, { width: 200, margin: 1 });
    });
  }, [setup]);

  if (!available) {
    // Hiện một nút mà bấm vào chỉ ra lỗi cấu hình máy chủ thì tệ hơn là nói
    // thẳng vì sao chưa dùng được.
    return (
      <p className="alert alert-warning">
        Máy chủ chưa cấu hình <code>ENCRYPTION_KEY</code> nên chưa bật được 2FA. Sinh khoá bằng{" "}
        <code>openssl rand -base64 32</code> rồi đặt vào <code>.env</code>.
      </p>
    );
  }

  if (recoveryCodes) {
    return (
      <div>
        <div className="alert alert-warning">
          <strong>Lưu ngay bộ mã dưới đây.</strong> Đây là lần DUY NHẤT chúng hiện ra. Mất điện
          thoại mà không có mã khôi phục thì không còn đường vào tài khoản.
        </div>
        <ul
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 8,
            fontFamily: "monospace",
            margin: "16px 0",
            listStyle: "none",
            padding: 0,
          }}
        >
          {recoveryCodes.map((item) => (
            <li key={item} className="badge badge-primary">
              {item}
            </li>
          ))}
        </ul>
        <Button type="button" onClick={() => setRecoveryCodes(null)}>
          Tôi đã lưu xong
        </Button>
      </div>
    );
  }

  if (enabled) {
    const handleDisable = () => {
      setError(null);
      startTransition(async () => {
        const result = await disableTwoFactorAction(password, code);
        if (result.error) setError(result.error);
        else {
          setCode("");
          setPassword("");
        }
      });
    };

    const handleRegenerate = () => {
      setError(null);
      startTransition(async () => {
        const result = await regenerateRecoveryCodesAction(code);
        if (result.error) setError(result.error);
        else {
          setCode("");
          setRecoveryCodes(result.recoveryCodes ?? []);
        }
      });
    };

    return (
      <div style={{ display: "grid", gap: 12 }}>
        <p>
          <span className="badge badge-success">Đang bật</span>
          {enabledAt && <span style={{ marginLeft: 8 }}>từ {enabledAt}</span>}
        </p>
        <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
          Còn <strong>{recoveryCodesRemaining}</strong> mã khôi phục chưa dùng.
        </p>

        <label>
          <span>Mã xác thực (hoặc mã khôi phục)</span>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
          />
        </label>
        <label>
          <span>Mật khẩu (chỉ cần khi TẮT 2FA)</span>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && (
          <p role="alert" className="alert alert-danger">
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button type="button" variant="outline" onClick={handleRegenerate} disabled={isPending}>
            Cấp lại mã khôi phục
          </Button>
          <Button type="button" variant="outline" onClick={handleDisable} disabled={isPending}>
            Tắt 2FA
          </Button>
        </div>
      </div>
    );
  }

  if (!setup) {
    return (
      <Button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await beginTwoFactorSetupAction();
            if (result.error) setError(result.error);
            else if (result.secret && result.uri)
              setSetup({ secret: result.secret, uri: result.uri });
          });
        }}
      >
        {isPending ? "Đang tạo…" : "Bật 2FA"}
      </Button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ fontSize: "0.9rem" }}>
        Quét mã QR bằng ứng dụng xác thực, hoặc nhập tay khoá bí mật dưới đây.
      </p>

      {/*
        QR vẽ NGAY TRONG TRÌNH DUYỆT, không gọi dịch vụ sinh QR nào.

        Chuỗi `otpauth://` chứa CHÍNH bí mật TOTP. Đưa nó vào URL của một dịch
        vụ bên ngoài (api.qrserver.com và tương tự) là trao thẳng yếu tố thứ
        hai cho bên thứ ba, và để lại bản sao trong log truy cập của họ.
      */}
      <canvas
        ref={canvasRef}
        width={200}
        height={200}
        role="img"
        aria-label="Mã QR thiết lập 2FA"
        style={{ borderRadius: 8, background: "#fff", padding: 8, width: 200, height: 200 }}
      />

      <code style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{setup.secret}</code>

      <label>
        <span>Nhập mã 6 số từ ứng dụng để xác nhận</span>
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="123456"
          autoComplete="one-time-code"
          inputMode="numeric"
        />
      </label>

      {error && (
        <p role="alert" className="alert alert-danger">
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Button
          type="button"
          disabled={isPending || code.length === 0}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await enableTwoFactorAction(code);
              if (result.error) setError(result.error);
              else {
                setSetup(null);
                setCode("");
                setRecoveryCodes(result.recoveryCodes ?? []);
              }
            });
          }}
        >
          {isPending ? "Đang bật…" : "Xác nhận và bật"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setSetup(null)} disabled={isPending}>
          Huỷ
        </Button>
      </div>
    </div>
  );
}
