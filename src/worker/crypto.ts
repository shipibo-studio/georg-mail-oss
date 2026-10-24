/** Lowercase hex SHA-256. Enough for high-entropy secrets (keys, tokens): no salt or slow hash needed. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Secrets of third parties (a Slack webhook URL, a customer's AI provider key) stored with AES-GCM.
// The key is derived from a Worker secret with HKDF under a label per kind of secret, so one kind
// can never be decrypted as another, and each ciphertext is bound to its owner's id as additional
// data, so it cannot be copied into another row. Format: "v1.<iv>.<ciphertext>", base64.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SEALED_FORMAT_VERSION = "v1";
const IV_BYTES = 12;

type Base64Bytes = Uint8Array & { toBase64(): string };
const toBase64 = (bytes: Uint8Array) => (bytes as Base64Bytes).toBase64();
const fromBase64 = (text: string) =>
  (Uint8Array as unknown as { fromBase64(text: string): Uint8Array }).fromBase64(text);

async function sealingKey(masterKey: string, label: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(masterKey), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode(label) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealSecret(masterKey: string, label: string, ownerId: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(ownerId) },
    await sealingKey(masterKey, label),
    encoder.encode(secret),
  );
  return `${SEALED_FORMAT_VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

/** Null when the value was tampered with, belongs to another owner, is of another kind or the key changed. */
export async function openSecret(
  masterKey: string,
  label: string,
  ownerId: string,
  stored: string,
): Promise<string | null> {
  const [version, iv, ciphertext] = stored.split(".");
  if (version !== SEALED_FORMAT_VERSION || !iv || !ciphertext) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(ownerId) },
      await sealingKey(masterKey, label),
      fromBase64(ciphertext),
    );
    return decoder.decode(plaintext);
  } catch {
    return null;
  }
}
