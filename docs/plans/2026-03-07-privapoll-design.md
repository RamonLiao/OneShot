# PrivaPoll Design Document

**Date:** 2026-03-07
**Status:** Approved (brainstorming phase complete)

---

## 1. Core Concept

**One-liner:** A decentralized confidential prediction market with World ID Sybil resistance, CRE TEE-based privacy, and multi-chain payout.

### Differentiation

| | Polymarket etc. | PrivaPoll |
|---|---|---|
| Voting power | Capital-weighted (more money = more votes) | 1 person = 1 vote (World ID) |
| Privacy | Fully transparent on-chain | Individual bets encrypted, only TEE can decrypt |
| Sybil resistance | None | World ID Orb-level verification |
| Settlement transparency | On-chain verifiable | TEE attestation + on-chain result verifiable |

### Target Hackathon Tracks
- Best use of CRE (Confidential HTTP + multi-chain write + TEE encrypted settlement)
- Best use of World ID (Sybil resistance + privacy)
- Privacy track (if exists)

---

## 2. System Architecture

```
+-------------------------------------------------------------+
|                        User Side                             |
|                                                              |
|  +------------------+     +---------------------------+      |
|  | World Mini App   |     | Independent Web App       |      |
|  | (Next.js PWA)    |     | (Next.js + RainbowKit)    |      |
|  | - World ID auth  |     | - WalletConnect multi-ch  |      |
|  | - Place bets     |     | - Deposit funds           |      |
|  | - View results   |     | - Manage positions & Claim|      |
|  +--------+---------+     +-------------+-------------+      |
|           |              Shared API      |                   |
+-----------+-----------------------------+--------------------+
            |                             |
            v                             v
+-------------------------------------------------------------+
|  Next.js Backend (API Routes)                                |
|  - POST /api/worldid/verify  (World ID -> anon session)     |
|  - POST /api/bet             (receive encrypted bet -> blind)|
|  - GET  /api/markets         (public market info)            |
|  - GET  /api/positions       (user's positions, needs session)|
|  - POST /api/payout/prepare-claim (EIP-712 signature helper)|
|  - GET  /api/internal/*      (CRE Confidential HTTP only)   |
|                                                              |
|  +-------------+                                             |
|  | DB (blind)  |  Only stores ciphertext, backend can't read |
|  +-------------+                                             |
+-----------------------------+--------------------------------+
                              |
                              | CRE Confidential HTTP fetches ciphertext
                              v
+-------------------------------------------------------------+
|  Chainlink CRE Workflows (TEE)                              |
|                                                              |
|  Secrets: decryption private key (TEE-only)                  |
|                                                              |
|  Workflow 1 (P2): Bet Confirmation                           |
|    Trigger: EVM Log (BetIngress.BetPlaced)                   |
|    -> Confidential HTTP fetch ciphertext -> verify hash      |
|                                                              |
|  Workflow 2 (P0): Settlement (CORE)                          |
|    Trigger: EVM Log (MarketRegistry.MarketSettled)            |
|    -> Confidential HTTP fetch all ciphertexts                |
|    -> TEE decrypt -> calculate payouts -> multi-chain write  |
|                                                              |
|  Workflow 3 (P1): Oracle Auto-Settle                         |
|    Trigger: Cron                                             |
|    -> Confidential HTTP fetch external API                   |
|    -> Write result to MarketRegistry                         |
|                                                              |
+--------+----------+----------+-------------------------------+
         |          |          |
         v          v          v
+----------+ +----------+ +----------+
| Base     | | Arbitrum | | Optimism |  <- CRE supported testnets
| Sepolia  | | Sepolia  | | Sepolia  |
|          | |          | |          |
| Vault    | | Vault    | | Vault    |
+----------+ +----------+ +----------+

+-------------------------------------------+
| Control Chain (Base Sepolia)               |
|                                            |
| - MarketRegistry.sol (market lifecycle)    |
| - BetIngress.sol (bet event entry point)   |
| - Vault.sol (this chain also for funds)    |
+-------------------------------------------+

+-------------------------------------------+
| World Chain                                |
|                                            |
| - Vault.sol (MiniKit pay entry point)      |
+-------------------------------------------+
```

### Key Architecture Decisions

1. **Control chain = Base Sepolia** (not World Chain) -- CRE confirmed to support Base Sepolia EVM Log triggers
2. **Backend is blind** -- only stores ciphertext, encrypted with CRE public key, only TEE can decrypt
3. **Dual frontend, shared API** -- Mini App for World ID + betting, Web App for multi-chain deposit + claim
4. **CRE push + user pull hybrid** -- CRE writes claimable amounts to each chain's Vault, users claim via Web App + WalletConnect
5. **Vault.sol = BetEscrow + PayoutAdapter merged** -- one contract per chain, reduces deployment + audit cost
6. **Multi-chain deposit, no forced bridge** -- users deposit on their native chain

