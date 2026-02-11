# Skill: Real-time DeFi yield opportunities (chain-based)

Use this when the user asks for **best yield**, **APY comparison**, **where to deploy capital**, or **yield opportunities** on a specific chain or asset. You have a **yield_opportunities** tool that fetches live data from DefiLlama Yields (no API key).

## Tool: yield_opportunities

- **Call (examples):**
  - General: `[TOOL_CALL:yield_opportunities:{"chain":"Arbitrum","symbol":"USDC","limit":20}]`
  - Aave only: `"project":"aave-v3"`. Compound only: `"project":"compound-v3"`.
  - **Aave and Compound together**: use `"project":"aave-v3,compound-v3"` in a **single** call so both protocols are returned (DefiLlama uses `compound-v3`, not "Compound V3"). Example: `[TOOL_CALL:yield_opportunities:{"chain":"Arbitrum","symbol":"USDC","project":"aave-v3,compound-v3","limit":15}]`.
- **Params (all optional):**
  - **chain**: Chain name, e.g. `Arbitrum`, `Base`, `Ethereum`. Omit for all chains.
  - **symbol**: **Token** symbol (e.g. `USDC`, `WETH`, `rETH`). Partial match. Not the protocol name.
  - **project**: **Protocol** name(s). One value or comma-separated (e.g. `aave-v3`, `compound-v3`, or `aave-v3,compound-v3`). DefiLlama IDs: `aave-v3`, `compound-v3`, `morpho`. When user asks for "Aave and Compound" or "Aave or Compound", always use `project: "aave-v3,compound-v3"` so Compound is included.
  - **stablecoinOnly**: `true` to return only stablecoin pools.
  - **minTvlUsd**: Minimum TVL in USD (e.g. `1000000` to skip tiny pools).
  - **limit**: Max pools to return (default 25, max 50).
- **Result:** `{ source, chain, project, count, pools: [ { chain, project, symbol, apy, apyBase, apyReward, tvlUsd, stablecoin, ilRisk }, ... ] }`. Sorted by APY descending.

## When to use

- "Best yield on Arbitrum", "USDC yields on Base", "top stablecoin yields", "compare lending APYs".
- **"USDC yield on Aave and Compound" (any chain)**: use **one** call with `project: "aave-v3,compound-v3"` so both protocols appear. Example: `{"chain":"Arbitrum","symbol":"USDC","project":"aave-v3,compound-v3","limit":15}`. Never report only Aave when the user asked for both; DefiLlama project ID for Compound is `compound-v3`.
- Combine with **Factor** tools: use yield_opportunities to discover protocols/rates, then factor_get_owned_vaults / factor_get_vault_info to see how the user’s vaults compare or which Factor strategies match.

## Data source

- **DefiLlama Yields** (https://yields.llama.fi): 500+ protocols, 118+ chains, APY/TVL updated regularly. Free, no key. For more filters or historical data see https://api-docs.defillama.com/ (yields section).

Other public APIs you could add later: **DeFiYields.dev** (chains, protocols, pool_type; free tier 500 req/day), **vaults.fyi** (detailed vault strategies). For now yield_opportunities uses DefiLlama only.
