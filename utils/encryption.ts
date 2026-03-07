import crypto from "crypto";

export function encryptAES(text: string, aesKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(aesKey, "hex"),
    iv
  );
  let encrypted = cipher.update(text, "utf-8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const combined = Buffer.concat([iv, encrypted]);
  return combined.toString("base64");
}

export function generateAESKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function encryptWithKEK(aesKey: string, kek: string): string {
  const cipher = crypto.createCipheriv(
    "aes-256-ecb",
    Buffer.from(kek, "hex"),
    null
  );
  let encrypted = cipher.update(aesKey, "hex", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}
