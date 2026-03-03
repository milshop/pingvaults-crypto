# pingvaults-crypto

> The open-source encryption core of [PingVaults](https://www.pingvaults.com) — published for independent security auditing.

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](#running-tests)

---

## Why this exists

PingVaults is a commercial product. Its business logic, UI, and infrastructure are proprietary.

**But the encryption layer is different.** The only code that ever touches your plaintext or answers runs entirely in your browser. We publish it here so you can:

- Audit the algorithm for backdoors
- Verify that no answers or keys are ever transmitted
- Run independent tests with your own inputs
- Inspect the offline decryptor HTML files

---

## What's in this repo

```
src/
  crypto.ts          ← Full encryption core (PBKDF2 + AES-256-GCM)
test/
  vectors.test.ts    ← Fixed test vectors — anyone can verify independently
offline/
  decrypt.html       ← Standalone offline decryptor (English)
  decrypt-zh.html    ← Standalone offline decryptor (Chinese)
```

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

**No secret algorithms. No custom crypto. Standard WebCrypto API only.**

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
   ciphertext (Base64)        ← ONLY this leaves your browser
```

**What the server receives:** `ciphertext`, `salt`, `iv`, key schema types, question text  
**What the server NEVER receives:** answers, derived keys, plaintext

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
- Have **zero external dependencies** — no CDN, no network requests
- Work entirely offline in any modern browser
- Can be saved and used even if pingvaults.com is unreachable

Download the appropriate file and open it in any browser:
- [decrypt.html](offline/decrypt.html) — English
- [decrypt-zh.html](offline/decrypt-zh.html) — Chinese (中文)

---

## Verifying the live site uses this code

The live site at [pingvaults.com/verify](https://www.pingvaults.com/verify) publishes:

1. **Build-time SHA-256 hashes** of this file and other critical source files
2. **A batch verification script** you can run locally: `pbpaste | bash`
3. **JS bundle integrity steps** to verify the deployed JavaScript matches a local build
4. **A live CSP header inspector** showing which origins the page's JS is allowed to contact

---

## Security notes

- **Key uniqueness:** Each encryption generates a fresh random salt and IV. Two encryptions of the same plaintext with the same answers produce different ciphertext.
- **Authentication:** AES-GCM includes a 128-bit authentication tag. Tampered ciphertext will always fail decryption — no silent corruption.
- **Normalization transparency:** Input normalization rules are fully documented and tested. Users are shown exactly how their answers will be processed before they commit.
- **Order sensitivity:** The sequence of key fields is intentional and part of the key. This prevents an attacker who knows some answers from brute-forcing the remainder.

---

## License

MIT — use freely for any purpose, including commercial.  
Attribution appreciated but not required.

---

## Main product

[PingVaults](https://www.pingvaults.com) — Zero-knowledge digital estate vault with dead man's switch delivery.
