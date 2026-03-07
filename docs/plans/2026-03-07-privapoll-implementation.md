# PrivaPoll Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a confidential prediction market with World ID Sybil resistance, CRE TEE-based privacy, and multi-chain payout.

**Architecture:** Monorepo with three packages: `contracts/` (Foundry Solidity), `app/` (Next.js shared backend + dual frontend), `cre/` (CRE TypeScript workflows). Backend blindly stores encrypted bets; CRE TEE decrypts and settles; Vault contracts handle deposits and payouts per chain.

**Tech Stack:** Solidity ^0.8.24 (Foundry), Next.js 14 App Router, @chainlink/cre-sdk, @worldcoin/minikit-js, @worldcoin/idkit, RainbowKit + wagmi + viem, SQLite (better-sqlite3), ethers.js (backend operator txs)

**Design Doc:** `docs/plans/2026-03-07-privapoll-design.md`

---

## Phase 0: Core Demo (Binary Market, Single Chain, End-to-End)

Goal: World ID -> encrypted bet -> CRE decrypt & settle -> payout on Base Sepolia

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json` (root workspace)
- Create: `contracts/foundry.toml`
- Create: `app/package.json`
- Create: `cre/package.json`
- Create: `.gitignore`
- Create: `.env.example`

**Step 1: Initialize root workspace**

```bash
mkdir -p contracts/src contracts/test contracts/script app cre
```

Root `package.json`:
```json
{
  "name": "privapoll",
  "private": true,
  "workspaces": ["app", "cre"]
}
```

**Step 2: Initialize Foundry project**

```bash
cd contracts && forge init --no-git --no-commit
```

Update `foundry.toml`:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200

[profile.default.fuzz]
runs = 256
```

**Step 3: Initialize Next.js app**

```bash
cd app && npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --use-npm --no-import-alias
```

Install deps:
```bash
cd app && npm install @worldcoin/minikit-js @worldcoin/idkit @rainbow-me/rainbowkit wagmi viem @tanstack/react-query jose uuid better-sqlite3 ethers
npm install -D @types/uuid @types/better-sqlite3
```

**Step 4: Initialize CRE workspace**

`cre/package.json`:
```json
{
  "name": "@privapoll/cre",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "tsc",
    "test": "vitest"
  },
  "dependencies": {
    "@chainlink/cre-sdk": "latest",
    "viem": "^2.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

**Step 5: Create .env.example**

```env
# Backend
DATABASE_URL=file:./dev.db
WORLD_APP_ID=app_xxx
APP_SALT=privapoll-salt-v1
OPERATOR_PRIVATE_KEY=0x...
JWT_SECRET=xxx
CRE_PUBLIC_KEY=xxx
BACKEND_HMAC_SECRET=xxx

# Chains
BASE_SEPOLIA_RPC=https://sepolia.base.org
MARKET_REGISTRY_ADDRESS=0x...
BET_INGRESS_ADDRESS=0x...
VAULT_BASE_ADDRESS=0x...
```

**Step 6: Create .gitignore**

```
node_modules/
.env
.env.local
contracts/out/
contracts/cache/
app/.next/
*.db
```

**Step 7: Commit**

```bash
git init && git add -A
git commit -m "chore: scaffold monorepo with contracts, app, cre workspaces"
```

---

### Task 2: MarketRegistry.sol

**Files:**
- Create: `contracts/src/MarketRegistry.sol`
- Create: `contracts/test/MarketRegistry.t.sol`

**Step 1: Write the failing tests**

```solidity
// contracts/test/MarketRegistry.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MarketRegistry.sol";

