import { describe, it, expect } from "vitest";
import { buildSignedHeaders } from "../switchbot";

describe("buildSignedHeaders", () => {
  it("produces deterministic HMAC-SHA256 signature from fixed inputs", () => {
    const token = "test-token";
    const secret = "test-secret";
    const timestamp = 1700000000000;
    const nonce = "fixed-nonce";

    const headers = buildSignedHeaders(token, secret, timestamp, nonce);

    expect(headers["Authorization"]).toBe(token);
    expect(headers["t"]).toBe(String(timestamp));
    expect(headers["nonce"]).toBe(nonce);
    // sign = HMAC-SHA256(token + timestamp + nonce, secret) → base64
    expect(headers["sign"]).toBe("PT+65CgDgeaPQkE0dGVH+8cEY0nnQqHAYUDPZZbXVJQ=");
  });
});
