import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const CIPHER = "aes-256-gcm";
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
export const EXCHANGE_CREDENTIALS_ENCRYPTION_VERSION = 1;

export type EncryptedCredential = {
  ciphertext: string;
  nonce: string;
  tag: string;
  version: number;
};

export class ExchangeCredentialConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeCredentialConfigurationError";
  }
}

function getEncryptionKey(): Buffer {
  const encoded = process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY;
  if (!encoded) {
    throw new ExchangeCredentialConfigurationError("EXCHANGE_CREDENTIALS_ENCRYPTION_KEY is required to store exchange credentials.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== encoded) {
    throw new ExchangeCredentialConfigurationError(
      "EXCHANGE_CREDENTIALS_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.",
    );
  }
  return key;
}

export function assertExchangeCredentialEncryptionConfigured(): void {
  getEncryptionKey();
}

export function encryptExchangeCredential(plaintext: string, context: string): EncryptedCredential {
  if (!plaintext || !context) throw new Error("Exchange credential and encryption context must not be empty.");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(CIPHER, getEncryptionKey(), nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: EXCHANGE_CREDENTIALS_ENCRYPTION_VERSION,
  };
}

export function decryptExchangeCredential(encrypted: EncryptedCredential, context: string): string {
  if (encrypted.version !== EXCHANGE_CREDENTIALS_ENCRYPTION_VERSION) {
    throw new Error(`Unsupported exchange credential encryption version: ${encrypted.version}`);
  }
  if (!context) throw new Error("Exchange credential decryption context must not be empty.");
  const nonce = Buffer.from(encrypted.nonce, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  if (nonce.length !== NONCE_BYTES || tag.length !== 16) {
    throw new Error("Stored exchange credential has invalid encryption metadata.");
  }
  const decipher = createDecipheriv(CIPHER, getEncryptionKey(), nonce);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