contract MarketRegistryTest is Test {
    MarketRegistry registry;
    address admin = address(this);
    address trustedSigner = address(0xCRE);

    function setUp() public {
        registry = new MarketRegistry(admin, trustedSigner);
    }

    function test_createBinaryMarket() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";

        uint256 marketId = registry.createMarket(
            "Will ETH hit 10k?", options,
            MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, ""
        );

        assertEq(marketId, 0);
    }

    function test_createMarket_emitsEvent() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";

        vm.expectEmit(true, false, false, true);
        emit MarketRegistry.MarketCreated(0, MarketRegistry.MarketType.Binary, "Test?");

        registry.createMarket("Test?", options, MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, "");
    }

    function test_setResult_onlyAdminOrTrusted() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";
        registry.createMarket("Test?", options, MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, "");

        registry.setResult(0, 1);

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        registry.setResult(0, 0);
    }

    function test_setResult_emitsMarketSettled() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";
        registry.createMarket("Test?", options, MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, "");

        vm.expectEmit(true, false, false, true);
        emit MarketRegistry.MarketSettled(0, 1);
        registry.setResult(0, 1);
    }

    function test_markFullySettled_onlyTrustedSigner() public {
        string[] memory options = new string[](2);
        options[0] = "Yes";
        options[1] = "No";
        registry.createMarket("Test?", options, MarketRegistry.MarketType.Binary,
            block.timestamp + 1 days, 0, 0, "");
        registry.setResult(0, 1);

        vm.prank(trustedSigner);
        registry.markFullySettled(0);

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        registry.markFullySettled(0);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd contracts && forge test --match-contract MarketRegistryTest -v`
Expected: Compilation error (MarketRegistry.sol doesn't exist)

**Step 3: Write MarketRegistry.sol**

```solidity
// contracts/src/MarketRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MarketRegistry {
    enum MarketType { Binary, Categorical, Scalar }
    enum Status { Open, Closed, Settled, FullySettled }

    struct Market {
        uint256 id;
        string question;
        string[] options;
        MarketType marketType;
        uint256 closeTime;
        Status status;
        int256 scalarLow;
        int256 scalarHigh;
        int256 resultValue;
        address creator;
        string oracleApiUrl;
    }

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;
    address public admin;
    address public trustedSigner;

    event MarketCreated(uint256 indexed marketId, MarketType marketType, string question);
    event MarketClosed(uint256 indexed marketId);
    event MarketSettled(uint256 indexed marketId, int256 resultValue);
    event MarketFullySettled(uint256 indexed marketId);

    modifier onlyAdminOrTrusted() {
        require(msg.sender == admin || msg.sender == trustedSigner, "unauthorized");
        _;
    }

    modifier onlyTrustedSigner() {
        require(msg.sender == trustedSigner, "only trusted signer");
        _;
    }

    constructor(address _admin, address _trustedSigner) {
        admin = _admin;
        trustedSigner = _trustedSigner;
    }

    function createMarket(
        string calldata question,
        string[] calldata options,
        MarketType marketType,
        uint256 closeTime,
        int256 scalarLow,
        int256 scalarHigh,
        string calldata oracleApiUrl
    ) external onlyAdminOrTrusted returns (uint256) {
        require(closeTime > block.timestamp, "closeTime must be future");
        if (marketType == MarketType.Binary) {
            require(options.length == 2, "binary needs 2 options");
        } else if (marketType == MarketType.Categorical) {
            require(options.length >= 2, "need at least 2 options");
        } else if (marketType == MarketType.Scalar) {
            require(scalarLow < scalarHigh, "invalid scalar range");
        }

        uint256 marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.id = marketId;
        m.question = question;
        m.options = options;
        m.marketType = marketType;
        m.closeTime = closeTime;
        m.status = Status.Open;
        m.scalarLow = scalarLow;
        m.scalarHigh = scalarHigh;
        m.creator = msg.sender;
        m.oracleApiUrl = oracleApiUrl;

        emit MarketCreated(marketId, marketType, question);
        return marketId;
    }

    function closeMarket(uint256 marketId) external onlyAdminOrTrusted {
        Market storage m = markets[marketId];
        require(m.status == Status.Open, "not open");
        m.status = Status.Closed;
        emit MarketClosed(marketId);
    }

    function setResult(uint256 marketId, int256 resultValue) external onlyAdminOrTrusted {
        Market storage m = markets[marketId];
        require(m.status == Status.Open || m.status == Status.Closed, "already settled");
        m.status = Status.Settled;
        m.resultValue = resultValue;
        emit MarketSettled(marketId, resultValue);
    }

    function markFullySettled(uint256 marketId) external onlyTrustedSigner {
        Market storage m = markets[marketId];
        require(m.status == Status.Settled, "not settled");
        m.status = Status.FullySettled;
        emit MarketFullySettled(marketId);
    }

    function getMarketOptions(uint256 marketId) external view returns (string[] memory) {
        return markets[marketId].options;
    }
}
```

**Step 4: Run tests**

Run: `cd contracts && forge test --match-contract MarketRegistryTest -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add contracts/src/MarketRegistry.sol contracts/test/MarketRegistry.t.sol
git commit -m "feat(contracts): add MarketRegistry with lifecycle management"
```

---

### Task 3: BetIngress.sol

**Files:**
- Create: `contracts/src/BetIngress.sol`
- Create: `contracts/test/BetIngress.t.sol`

**Step 1: Write the failing tests**

```solidity
// contracts/test/BetIngress.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/BetIngress.sol";

