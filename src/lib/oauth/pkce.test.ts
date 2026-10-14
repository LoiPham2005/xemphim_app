import { describe, expect, it } from "vitest";
import { createCodeChallenge, generateCodeVerifier, generateOAuthState } from "./pkce";

describe("PKCE", () => {
  it("createCodeChallenge khớp vector kiểm thử ở RFC 7636 Appendix B", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(createCodeChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("state và code_verifier là base64url — không chứa +, /, = như base64 thường", () => {
    const state = generateOAuthState();
    const verifier = generateCodeVerifier();

    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("mỗi lần gọi sinh một giá trị khác nhau", () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});
