import { webcrypto } from "crypto";

// Polyfill for Node.js 18.x where globalThis.crypto isn't defined by default
// (MongoDB driver needs it internally). Safe to keep even after upgrading Node.
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}