contract BetIngressTest is Test {
    BetIngress ingress;
    address operator = address(0xABCD);

    function setUp() public {
        ingress = new BetIngress(operator);
    }

    function test_placeBet_emitsEvent() public {
        bytes32 userId = keccak256("user1");
        bytes32 cHash = keccak256("cipher1");

        vm.prank(operator);
        vm.expectEmit(true, true, false, true);
        emit BetIngress.BetPlaced(0, userId, cHash, 100, 1);
        ingress.placeBet(0, userId, cHash, 100, 1);
    }

    function test_placeBet_preventsDoubleBet() public {
        bytes32 userId = keccak256("user1");

        vm.startPrank(operator);
        ingress.placeBet(0, userId, keccak256("c1"), 100, 1);

        vm.expectRevert("already bet");
        ingress.placeBet(0, userId, keccak256("c2"), 200, 1);
        vm.stopPrank();
    }

    function test_placeBet_onlyOperator() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("only operator");
        ingress.placeBet(0, keccak256("u"), keccak256("c"), 100, 1);
    }

    function test_sameUserDifferentMarkets() public {
        bytes32 userId = keccak256("user1");
        vm.startPrank(operator);
        ingress.placeBet(0, userId, keccak256("c1"), 100, 1);
        ingress.placeBet(1, userId, keccak256("c2"), 200, 1);
        vm.stopPrank();

        assertTrue(ingress.hasBet(userId, 0));
        assertTrue(ingress.hasBet(userId, 1));
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cd contracts && forge test --match-contract BetIngressTest -v`
Expected: Compilation error

**Step 3: Write BetIngress.sol**

```solidity
// contracts/src/BetIngress.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BetIngress {
    mapping(bytes32 => mapping(uint256 => bool)) public hasBet;
    address public operator;

    event BetPlaced(
        uint256 indexed marketId,
        bytes32 indexed hashedUserId,
        bytes32 ciphertextHash,
        uint256 amount,
        uint8 sourceChainId
    );

    modifier onlyOperator() {
        require(msg.sender == operator, "only operator");
        _;
    }

    constructor(address _operator) {
        operator = _operator;
    }

    function placeBet(
        uint256 marketId,
        bytes32 hashedUserId,
        bytes32 ciphertextHash,
        uint256 amount,
        uint8 sourceChainId
    ) external onlyOperator {
        require(!hasBet[hashedUserId][marketId], "already bet");
        require(amount > 0, "amount must be > 0");
        hasBet[hashedUserId][marketId] = true;
        emit BetPlaced(marketId, hashedUserId, ciphertextHash, amount, sourceChainId);
    }
}
```

**Step 4: Run tests**

Run: `cd contracts && forge test --match-contract BetIngressTest -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add contracts/src/BetIngress.sol contracts/test/BetIngress.t.sol
git commit -m "feat(contracts): add BetIngress with double-bet prevention"
```

---

### Task 4: Vault.sol

**Files:**
- Create: `contracts/src/Vault.sol`
- Create: `contracts/test/Vault.t.sol`
- Create: `contracts/src/mocks/MockERC20.sol`

**Step 1: Install OpenZeppelin & create MockERC20**

```bash
cd contracts && forge install OpenZeppelin/openzeppelin-contracts --no-git --no-commit
```

```solidity
// contracts/src/mocks/MockERC20.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function decimals() public pure override returns (uint8) { return 6; }
}
```

**Step 2: Write the failing tests**

```solidity
// contracts/test/Vault.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Vault.sol";
import "../src/mocks/MockERC20.sol";

