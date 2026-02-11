# Skill: Yield → strategy (maxi skill)

**Goal:** From a vault, produce **concretely buildable strategies** (blocks + adapters + APY) using available yields on the chain and patterns supported by the vault. Everything must be based on: **chain**, **address book** (adapter whitelist), **vault canvas/pattern**, and **DefiLlama yields** filtered for those protocols.

Use this skill when asked "best yield for this vault", "propose a strategy", "optimize the vault", or when the orchestrator asks the DeFi Expert for a yield-maximizing strategy.

---

## 1. Vault context (required)

1. **factor_get_vault_info(vaultAddress)** → `chain`, denominator asset, `adapters` (if present), supported assets.
2. **factor_set_chain(chain)** then **factor_get_factory_addresses()** and **factor_list_adapters()** → list of adapters available on that chain (address book).
3. **Vault canvas:**  
   `GET https://factor-studio-stats-api.fly.dev/strategies/{vaultAddress}` with header `Origin: https://studio.factor.fi`  
   → `strategy.canvas[]`: each canvas has `name` (e.g. "Main Strategy", "Exit Strategy") and `blocks[]` (LEND, BORROW, SWAP, REPAY, WITHDRAW_LENDING, FLASHLOAN, EXIT_SAFE, COLLECT_FEE).  
   The blocks define **which patterns are achievable** for that vault (e.g. LEND → LEND = diversified lending; LEND → BORROW → SWAP = carry/LSD).

If you don't have **web_fetch**, use the generic patterns below and verify with factor_get_vault_info / factor_list_building_blocks that the steps are supported.

---

## 2. Yields (address book + chain only)

- **Chain for DefiLlama:** ARBITRUM_ONE → `Arbitrum`, BASE → `Base`, MAINNET → `Ethereum`.
- **Adapter → DefiLlama project map** (only adapters in factor_list_adapters for that chain): see **yield-hunting.md** (per-chain table: aave-v3, compound-v3, morpho, pendle, uniswap-v3, gmx, camelot where applicable).
- Call **yield_opportunities(chain, symbol, project, limit)** only with `project` = protocols in the address book. E.g. for an Arbitrum vault with aave-v3 and morpho → `yield_opportunities({"chain":"Arbitrum","symbol":"USDC","project":"aave-v3,morpho","limit":20})`. For USDC denominator use `symbol: "USDC"`; for LSD carry also WETH / weETH / rETH etc.

Result: pools with `apy`, `project`, `symbol`, `tvlUsd`. Use these numbers to **build** the strategies below.

---

## 3. Pattern → blocks and protocols

From **factor-user-vaults-strategies.md** and **factor-strategies.md**. Each pattern requires specific blocks and thus adapter/yield:

| Pattern | Main blocks | What you need from yields | Typical protocols |
|--------|-------------|---------------------------|-------------------|
| **Diversified lending (2 protocols)** | LEND → LEND | Lending APY for 2 protocols (e.g. USDC on Aave + Morpho) | aave-v3, morpho, compound-v3 |
| **Liquid restaked ETH on USDC lend** | LEND → BORROW → SWAP×3 | USDC LEND APY, WETH borrow cost, LSD (weETH, rsETH, ezETH) | aave-v3 + uniswap |
| **rETH / single LSD on USDC lend** | LEND → BORROW → SWAP | USDC LEND, WETH borrow, 1 LSD | aave-v3 + uniswap |
| **Boosted lending (flash)** | LEND → BORROW → FLASHLOAN | Lending APY + flash availability | aave-v3 / morpho + aaveFL |
| **Carry + flash** | LEND → BORROW → SWAP → FLASHLOAN | Same as carry + flash | aave + uniswap + flash |
| **Auto-compounder** | COLLECT_FEE → SWAP → LEND | LP fee + LEND APY | uniswap-v3 LP + aave/morpho |
| **Levered / flash-only** | FLASHLOAN | - | aaveFL / balancer |

For each pattern you propose: ensure the blocks are **compatible with the vault canvas** (or factor_list_building_blocks) and that the required adapters are in **factor_list_adapters** for that chain.

---

## 4. Strategy proposal (output)

For each proposed strategy return:

1. **Pattern name** (e.g. "Diversified lending USDC on Aave + Morpho").
2. **Chain** and **vault address**.
3. **Yield source:** DefiLlama pools used (project, symbol, APY, TVL) — from address book only.
4. **Main steps** (in order): e.g. LEND USDC on Aave (X% APY), LEND USDC on Morpho (Y% APY); or LEND → BORROW → SWAP with pool references.
5. **Exit steps** (in order): e.g. WITHDRAW_LENDING → WITHDRAW_LENDING → EXIT_SAFE.
6. **How to execute:**  
   - **factor_build_strategy**: adapter + action + params (see factor-strategies.md, factor-reference.md).  
   - Or **factor_execute_manager**: `steps[]` with `protocol`, `action`, `params` (e.g. aave supplyAll, aave borrow, uniswap exactInputSingleAll).  
   Use only addresses from **factor_get_vault_info** / **factor_get_factory_addresses** and adapters from **factor_list_adapters**.

If a pattern requires an adapter not in the address book (e.g. Compound V3 not in factory), **do not** propose that pattern for that vault; only propose buildable strategies.

---

## 5. Workflow summary

1. **Vault + chain + address book:** factor_get_vault_info → factor_set_chain → factor_get_factory_addresses + factor_list_adapters.  
2. **Canvas (if possible):** GET strategies/{vaultAddress} → canvas and blocks.  
3. **Yields:** yield_opportunities(chain, symbol, project, limit) with project = only adapters in address book (per-chain map in yield-hunting.md).  
4. **Pattern choice:** based on canvas/blocks and available adapters (e.g. 2 LEND → diversified lending; LEND+BORROW+SWAP → carry/LSD).  
5. **Output:** 1–3 strategies with pattern, APY (from DefiLlama), Main/Exit steps and factor_build_strategy / factor_execute_manager instructions.

References: **yield-hunting.md** (DefiLlama + per-chain map), **factor-user-vaults-strategies.md** (canvas and patterns), **factor-strategies.md** and **factor-reference.md** (build and execute).
