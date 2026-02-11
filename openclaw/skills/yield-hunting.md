# Skill: Real-time DeFi yield opportunities (DefiLlama, by address book)

Use this when the user asks for **best yield**, **APY comparison**, or **yield opportunities** for a vault or chain. You have **yield_opportunities** (DefiLlama Yields). Yield research **must** be based on the **vault’s chain** and the **available adapters** from the Factor address book — only call DefiLlama for protocols that are whitelisted on that chain.

## Rule: chain + address book first

1. **Vault context**: **factor_get_vault_info(vaultAddress)** → `chain` (e.g. ARBITRUM_ONE, BASE, MAINNET).
2. **Address book**: **factor_set_chain(chain)** then **factor_get_factory_addresses()** and/or **factor_list_adapters()** → list of available adapters for that chain.
3. **Map to DefiLlama** using the **per-chain table** below: only use DefiLlama project IDs that correspond to adapters present in the address book for that chain.
4. **Chain name for DefiLlama**: ARBITRUM_ONE → `Arbitrum`, BASE → `Base`, MAINNET → `Ethereum`.
5. Call **yield_opportunities** with that **chain** and **project** = comma-separated DefiLlama IDs from the map. Never use a project that is not in the address book for that chain.

---

## Adapter → DefiLlama map (by chain)

Use **factor_list_adapters()** (after **factor_set_chain(chain)**) to get the exact list for the vault’s chain. Then map adapter `id` to DefiLlama `project` using this table. Only protocols with a DefiLlama project in the row are queryable for APY; DEX/swap-only adapters have no lending yield in DefiLlama.

### ARBITRUM_ONE (DefiLlama chain: `Arbitrum`)

| Factor adapter id / factory name | DefiLlama `project` | Note |
|----------------------------------|----------------------|------|
| aave-v3 / AaveAdapter | aave-v3 | Lending |
| compound-v3 / CompoundV3AdapterPro | compound-v3 | Lending (if in factory) |
| morpho / MorphoAdapter | morpho | Lending |
| pendle / PendleAdapter | pendle | Yield / PT |
| uniswap-v3 / UniswapAdapter | uniswap-v3 | Swap/LP (optional in yields) |
| gmx-v2 / GMX | gmx | Perps/LP, Arbitrum-native |
| camelot / Camelot | camelot | DEX/LP, Arbitrum-native |

### BASE (DefiLlama chain: `Base`)

| Factor adapter id / factory name | DefiLlama `project` | Note |
|----------------------------------|----------------------|------|
| aave-v3 / AaveAdapter | aave-v3 | Lending |
| compound-v3 / CompoundV3AdapterPro | compound-v3 | Lending (if in factory) |
| morpho / MorphoAdapter | morpho | Lending |
| pendle / PendleAdapter | pendle | Yield / PT |
| uniswap-v3 / UniswapAdapter | uniswap-v3 | Swap/LP |

### MAINNET (DefiLlama chain: `Ethereum`)

| Factor adapter id / factory name | DefiLlama `project` | Note |
|----------------------------------|----------------------|------|
| aave-v3 / AaveAdapter | aave-v3 | Lending |
| compound-v3 / CompoundV3AdapterPro | compound-v3 | Lending (if in factory) |
| morpho / MorphoAdapter | morpho | Lending |
| pendle / PendleAdapter | pendle | Yield / PT |
| uniswap-v3 / UniswapAdapter | uniswap-v3 | Swap/LP |

If **factor_list_adapters()** returns an adapter id not in the table, check DefiLlama’s project list for that chain and add the mapping; otherwise do not use it in `yield_opportunities` (no APY data).

## Tool: yield_opportunities (DefiLlama)

- **Params (all optional):**
  - **chain**: DefiLlama chain name (`Arbitrum`, `Base`, `Ethereum`) — must match the vault’s chain (see map above).
  - **symbol**: Token symbol (e.g. `USDC`, `WETH`). From vault denominator or target asset.
  - **project**: **Only** protocols from the address book. Comma-separated DefiLlama IDs: `aave-v3`, `compound-v3`, `morpho`, `pendle`. Example: `"project":"aave-v3,compound-v3"`.
  - **stablecoinOnly**: `true` for stablecoin-only pools.
  - **minTvlUsd**: Min TVL in USD.
  - **limit**: Max pools (default 25, max 50).
- **Result:** `{ source: "yields.llama.fi", chain, project, count, pools: [ { chain, project, symbol, apy, apyBase, apyReward, tvlUsd, stablecoin, ilRisk }, ... ] }`. Sorted by APY descending.

**Examples (use only adapters from factor_list_adapters for that chain + map above):**
- Arbitrum vault with aave-v3 + morpho: `[TOOL_CALL:yield_opportunities:{"chain":"Arbitrum","symbol":"USDC","project":"aave-v3,morpho","limit":20}]`
- Base vault with aave-v3 + compound-v3: `[TOOL_CALL:yield_opportunities:{"chain":"Base","symbol":"USDC","project":"aave-v3,compound-v3","limit":15}]`
- Only include in `project` protocols that appear in the address book for that chain (see per-chain table).

## When to use

- "Best yield for this vault", "APY on Arbitrum for USDC", "compare lending rates" → get vault chain + address book, then yield_opportunities with matching chain and projects.
- Combine with **factor_get_vault_info**, **factor_get_factory_addresses**, **factor_list_adapters** to know which protocols you are allowed to suggest.

## Data source

- **DefiLlama Yields** (https://yields.llama.fi): 500+ protocols, 118+ chains. Free, no API key.
