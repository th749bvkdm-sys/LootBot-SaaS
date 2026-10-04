import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

const SESSION_COOKIE = "lootbot_session";
const CSRF_COOKIE = "lootbot_csrf";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export { CSRF_COOKIE, SESSION_COOKIE, SESSION_TTL_MS };

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`scrypt$${salt}$${derivedKey.toString("hex")}`);
    });
  });
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  const [algorithm, salt, expectedHex] = parts;
  if (parts.length !== 3 || algorithm !== "scrypt" || !/^[a-f0-9]{32}$/i.test(salt ?? "") || !/^[a-f0-9]{128}$/i.test(expectedHex ?? "")) return false;

  const expected = Buffer.from(expectedHex, "hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, expected.length, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(
        expected.length === derivedKey.length &&
          timingSafeEqual(expected, derivedKey),
      );
    });
  });
}

function botEncryptionKey(): Buffer {
  const rootSecret = process.env.SESSION_SECRET;
  if (!rootSecret || rootSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(rootSecret),
      Buffer.from("lootbot-bot-token-encryption"),
      Buffer.from("v1"),
      32,
    ),
  );
}

export function encryptBotToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", botEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptBotToken(value: string): string {
  const [ivPart, tagPart, encryptedPart] = value.split(".");
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Stored bot credential is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    botEncryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function createId(): string {
  return randomUUID();
}
