# PrivaPoll Design Notes (Brainstorming Phase)

## Key Design Decisions

### 1. Privacy as Core — CRE 密鑰加密方案
- 生成非對稱密鑰，私鑰存為 CRE workflow secret（只在 TEE 內可讀）
- 公鑰公開，前端用公鑰加密下注內容
- Backend 只存密文（盲存），無法解密
- CRE 結算時用 Confidential HTTP 取密文，TEE 內解密計算
- 連 backend operator 都看不到投票內容

### 2. 控制鏈選 Base Sepolia（非 World Chain）
- CRE 確定支援 Base Sepolia 的 EVM Log trigger
- World Chain 的 CRE 支援狀態未確認，避免風險
- 控制鏈部署 MarketRegistry + BetIngress

### 3. 多鏈 BetEscrow + 帳戶餘額制（合併方案）
- 入金：各鏈獨立 Vault 合約，不強迫 bridge
  - World Chain: MiniKit pay（Mini App 內完成）
  - 其他鏈: Web App + WalletConnect
- 下注 UX：API call 即完成，不需每次簽 tx
  - Backend 維護快取餘額（速度）
  - 鏈上 Vault.deposits - BetIngress.amounts = 真實餘額（CRE 結算用）
- Vault.sol = BetEscrow + PayoutAdapter 合併，每鏈部署一份

### 4. 雙前端入口
- World Mini App: World ID 驗證 + 下注 + 查看結果
- Independent Web App (Next.js + RainbowKit): 多鏈入金 + 倉位管理 + Claim
- 共用同一組 Backend API

### 5. 市場類型 & 結算
- 支援 Binary / Categorical / Scalar 三種市場
- 結算：手動 + Oracle 自動（Confidential HTTP 抓外部 API）
- 分階段：先做 Binary，再加 Categorical / Scalar

### 6. 防篡改三重驗證
- Layer 1: World ID nullifier — 1 人 1 票
- Layer 2: ciphertextHash 上鏈 — Backend 無法偷改密文
- Layer 3: 雙重帳本 — CRE 以鏈上數據為準，不信任 backend

### 7. CRE 的實際限制（Perplexity 幻覺修正）
- positionsStore 不存在 — CRE workflow 是 stateless
- 沒有跨 invocation 的持久化 mutable state
- 解法：密文存 off-chain DB，CRE 結算時一次取回全部解密計算
- MiniKit sendTransaction 只能 World Chain

---

## Future: SUI Control Chain Support

### Decision
預留控制鏈抽象層，讓未來可以加入 SUI 或其他非 EVM 鏈作為控制鏈。

### Backend: ChainAdapter Interface
- 定義通用 `ChainAdapter` interface，目前只實作 `EVMAdapter (Base Sepolia)`
- 未來加入 `SUIAdapter` 時只需新增一個 adapter 實作
- 每個 Adapter 負責：
  - 組裝 placeBet tx 格式
  - 讀取 market 狀態
  - 監聽 event 格式轉換
  - 地址格式處理

### 具體預留方式（低成本）
1. **API 層** — `chainId` 作為 market metadata 欄位，API 不綁死特定鏈的地址格式
2. **合約介面** — `MarketRegistry` 和 `BetIngress` 的 event schema 定義成通用格式，SUI 版 emit 等價 event
3. **CRE Workflow** — config 中用 `chainSelectorName` 動態指定控制鏈，不 hardcode
4. **DB schema** — 地址欄位存 `string`（非 `bytes20`），相容 SUI 的 32-byte 地址

### 注意事項
- CRE 目前主要支援 EVM 系（`EVMClient`），SUI 支援取決於未來 CRE 更新
- Backend 和 DB 層抽象成本低，值得預留
- 合約端不需提前做 — SUI 用 Move 寫，到時候是全新實作而非 adapter