### Future: SUI Control Chain Support
- Backend `ChainAdapter` interface abstracts chain-specific logic
- Currently only `EVMAdapter (Base Sepolia)` implemented
- DB address fields use `string` type (compatible with SUI 32-byte addresses)
- CRE workflow config uses dynamic `chainSelectorName`
- SUI contracts would be new Move implementations, not adapters

---

## 3. Privacy Model: CRE Key Encryption

```
Key Pair Generation (one-time setup):
  - Private key -> stored as CRE workflow secret (TEE-only)
  - Public key -> published, frontend uses for encryption

Bet Encryption Flow:
  Frontend: ciphertext = encrypt({ optionId, amount, payoutChainId, payoutAddress }, crePublicKey)
  Backend:  stores ciphertext blindly, cannot decrypt
  Chain:    only ciphertextHash is recorded (via BetIngress event)
  CRE TEE:  fetches ciphertext via Confidential HTTP, decrypts with private key

Privacy Guarantee:
  - Backend operator cannot see bet content
  - On-chain observers only see hashes
  - Only CRE TEE can decrypt, and only during settlement
```

### Anti-Tampering: Triple Verification

```
Layer 1 - World ID Nullifier:
  - 1 person 1 vote per market
  - action_id = "market-{marketId}" -> unique nullifier per market
  - Orb-level verification required

Layer 2 - ciphertextHash on-chain:
  - BetIngress records keccak256(ciphertext) on-chain
  - CRE verifies hash matches before accepting decrypted bet
  - Backend cannot swap ciphertext without detection

Layer 3 - Dual Ledger:
  - Cache ledger (backend DB): fast, powers UX
  - Truth ledger (on-chain): Vault.deposits - BetIngress.amounts = real balance
  - CRE settlement uses on-chain data as ground truth, does not trust backend
```

---

## 4. Data Flows

### Flow 1: World ID Verification

```
User (World App)
  -> Open Mini App
  -> Trigger World ID verify (action_id = "privapoll-auth", level = Orb)
  -> World App headless proof -> return proof + nullifier_hash
  -> Mini App POST /api/worldid/verify
  -> Backend verifies with World verify endpoint
  -> userId = keccak256(nullifier_hash || app_salt)
  -> hashedUserId = keccak256(userId)
  -> Return JWT session { hashedUserId, crePublicKey }
  -> DONE: user verified, can deposit and bet
```

### Flow 2: Deposit (Multi-Chain)

```
Route A - Mini App (World Chain):
  MiniKit pay -> Vault_World.deposit(hashedUserId, amount)

Route B - Web App (other chains):
  WalletConnect -> Vault_Base.deposit(hashedUserId, amount)
  WalletConnect -> Vault_Arbitrum.deposit(hashedUserId, amount)
  ...

All Vaults emit Deposited(hashedUserId, amount)
Backend event listener syncs cache balance
```

### Flow 3: Place Bet (Encrypted, Fast)

```
Mini App:
  1. Select market, option, amount, payout chain + address
  2. Frontend encrypt: ciphertext = encrypt(bet, crePublicKey)
  3. World ID verify (action_id = "market-{marketId}") -> market-specific nullifier
  4. POST /api/bet { marketId, ciphertext, nullifier_hash, worldid_proof, amount, sourceChainId }

Backend:
  5. Verify World ID proof (1 person 1 vote for this market)
  6. Check cache balance >= amount
  7. Deduct cache balance
  8. Blind-store ciphertext to DB
  9. Server-side tx to control chain:
     BetIngress.placeBet(marketId, hashedUserId, ciphertextHash, amount, sourceChainId)
  10. Server-side tx to source chain:
     Vault.allocate(hashedUserId, amount)

User does NOT sign any tx -- just an API call, completes in ~1 second
```

### Flow 4: Settlement (CRE Core)

```
Trigger:
  - Manual: admin calls MarketRegistry.setResult(marketId, resultValue)
  - Auto: CRE Cron -> Confidential HTTP fetch external API -> write setResult()

MarketSettled event triggers CRE Workflow 2:
  1. Confidential HTTP -> GET /api/internal/bets?marketId={id} (all ciphertexts)
  2. TEE: decrypt each, verify hash == on-chain ciphertextHash
  3. TEE: calculate payouts by market type (Binary/Categorical/Scalar)
  4. Multi-chain writeReport to each Vault:
     Vault.recordPayout(hashedUserId, marketId, amount)
  5. Update control chain: MarketRegistry.markFullySettled(marketId)
```

