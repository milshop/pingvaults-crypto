# pingvaults-crypto

> The open-source encryption core of [PingVaults](https://www.pingvaults.com) — published for independent security auditing.

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](#running-tests)

---

## Why this exists

PingVaults is a commercial product. Its business logic, UI, and infrastructure are proprietary.

**But the encryption layer is different.** The core cryptographic operations run in the browser. We publish the relevant core, UI paths, API routes, and offline decryptors here so you can:

- Inspect the algorithm and its implementation
- Check the intended save payload for answers or keys
- Run independent tests with your own inputs
- Inspect the offline decryptor HTML files

---

## What's in this repo

```
src/
  crypto.ts                        ← Encryption core (PBKDF2 + AES-256-GCM)
components/
  VaultForm.tsx                    ← User input UI + triggers encryption
  VaultFetch.tsx                   ← Fetch ciphertext from Arweave + triggers decryption
  VaultSave.tsx                    ← Uploads ciphertext to Arweave, writes metadata to DB
  VaultEdit.tsx                    ← Decrypt → edit → re-encrypt flow
app/api/vault/
  save/route.ts                    ← Server: validation for the intended ciphertext-only save payload
  fetch/route.ts                   ← Server: what it returns to the client
app/api/ping/
  reset/route.ts                   ← Ping check-in reset endpoint
test/
  vectors.test.ts                  ← Fixed test vectors — independently verifiable
offline/
  decrypt.html                     ← Standalone offline decryptor (English)
  decrypt-zh.html                  ← Standalone offline decryptor (Chinese)
```

The server-side API routes (`save`, `fetch`) are particularly important for auditing:
- `save/route.ts` shows what the intended save endpoint accepts and stores
- `fetch/route.ts` shows what the server returns — no decryption happens server-side

---

## Algorithm

| Component | Implementation |
|-----------|---------------|
| Key derivation | PBKDF2-SHA256, **600,000 iterations** (OWASP 2023) |
| Encryption | AES-256-GCM (authenticated encryption) |
| Salt | 32 bytes (256-bit), cryptographically random per encryption |
| IV | 12 bytes (96-bit), cryptographically random per encryption |
| Key structure | `PBKDF2(normalize(a₀) \| normalize(a₁) \| … \| normalize(aₙ), salt)` |
| Order sensitivity | `[name, question]` ≠ `[question, name]` — order is part of the key |

The implementation uses standard WebCrypto primitives rather than a custom cipher. Security still depends on phrase quality, endpoint integrity, browser code, and correct use.

---

## Data flow

```
Your answers (browser only)
        │
        ▼
   normalizeInput()          ← trim, lowercase, full→half-width
        │
        ▼
   join with "|" separator
        │
        ▼
   PBKDF2-SHA256              ← 600,000 iterations + random 32-byte salt
        │
        ▼
   AES-256-GCM key
        │
        ▼
   encrypt(plaintext)         ← random 12-byte IV
        │
        ▼
   ciphertext (Base64)        ← sent with public parameters and recovery metadata
```

**Intended vault-save payload:** `ciphertext`, `salt`, `iv`, key schema types, question text
**Intentionally omitted from that payload:** answers, derived keys, plaintext

This describes the published code path, not a cryptographic attestation of the complete proprietary deployment. Inspect live network behavior and treat deployment integrity as a separate trust boundary.

---

## Running tests

```bash
npm install
npm test
```

The test suite includes:
- `normalizeInput` behavior with fixed inputs → expected outputs
- `validateSelections` edge cases
- `deriveKeyFingerprint` stability (changing algorithm = test failure = breaking existing vaults)
- Encrypt/decrypt round-trips with correct and incorrect answers
- AES-GCM authentication tag verification (tampered ciphertext fails)
- Answer order sensitivity verification

---

## Offline decryptors

The `offline/` directory contains standalone HTML files that:
- Implement the same algorithm as `src/crypto.ts`
- Have zero CDN or library dependencies
- Can work offline from exported ciphertext; the optional TxID retrieval button makes requests to Irys or Arweave gateways
- Can be saved and used even if pingvaults.com is unreachable

Download the appropriate file and open it in any browser:
- [decrypt.html](offline/decrypt.html) — English
- [decrypt-zh.html](offline/decrypt-zh.html) — Chinese (中文)

---

## Verifying the live site uses this code

The live site at [pingvaults.com/verify](https://www.pingvaults.com/verify) publishes:

1. **Build-time SHA-256 hashes** of this file and other critical source files
2. **A batch verification script** you can run locally: `pbpaste | bash`
3. **JS bundle hashing steps** that can record and compare delivered chunks, but cannot prove unpublished application source
4. **A live CSP header inspector** showing which origins the page's JS is allowed to contact

---

## Security notes

- **Key uniqueness:** Each encryption generates a fresh random salt and IV. Two encryptions of the same plaintext with the same answers produce different ciphertext.
- **Authentication:** AES-GCM includes a 128-bit authentication tag. Tampered ciphertext will always fail decryption — no silent corruption.
- **Normalization transparency:** Input normalization rules are fully documented and tested. Users are shown exactly how their answers will be processed before they commit.
- **Order sensitivity:** The sequence of key fields is intentional and part of the key. It is stored as recovery metadata and should not be treated as additional entropy.
- **Phrase quality:** PBKDF2 raises the cost of each guess but cannot make names, dates, phone digits, or other predictable values secure. Use a unique, randomly generated recovery phrase as the primary secret.
- **Assurance status:** The published artifacts have not completed an independent security audit or penetration test as of September 3, 2026.

---

## License

MIT — use freely for any purpose, including commercial.
Attribution appreciated but not required.

---

## Main product

[PingVaults](https://www.pingvaults.com) — Client-side encrypted recovery instructions with inactivity-based contact delivery.