contract VaultTest is Test {
    Vault vault;
    MockERC20 token;
    address operator;
    uint256 operatorPk = 0x0BE7;
    address trustedSigner;
    uint256 trustedSignerPk = 0xA11CE;
    address user = address(0x1234);
    bytes32 hashedUserId = keccak256("user1");

    function setUp() public {
        operator = vm.addr(operatorPk);
        trustedSigner = vm.addr(trustedSignerPk);
        token = new MockERC20();
        vault = new Vault(address(token), operator, trustedSigner);
        token.mint(user, 10_000e6);
        token.mint(address(vault), 100_000e6);
    }

    function test_deposit() public {
        vm.startPrank(user);
        token.approve(address(vault), 1000e6);
        vault.deposit(hashedUserId, 1000e6);
        vm.stopPrank();
        assertEq(vault.deposits(hashedUserId), 1000e6);
        assertEq(vault.available(hashedUserId), 1000e6);
    }

    function test_allocate() public {
        vm.startPrank(user);
        token.approve(address(vault), 1000e6);
        vault.deposit(hashedUserId, 1000e6);
        vm.stopPrank();

        vm.prank(operator);
        vault.allocate(hashedUserId, 500e6);
        assertEq(vault.available(hashedUserId), 500e6);
    }

    function test_allocate_insufficient() public {
        vm.startPrank(user);
        token.approve(address(vault), 100e6);
        vault.deposit(hashedUserId, 100e6);
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert("insufficient");
        vault.allocate(hashedUserId, 200e6);
    }

    function test_recordPayout_validSignature() public {
        uint256 marketId = 0;
        uint256 amount = 500e6;

        bytes32 msgHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedSignerPk, ethHash);

        vault.recordPayout(hashedUserId, marketId, amount, abi.encodePacked(r, s, v));
        assertEq(vault.claimable(hashedUserId, marketId), amount);
    }

    function test_recordPayout_invalidSignature() public {
        uint256 fakePk = 0xDEAD;
        bytes32 msgHash = keccak256(abi.encodePacked(
            hashedUserId, uint256(0), uint256(500e6), block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakePk, ethHash);

        vm.expectRevert("invalid CRE signature");
        vault.recordPayout(hashedUserId, 0, 500e6, abi.encodePacked(r, s, v));
    }

    function test_claim_fullFlow() public {
        uint256 marketId = 0;
        uint256 amount = 500e6;

        // Record payout
        bytes32 msgHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedSignerPk, ethHash);
        vault.recordPayout(hashedUserId, marketId, amount, abi.encodePacked(r, s, v));

        // Claim
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 claimHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, deadline, block.chainid, address(vault)
        ));
        bytes32 ethClaimHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", claimHash
        ));
        (v, r, s) = vm.sign(operatorPk, ethClaimHash);

        uint256 before = token.balanceOf(user);
        vm.prank(user);
        vault.claim(hashedUserId, marketId, amount, deadline, abi.encodePacked(r, s, v));
        assertEq(token.balanceOf(user) - before, amount);
        assertTrue(vault.claimed(hashedUserId, marketId));
    }

    function test_claim_doubleClaim() public {
        uint256 marketId = 0;
        uint256 amount = 500e6;

        // Record payout
        bytes32 msgHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, block.chainid, address(vault)
        ));
        bytes32 ethHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", msgHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(trustedSignerPk, ethHash);
        vault.recordPayout(hashedUserId, marketId, amount, abi.encodePacked(r, s, v));

        // First claim
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 claimHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, deadline, block.chainid, address(vault)
        ));
        bytes32 ethClaimHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", claimHash
        ));
        (v, r, s) = vm.sign(operatorPk, ethClaimHash);

        vm.prank(user);
        vault.claim(hashedUserId, marketId, amount, deadline, abi.encodePacked(r, s, v));

        // Second claim should fail
        vm.prank(user);
        vm.expectRevert("already claimed");
        vault.claim(hashedUserId, marketId, amount, deadline, abi.encodePacked(r, s, v));
    }
}
```

**Step 3: Run tests to verify they fail**

Run: `cd contracts && forge test --match-contract VaultTest -v`
Expected: Compilation error

**Step 4: Write Vault.sol**

```solidity
// contracts/src/Vault.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import "lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