### Flow 5: Claim Payout (Web App)

```
User (Web App):
  1. Connect WalletConnect (MetaMask / Rainbow etc.)
  2. World ID verify (IDKit web widget) -> session with hashedUserId
  3. GET /api/positions -> view payout status per market per chain
  4. Select market + chain to claim
  5. POST /api/payout/prepare-claim { marketId, chainId }
     -> Backend returns EIP-712 signature { hashedUserId, marketId, amount, deadline, sig }
  6. WalletConnect tx on target chain:
     Vault.claim(marketId, amount, deadline, backendSig)
  7. Vault verifies signature, transfers tokens, marks claimed
```

---

## 5. Smart Contract Specifications

### 5.1 Control Chain (Base Sepolia)

#### MarketRegistry.sol

```solidity
enum MarketType { Binary, Categorical, Scalar }
enum Status { Open, Closed, Settled }

struct Market {
    uint256 id;
    string question;
    string[] options;          // Binary: ["Yes","No"], Categorical: N options
    MarketType marketType;
    uint256 closeTime;
    Status status;
    int256 scalarLow;          // Scalar only: range lower bound
    int256 scalarHigh;         // Scalar only: range upper bound
    int256 resultValue;        // Scalar: actual value, Binary/Categorical: winningOptionId
    address creator;
    string oracleApiUrl;       // empty = manual settlement
}

// Functions
createMarket(string question, string[] options, MarketType marketType,
             uint256 closeTime, int256 scalarLow, int256 scalarHigh,
             string oracleApiUrl) -> uint256 marketId
closeMarket(uint256 marketId)
setResult(uint256 marketId, int256 resultValue)  // admin or CRE trusted signer
markFullySettled(uint256 marketId)                // CRE only

// Events
MarketCreated(uint256 indexed marketId, MarketType marketType, string question)
MarketClosed(uint256 indexed marketId)
MarketSettled(uint256 indexed marketId, int256 resultValue)
```

#### BetIngress.sol

```solidity
mapping(bytes32 => mapping(uint256 => bool)) public hasBet;
// hashedUserId => marketId => bool

// Functions
placeBet(uint256 marketId, bytes32 hashedUserId, bytes32 ciphertextHash,
         uint256 amount, uint8 sourceChainId)  // onlyOperator

// Events
BetPlaced(uint256 indexed marketId, bytes32 indexed hashedUserId,
          bytes32 ciphertextHash, uint256 amount, uint8 sourceChainId)
```

### 5.2 All Supported Chains

#### Vault.sol (deployed per chain)

```solidity
IERC20 public token; // testnet USDC

// Deposit
mapping(bytes32 => uint256) public deposits;     // hashedUserId => total deposited
mapping(bytes32 => uint256) public allocated;     // hashedUserId => total locked to bets

// Payout
mapping(bytes32 => mapping(uint256 => uint256)) public claimable;  // user => market => amount
mapping(bytes32 => mapping(uint256 => bool)) public claimed;

address public trustedSigner;  // CRE DON signer
address public operator;       // backend operator

// Functions
deposit(bytes32 hashedUserId, uint256 amount)
allocate(bytes32 hashedUserId, uint256 amount)  // onlyOperator
recordPayout(bytes32 hashedUserId, uint256 marketId, uint256 amount, bytes creSignature)
claim(uint256 marketId, uint256 amount, uint256 deadline, bytes backendSig)

// Views
available(bytes32 hashedUserId) -> uint256  // deposits - allocated
claimableAmount(bytes32 hashedUserId, uint256 marketId) -> uint256

// Events
Deposited(bytes32 indexed hashedUserId, uint256 amount)
Allocated(bytes32 indexed hashedUserId, uint256 amount)
PayoutRecorded(bytes32 indexed hashedUserId, uint256 indexed marketId, uint256 amount)
Claimed(bytes32 indexed hashedUserId, uint256 indexed marketId, address to, uint256 amount)
```

### 5.3 Deployment Matrix

| Contract | Base Sepolia (control) | Arbitrum Sepolia | Optimism Sepolia | World Chain |
|----------|----------------------|-----------------|-----------------|-------------|
| MarketRegistry | Y | | | |
| BetIngress | Y | | | |
| Vault | Y | Y | Y | Y |

---

## 6. CRE Workflow Specifications

