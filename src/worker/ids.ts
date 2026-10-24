// Lowercase alphanumerics: safe in email local parts, URLs and R2 keys.
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const LETTERS_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const ID_RANDOM_LENGTH = 20;

export type IdPrefix =
  | "acc"
  | "key"
  | "prj"
  | "inb"
  | "msg"
  | "att"
  | "aud"
  | "tsn"
  | "out"
  | "evt"
  | "whk"
  | "dlv"
  | "upl"
  | "nhk"
  | "ndl"
  | "drf";

/** Cryptographically random string over the alphabet, using rejection sampling to avoid modulo bias. */
function randomFrom(alphabet: string, length: number): string {
  const largestUnbiasedByte = 256 - (256 % alphabet.length);
  let result = "";
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < largestUnbiasedByte && result.length < length) result += alphabet[byte % alphabet.length];
    }
  }
  return result;
}

/** Random lowercase alphanumerics. */
export function randomString(length: number): string {
  return randomFrom(ID_ALPHABET, length);
}

/** Random lowercase letters, used where digits would read as part of a name (project keys). */
export function randomLetters(length: number): string {
  return randomFrom(LETTERS_ALPHABET, length);
}

export function createId(prefix: IdPrefix): string {
  return `${prefix}_${randomString(ID_RANDOM_LENGTH)}`;
}

export function isIdOf(prefix: IdPrefix, value: string): boolean {
  return new RegExp(`^${prefix}_[0-9a-z]{${ID_RANDOM_LENGTH}}$`).test(value);
}