contract Vault {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    IERC20 public token;
    address public operator;
    address public trustedSigner;

    mapping(bytes32 => uint256) public deposits;
    mapping(bytes32 => uint256) public allocated;
    mapping(bytes32 => mapping(uint256 => uint256)) public claimable;
    mapping(bytes32 => mapping(uint256 => bool)) public claimed;

    event Deposited(bytes32 indexed hashedUserId, uint256 amount);
    event Allocated(bytes32 indexed hashedUserId, uint256 amount);
    event PayoutRecorded(bytes32 indexed hashedUserId, uint256 indexed marketId, uint256 amount);
    event Claimed(bytes32 indexed hashedUserId, uint256 indexed marketId, address to, uint256 amount);

    modifier onlyOperator() {
        require(msg.sender == operator, "only operator");
        _;
    }

    constructor(address _token, address _operator, address _trustedSigner) {
        token = IERC20(_token);
        operator = _operator;
        trustedSigner = _trustedSigner;
    }

    function deposit(bytes32 hashedUserId, uint256 amount) external {
        require(amount > 0, "amount must be > 0");
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[hashedUserId] += amount;
        emit Deposited(hashedUserId, amount);
    }

    function allocate(bytes32 hashedUserId, uint256 amount) external onlyOperator {
        require(available(hashedUserId) >= amount, "insufficient");
        allocated[hashedUserId] += amount;
        emit Allocated(hashedUserId, amount);
    }

    function recordPayout(
        bytes32 hashedUserId, uint256 marketId, uint256 amount, bytes calldata creSignature
    ) external {
        bytes32 messageHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, block.chainid, address(this)
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", messageHash
        ));
        require(ethSignedHash.recover(creSignature) == trustedSigner, "invalid CRE signature");

        claimable[hashedUserId][marketId] = amount;
        emit PayoutRecorded(hashedUserId, marketId, amount);
    }

    function claim(
        bytes32 hashedUserId, uint256 marketId, uint256 amount,
        uint256 deadline, bytes calldata backendSig
    ) external {
        require(block.timestamp <= deadline, "expired");
        require(claimable[hashedUserId][marketId] == amount, "amount mismatch");
        require(!claimed[hashedUserId][marketId], "already claimed");

        bytes32 messageHash = keccak256(abi.encodePacked(
            hashedUserId, marketId, amount, deadline, block.chainid, address(this)
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", messageHash
        ));
        require(ethSignedHash.recover(backendSig) == operator, "invalid backend signature");

        claimed[hashedUserId][marketId] = true;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(hashedUserId, marketId, msg.sender, amount);
    }

    function available(bytes32 hashedUserId) public view returns (uint256) {
        return deposits[hashedUserId] - allocated[hashedUserId];
    }
}
```

**Step 5: Run tests**

Run: `cd contracts && forge test --match-contract VaultTest -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add contracts/src/Vault.sol contracts/src/mocks/MockERC20.sol contracts/test/Vault.t.sol
git commit -m "feat(contracts): add Vault with deposit, allocate, payout, claim"
```

---

### Task 5: Deployment Script

**Files:**
- Create: `contracts/script/Deploy.s.sol`

**Step 1: Write deployment script**

```solidity
// contracts/script/Deploy.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MarketRegistry.sol";
import "../src/BetIngress.sol";
import "../src/Vault.sol";