### Workflow 1: Bet Confirmation (P2 - optional for hackathon)
- Trigger: EVM Log (BetIngress.BetPlaced)
- Steps: Confidential HTTP fetch ciphertext -> verify hash -> decrypt -> validate format -> confirm
- Purpose: Early detection of invalid bets

### Workflow 2: Settlement (P0 - CORE)
- Trigger: EVM Log (MarketRegistry.MarketSettled)
- Steps:
  1. Confidential HTTP fetch all ciphertexts for market
  2. TEE: decrypt each, verify hash == on-chain ciphertextHash
  3. TEE: calculate payouts by market type
  4. Multi-chain writeReport to Vault contracts
  5. Update control chain: markFullySettled
- Payout calculation:
  - Binary/Categorical: winners share pool proportional to bet amount
  - Scalar: inverse-distance weighted distribution

### Workflow 3: Oracle Auto-Settle (P1)
- Trigger: Cron (every 5 min)
- Steps:
  1. Confidential HTTP fetch pending settlements from backend
  2. Confidential HTTP fetch external API (e.g. CoinGecko) for result
  3. Write MarketRegistry.setResult() -> triggers Workflow 2

### Workflow Secrets
- `decryptionKey`: private key for decrypting bet ciphertexts
- `backendHmacSecret`: shared secret for authenticating internal API calls

---

## 7. Backend API Specification

### Public API (Mini App + Web App)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/worldid/verify | none | World ID verification -> session |
| GET | /api/markets | none | Public market list |
| GET | /api/markets/:id | none | Single market detail + aggregate odds |
| POST | /api/bet | session | Place encrypted bet |
| GET | /api/positions | session | User's positions across markets/chains |
| POST | /api/payout/prepare-claim | session | Generate EIP-712 claim signature |

### Internal API (CRE Confidential HTTP only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/internal/bet/:ciphertextHash | Fetch single ciphertext |
| POST | /api/internal/bet/:ciphertextHash/confirm | Mark bet confirmed by CRE |
| GET | /api/internal/bets?marketId={id} | Fetch all ciphertexts for market |
| GET | /api/internal/pending-settlements | Markets awaiting auto-settlement |

Internal API auth: HMAC signature using shared secret (only TEE can produce valid sig).

---

## 8. DB Schema

```
users:       hashedUserId (PK), sessionExpiry, createdAt
balances:    hashedUserId (FK), chainId, deposited, allocated
bets:        betId (PK/uuid), marketId, hashedUserId, ciphertextHash, ciphertext (blob),
             amount, sourceChainId, onchainTxHash, creConfirmed, createdAt
markets:     marketId (PK), question, options (json), marketType, status,
             resultValue, oracleApiUrl, closeTime
payouts:     hashedUserId, marketId, chainId, amount, claimed, claimTxHash
```

- `balances.deposited` synced from on-chain Vault.Deposited events
- `bets.ciphertext` is opaque to backend (encrypted with CRE public key)
- `markets` table is a cache; source of truth is on-chain MarketRegistry

---

## 9. Tech Stack

| Layer | Technology |
|-------|-----------|
| Mini App Frontend | Next.js (App Router) + MiniKit JS |
| Web App Frontend | Next.js (App Router) + RainbowKit + wagmi |
| Backend | Next.js API Routes |
| Database | PostgreSQL (or SQLite for hackathon) |
| Smart Contracts | Solidity ^0.8.24, Hardhat/Foundry |
| CRE Workflows | TypeScript, @chainlink/cre-sdk |
| World ID | IDKit (web) + MiniKit (mini app) |

---

## 10. Implementation Phases

| Phase | Scope | Goal |
|-------|-------|------|
| P0: Core Demo | Binary market + single chain (Base Sepolia) + Mini App + manual settlement + CRE settlement workflow | End-to-end: World ID -> encrypted bet -> CRE decrypt & settle -> payout |
| P1: Multi-chain + Oracle | Add Arbitrum/OP Vaults + Web App claim + Oracle auto-settle + Bet Confirmation workflow | Demo CRE multi-chain write + Confidential HTTP external API |
| P2: Full Product | Categorical + Scalar markets + World Chain MiniKit deposit + polished UX | Complete product experience |

---

## Appendix: CRE Limitations (Perplexity Hallucination Corrections)

| Perplexity Claimed | Reality |
|--------------------|---------|
| `positionsStore` in TEE | Does NOT exist. CRE workflows are stateless. |
| Persistent mutable state in TEE | No cross-invocation state. Use off-chain encrypted DB + Confidential HTTP. |
| MiniKit multi-chain tx | MiniKit sendTransaction is World Chain ONLY. |
| World Chain CRE support | UNCONFIRMED. Use Base Sepolia as control chain. |
