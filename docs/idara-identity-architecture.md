# Idara — Decentralised Identity Network Architecture

> Idara is a self-sovereign identity (SSI) network: **issuers** attest facts, the
> **user's wallet** holds the credentials and keys, and **relying parties** (other
> companies' software) verify the user — with the user disclosing the minimum
> needed, often as a **zero-knowledge proof**. Account abstraction makes the
> wallet usable by people who will never touch crypto.
>
> The construction/FairShift app is **Idara's first relying party** — the
> bootstrapping wedge, not the product.

---

## 0. The one rule that keeps this correct

**No personal data, and no credentials, ever go on-chain.** The chain holds only
PII-free, public, tamper-evident state: issuer trust registry, revocation roots,
ZK verifier contracts, and smart-account infrastructure. Everything sensitive
lives in the user's wallet and moves peer-to-peer over HTTPS. Violating this rule
is how identity projects create permanent privacy disasters (and breach GDPR /
the Australian Privacy Act, since an immutable ledger can't honour erasure).

---

## 1. The three roles (and the three-sided network)

```
            issues VC                         requests proof
 ┌────────┐ ───────────▶ ┌──────────────┐ ◀─────────────── ┌───────────────┐
 │ ISSUER │              │   HOLDER      │                  │ RELYING PARTY │
 │(Idara, │              │  (the user's  │  presents ZK     │ (FairShift,   │
 │ RTO,   │              │   Idara       │  proof / VP      │  any 3rd-party│
 │ reg!.) │              │   wallet)     │ ───────────────▶ │  software)    │
 └────────┘              └──────────────┘                  └───────────────┘
      │                         │                                   │
      │ writes revocation       │ proves non-revocation             │ checks issuer
      │ + issuer state          │ in ZK                             │ in trust registry
      ▼                         ▼                                   ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  PUBLIC LEDGER (L2)  —  PII-FREE ONLY                                      │
 │  • Issuer trust registry   • Revocation / issuer-state roots (Merkle)     │
 │  • ZK verifier contracts    • ERC-4337 smart accounts    • audit anchors  │
 └─────────────────────────────────────────────────────────────────────────┘
```

The reason every prior decentralised-identity effort stalled is this triangle is
three-sided: no wallets without issuers, no issuers without relying parties, no
relying parties without wallets. **We break the deadlock by owning all three
sides inside one closed loop first** (construction: Idara issues inductions,
workers hold wallets, sites verify), then opening each side outward.

---

## 2. Component map

### Holder wallet (the heart of the product)
- **Smart account (ERC-4337 / account abstraction).** The user's identity anchor
  is a smart contract account, not an EOA/seed phrase.
  - **Passkey signer (WebAuthn / secp256r1)** → no seed phrase. Face/fingerprint.
  - **Paymaster** sponsors gas → the user never buys or sees a token.
  - **Social / guardian recovery** → lose your phone, keep your identity. For
    identity this is existential, not a nicety.
  - **Session keys** → smooth repeated presentations without re-signing each time.
- **Credential store** — VCs held locally (encrypted), backed up to user-controlled
  storage. Never on a server in the clear.
- **Client-side ZK prover** (WASM) — generates proofs on the device so raw claims
  never leave the wallet.
- **Consent UI** — every disclosure is an explicit, legible user approval.

### Issuer service (Idara + delegated issuers)
- **OpenID4VCI** issuance endpoint; signs VCs (e.g. White Card verified, Site
  Induction completed).
- Writes **revocation / issuer state** roots to the ledger.
- Issuer keys via `did:web` (domain-anchored, human-trustable).

### Verifier SDK + "Sign in with Idara"
- Drop-in for relying parties. **SIOPv2 + OpenID4VP** so integration feels exactly
  like "Sign in with Google," but returns *verified, user-consented claims*.
- Verifies proofs **off-chain** by default (fast, free); can defer to an
  **on-chain ZK verifier** when trustless/public settlement is needed (e.g. a
  physical access gate).
- **Autofill / pre-fill** is the same mechanism as login with a wider claim
  request: the wallet returns only the requested fields.

### On-chain contracts (L2, PII-free)
- **Issuer trust registry** — which DIDs may issue which credential types
  (e.g. "SafeWork → White Card"). Relying parties anchor trust here.
- **Revocation / issuer-state registry** — Merkle/sparse-Merkle roots; holders
  prove **non-revocation in ZK** against the current root.
- **ZK verifier contracts** — Groth16/PLONK verifiers for on-chain checks.
- **Account factory + AA infra** — smart-account deployment; bundler + paymaster.
- **Audit anchors** — periodic SHA-256 root of the off-chain audit log, for
  tamper-evidence without putting events on-chain.

### Idara console (closest to what exists today)
- Issuer onboarding, credential templates/schemas, revocation, analytics, and the
  **audit log** we already built.

---

## 3. The three core flows

### A. Issuance (issue → hold)
```
Idara verifies a fact (e.g. White Card check) ─▶ Issuer signs a VC (SD-JWT/ZK form)
   ─▶ OpenID4VCI offer (QR/deeplink) ─▶ wallet pulls + stores VC
   ─▶ issuer state/revocation root updated on-chain
```

### B. Presentation (present → verify), privacy-preserving
```
Relying party builds a request: "valid White Card AND unexpired Site-A induction"
   ─▶ OpenID4VP request ─▶ wallet asks user to consent
   ─▶ wallet generates ZK PROOF: "I hold valid, non-revoked credentials
       satisfying this predicate" — WITHOUT revealing card numbers, other
       credentials, or a stable identifier (unlinkable)
   ─▶ verifier checks proof (off-chain SDK or on-chain contract)
       + checks issuer in trust registry + non-revocation against root
   ─▶ allow / deny  (+ the existing decide() policy + audit entry)
```

### C. Sign in with Idara (the adoption bridge)
```
"Sign in with Idara" button (SIOPv2) ─▶ wallet authenticates the user
   ─▶ optional claim request prefilled with consent ─▶ relying party gets a
      verified session + only the claims the user agreed to share (autofill)
```

---

## 4. Where ZK actually earns its place

ZK is not decoration here — it does four concrete jobs:
1. **Selective disclosure** — prove a credential exists without revealing its
   contents (card number, address).
2. **Predicate proofs** — "age ≥ 18", "licence class ≥ X", "expiry > today"
   without revealing the underlying value.
3. **Unlinkability** — a fresh proof per presentation so verifiers/issuers can't
   correlate the user across sites and over time.
4. **Non-revocation** — prove a credential isn't in the on-chain revocation set,
   in zero knowledge.

**Do not hand-roll circuits.** ZK identity is a security minefield; use a
purpose-built stack:
- **Privado ID / Iden3** (formerly Polygon ID): Circom circuits, Baby Jubjub
  signatures, sparse-Merkle issuer state on-chain, ZK VC proofs — the most
  complete ZK-VC framework, and it maps 1:1 onto roles above.
- **Semaphore** for the simpler "prove anonymous membership of a verified group"
  cases (e.g. "a verified worker on this site" without saying which).
- Proof system: **Groth16** for production (tiny proofs, cheap on-chain verify;
  per-circuit trusted setup) or **Noir/PLONK** for flexibility.

---

## 5. On-chain vs off-chain (the honest split)

| Concern | Where | Why |
|---|---|---|
| Credentials, PII, claims | **Wallet (off-chain)** | User control; privacy law; never recoverable if leaked |
| Issuance / presentation exchange | **Off-chain (HTTPS, OpenID4VCI/VP)** | No reason to be public |
| Issuer trust registry | **On-chain** | Public, tamper-evident "who can issue what" |
| Revocation / issuer state roots | **On-chain** | Holders prove non-revocation in ZK against it |
| ZK verifier contracts | **On-chain** | Trustless verification when needed |
| Smart accounts (AA) | **On-chain (L2)** | The wallet's identity anchor + recovery |
| Audit log | **Off-chain, root anchored on-chain** | Keep events private, prove integrity |

**Chain choice:** an **L2** (Base, Polygon PoS/zkEVM, Arbitrum) for cheap gas;
with a paymaster the user pays nothing and never holds a token. Never L1 mainnet
for per-user actions.

---

## 6. Recommended stack

- **Accounts/AA:** ERC-4337 via Safe{Core} or ZeroDev/Biconomy/Pimlico
  (bundler + paymaster); passkey signer; guardian recovery module.
- **DIDs:** issuers `did:web`; holders `did:pkh`/`did:iden3` → smart account.
- **Credentials:** W3C VC Data Model 2.0; **SD-JWT VC** for non-ZK selective
  disclosure now, **Iden3/Privado** credential form for ZK.
- **Protocols:** OpenID4VCI (issue), OpenID4VP (present), SIOPv2 (sign-in),
  DIF Presentation Exchange (request language).
- **ZK:** Privado ID / Iden3 (Circom + Groth16) or Semaphore; client-side WASM
  prover.
- **Revocation:** on-chain sparse-Merkle issuer state + ZK non-revocation.

---

## 7. How this maps onto what we've already built

The current code is the **verifier/policy side** — and most of it survives:

| Today (`lib/idara/`) | Becomes |
|---|---|
| `CredentialVerifier` interface | the verification port; real impl verifies SD-JWT/ZK proofs + checks on-chain trust + revocation |
| `LocalCredentialVerifier` | dev/test stub only |
| `Credential` type | the issued VC schema |
| `decide()` engine | **unchanged in spirit** — still answers "does this person satisfy these requirements," now fed by verified presentations instead of our DB. The policy logic is reusable. |
| audit log (djb2) | upgrade to SHA-256; anchor roots on-chain |
| Schedule page | Idara's **first relying party** — "Sign in with Idara" + OpenID4VP to get verified credentials before rostering |

The key insight: **the eligibility/policy brain we built doesn't change; only the
source of truth under it changes** — from "a row in our database" to "a
cryptographically verified, user-consented, possibly zero-knowledge proof."

---

## 8. Phased build order (so we don't boil the ocean)

1. **Closed-loop MVP (centralised trust, real wallet UX).** AA wallet (passkey +
   paymaster + recovery), `did:web` issuer, SD-JWT VCs, off-chain verifier SDK,
   "Sign in with Idara" into the Schedule app. *No ZK, no chain yet beyond the
   smart account.* Proves the loop and the UX.
2. **Add the ledger.** Issuer trust registry + revocation roots on an L2; audit
   anchoring. Verifier checks them.
3. **Add ZK.** Swap SD-JWT presentations for ZK predicate + non-revocation proofs
   (Iden3/Privado). Unlinkability + minimal disclosure.
4. **Open the sides.** External issuers (RTOs, regulators); external relying
   parties via the SDK; generalise beyond construction.

> Account abstraction belongs in **phase 1** (it's the usability unlock).
> ZK belongs in **phase 3** (it's the privacy/differentiation unlock). Building
> ZK before the loop exists is the classic way to spend a year and ship nothing.

---

## 9. Honest risks

- **Three-sided cold-start** — mitigated only by the closed-loop wedge.
- **On-device ZK proving** can be slow/heavy on cheap Android hardware — measure
  early; it's a real UX constraint for a construction workforce.
- **Bleeding-edge surface area** — AA + ZK + SSI are each immature; leaning on
  Safe/ZeroDev and Iden3/Privado instead of hand-rolling is non-negotiable.
- **Key recovery is existential** — losing keys must never mean losing identity;
  guardian recovery is required, not optional.
- **Regulatory** — even with user-held data, Idara-as-issuer carries obligations;
  keep the ledger strictly PII-free (immutability vs. right-to-erasure).
```