contract DeployBaseSepolia is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address trustedSigner = vm.envAddress("CRE_TRUSTED_SIGNER");
        address tokenAddress = vm.envAddress("USDC_TOKEN_ADDRESS");

        vm.startBroadcast(deployerPk);
        MarketRegistry registry = new MarketRegistry(msg.sender, trustedSigner);
        BetIngress ingress = new BetIngress(operator);
        Vault vault = new Vault(tokenAddress, operator, trustedSigner);
        vm.stopBroadcast();

        console.log("MarketRegistry:", address(registry));
        console.log("BetIngress:", address(ingress));
        console.log("Vault:", address(vault));
    }
}
```

**Step 2: Verify compilation**

Run: `cd contracts && forge build`
Expected: Success

**Step 3: Commit**

```bash
git add contracts/script/Deploy.s.sol
git commit -m "feat(contracts): add Base Sepolia deployment script"
```

---

### Task 6: Backend Core — DB, Auth, Crypto, Chains

**Files:**
- Create: `app/src/lib/db.ts`
- Create: `app/src/lib/crypto.ts`
- Create: `app/src/lib/auth.ts`
- Create: `app/src/lib/chains.ts`
- Create: `app/src/lib/operator.ts`
- Create: `app/src/lib/hmac.ts`

**Step 1: Create all backend core modules**

See design doc section 7-8 for full DB schema and API spec. Implementation details:

- `db.ts`: SQLite via better-sqlite3, auto-creates tables on first access
- `crypto.ts`: AES-256-GCM encryption with CRE public key, keccak256 hash utils
- `auth.ts`: JWT session creation/verification via jose
- `chains.ts`: Supported chain config (Base Sepolia, Arbitrum Sepolia, Optimism Sepolia)
- `operator.ts`: ethers.js helpers for sending BetIngress.placeBet and Vault.allocate txs
- `hmac.ts`: HMAC verification for CRE internal API authentication

**Step 2: Commit**

```bash
git add app/src/lib/
git commit -m "feat(app): add backend core modules (db, auth, crypto, chains, operator, hmac)"
```

---

### Task 7: Backend — API Routes (World ID, Bet, Markets, Positions, Internal, Claim)

**Files:**
- Create: `app/src/app/api/worldid/verify/route.ts`
- Create: `app/src/app/api/bet/route.ts`
- Create: `app/src/app/api/markets/route.ts`
- Create: `app/src/app/api/markets/[id]/route.ts`
- Create: `app/src/app/api/positions/route.ts`
- Create: `app/src/app/api/payout/prepare-claim/route.ts`
- Create: `app/src/app/api/internal/bet/[hash]/route.ts`
- Create: `app/src/app/api/internal/bet/[hash]/confirm/route.ts`
- Create: `app/src/app/api/internal/bets/route.ts`
- Create: `app/src/app/api/internal/pending-settlements/route.ts`

**Step 1: Implement all API routes**

See design doc section 7 for full specification per endpoint.

Key routes:
- `/api/worldid/verify`: Verify World ID proof -> create JWT session
- `/api/bet`: Validate session -> check balance -> blind-store ciphertext -> send BetIngress tx
- `/api/markets`: Public market list with aggregate stats
- `/api/positions`: User's positions (requires session)
- `/api/payout/prepare-claim`: Generate EIP-712 signature for Vault.claim
- `/api/internal/*`: CRE-only endpoints with HMAC auth

**Step 2: Commit**

```bash
git add app/src/app/api/
git commit -m "feat(app): add all API routes (public + internal)"
```

---

### Task 8: CRE Settlement Workflow + Payout Logic

**Files:**
- Create: `cre/src/lib/payout.ts`
- Create: `cre/src/lib/decrypt.ts`
- Create: `cre/src/workflows/settlement.ts`
- Create: `cre/tests/payout.test.ts`

**Step 1: Write payout calculation tests**

```typescript
// cre/tests/payout.test.ts
import { describe, it, expect } from "vitest";
import { calculatePayouts, type DecryptedBet } from "../src/lib/payout";

describe("calculatePayouts", () => {
  const makeBet = (userId: string, optionId: number, amount: bigint): DecryptedBet => ({
    hashedUserId: userId, optionId, amount,
    payoutChainId: "base-sepolia", payoutAddress: "0x1234",
  });

  describe("Binary", () => {
    it("winners split pool proportionally", () => {
      const bets = [
        makeBet("u1", 1, 100n),
        makeBet("u2", 1, 300n),
        makeBet("u3", 0, 600n),
      ];
      const payouts = calculatePayouts("Binary", bets, 1n);
      expect(payouts).toHaveLength(2);
      expect(payouts.find(p => p.hashedUserId === "u1")?.amount).toBe(250n);
      expect(payouts.find(p => p.hashedUserId === "u2")?.amount).toBe(750n);
    });

    it("no winners = refund all", () => {
      const bets = [makeBet("u1", 0, 100n), makeBet("u2", 0, 200n)];
      const payouts = calculatePayouts("Binary", bets, 1n);
      expect(payouts).toHaveLength(2);
      expect(payouts.find(p => p.hashedUserId === "u1")?.amount).toBe(100n);
    });
  });

  describe("Scalar", () => {
    it("closer guess gets more", () => {
      const bets = [makeBet("u1", 100, 500n), makeBet("u2", 110, 500n)];
      const payouts = calculatePayouts("Scalar", bets, 100n);
      const p1 = payouts.find(p => p.hashedUserId === "u1")!;
      const p2 = payouts.find(p => p.hashedUserId === "u2")!;
      expect(p1.amount).toBeGreaterThan(p2.amount);
      expect(p1.amount + p2.amount).toBe(1000n);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd cre && npx vitest run tests/payout.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement payout.ts, decrypt.ts, settlement.ts**

See brainstorming session for full payout calculation logic (Binary/Categorical: proportional split; Scalar: inverse-distance weighted).

**Step 4: Run tests**

Run: `cd cre && npx vitest run tests/payout.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add cre/src/ cre/tests/
git commit -m "feat(cre): add settlement workflow with payout calculation and decrypt"
```

---

## Phase 1: Multi-Chain + Oracle

---

### Task 9: Multi-Chain Vault Deployment

**Files:**
- Create: `contracts/script/DeployVault.s.sol`

Deploy Vault.sol to Arbitrum Sepolia and Optimism Sepolia using same script with different RPC endpoints.

---

### Task 10: Web App — Deposit & Claim UI

**Files:**
- Create: `app/src/app/(webapp)/layout.tsx`
- Create: `app/src/app/(webapp)/deposit/page.tsx`
- Create: `app/src/app/(webapp)/claim/page.tsx`
- Create: `app/src/components/web/DepositForm.tsx`
- Create: `app/src/components/web/ClaimForm.tsx`
- Create: `app/src/lib/wagmi-config.ts`

RainbowKit + wagmi for WalletConnect. Route group `(webapp)` for Web App pages.

---

### Task 11: Mini App — World ID + Bet UI

**Files:**
- Create: `app/src/app/(miniapp)/layout.tsx`
- Create: `app/src/app/(miniapp)/page.tsx`
- Create: `app/src/app/(miniapp)/market/[id]/page.tsx`
- Create: `app/src/components/mini/WorldIDVerify.tsx`
- Create: `app/src/components/mini/BetForm.tsx`
- Create: `app/src/components/mini/MarketCard.tsx`

MiniKit for World ID verify + encrypted bet submission. Route group `(miniapp)` for Mini App pages.

---

### Task 12: Oracle Auto-Settle Workflow

**Files:**
- Create: `cre/src/workflows/oracle-settle.ts`

CRE Cron trigger -> Confidential HTTP fetch external API -> write MarketRegistry.setResult.

---

### Task 13: Event Listener for Balance Sync

**Files:**
- Create: `app/src/lib/event-listener.ts`

Poll Vault.Deposited events on all chains, sync `balances` table. Can be a standalone script or Next.js API cron.

---

## Phase 2: Full Product

---

### Task 14: Categorical & Scalar Market UI

Update BetForm to render different UI per market type (option buttons for Categorical, slider for Scalar).

---

### Task 15: World Chain MiniKit Deposit

Add MiniKit `pay` integration for depositing to Vault on World Chain directly from Mini App.

---

### Task 16: Fuzz Tests & Integration Tests

**Files:**
- Create: `contracts/test/Vault.fuzz.t.sol`
- Create: `contracts/test/Integration.t.sol`

Extreme value testing, full-flow integration test (create market -> bet -> settle -> claim), monkey testing per project rules.

---

## Dependency Graph

```
Task 1 (Scaffold)
  |
  +-- Task 2 (MarketRegistry) --+
  +-- Task 3 (BetIngress) ------+-- Task 5 (Deploy)
  +-- Task 4 (Vault) -----------+
  |
  +-- Task 6 (Backend Core) ----+
  |                              +-- Task 7 (API Routes)
  |
  +-- Task 8 (CRE Settlement) --+
                                 |
              --- P0 Done -------+
                                 |
  Task 9  (Multi-chain Deploy) --+
  Task 10 (Web App UI) ---------+  (all parallel)
  Task 11 (Mini App UI) --------+
  Task 12 (Oracle Workflow) -----+
  Task 13 (Event Listener) ------+
                                 |
              --- P1 Done -------+
                                 |
  Task 14 (Cat/Scalar UI) ------+
  Task 15 (MiniKit Deposit) ----+  (all parallel)
  Task 16 (Fuzz & Integration) -+
                                 |
              --- P2 Done -------+
```

## Parallel Execution Opportunities

**P0:** Tasks 2, 3, 4 (contracts) can run in parallel. Task 6+7 (backend) after scaffold. Task 8 (CRE) after scaffold.

**P1:** Tasks 9-13 are all independent after P0.

**P2:** Tasks 14-16 are all independent after P1.
