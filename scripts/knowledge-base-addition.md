## Building Blocks & Adapters (Factor MCP)

Use **factor_list_building_blocks** and **factor_list_adapters** to get live lists. When building strategies use **factor_build_strategy** with steps like `{ adapter, action, params }`.

### Building block types (for factor_build_strategy)
| Type | ID | Description | Main params |
|------|-----|-------------|-------------|
| LEND | lend | Supply assets to a lending protocol | asset (address), amount |
| BORROW | borrow | Borrow from a lending protocol | asset, amount |
| SWAP | swap | Swap via DEX | tokenIn, tokenOut, amountIn, minAmountOut |
| STAKE | stake | Stake for rewards | asset, amount |
| LP | lp | Provide liquidity | tokenA, tokenB, amountA, amountB |
| HARVEST | harvest | Claim rewards | pool |
| FLASH_LOAN | flash-loan | Flash loan (e.g. Aave) | asset, amount, calldata |

### Adapter IDs (chain: ARBITRUM_ONE)
| Adapter ID | Protocol | Supported actions |
|------------|----------|--------------------|
| aave-v3 | Aave V3 | LEND, BORROW, REPAY, WITHDRAW |
| morpho | Morpho | LEND, BORROW, REPAY, WITHDRAW |
| uniswap-v3 | Uniswap V3 | SWAP, LP, COLLECT_FEES |
| gmx-v2 | GMX V2 | LP, STAKE, HARVEST |
| camelot | Camelot | SWAP, LP, STAKE |
| pendle | Pendle | LP, STAKE, HARVEST |

### Two ways to run strategies
1. **factor_build_strategy** + **factor_simulate_strategy** + **factor_execute_strategy**: compose steps with adapter ID + action (e.g. LEND, BORROW) + params. Best for new strategies.
2. **factor_execute_manager**: send raw steps with protocol name (aave, compound, openocean, balancer) and action (supplyAll, borrow, swap, executeFL). Use the Detailed Canvas JSON examples below as reference.

---

## What OpenClaw Can Create

| Pattern | Risk | Building blocks | Adapters | One-line description |
|---------|------|-----------------|----------|----------------------|
| Simple Lending | Low | LEND, WITHDRAW | aave-v3, morpho | Split USDC/ETH across Aave + Morpho (or Compound) for supply APY |
| Leveraged Carry | Medium | LEND, BORROW, SWAP, FLASH_LOAN | aave-v3, morpho, uniswap-v3/camelot | Lend stable → Borrow ETH → Swap to rETH/wstETH → earn staking yield minus borrow cost |
| Auto-Compounder | Low–Med | LEND, HARVEST, SWAP | aave-v3, morpho, uniswap-v3 | Supply → Harvest rewards → Swap to asset → Resupply |
| Delta Neutral | Medium | LEND, BORROW, SWAP, FLASH_LOAN | aave-v3, uniswap-v3 | Lend USDC → Borrow ETH → Buy rETH → hedge ETH exposure |
| Amplified LSD | High | LEND, BORROW, SWAP, FLASH_LOAN | aave-v3, uniswap-v3 | Leverage wstETH/rETH/weETH yields via borrow + swap + optional flash |
| Multi-Protocol | Low | LEND, BORROW, HARVEST, SWAP | aave-v3, morpho, pendle, uniswap-v3 | Spread across Aave, Morpho, Pendle; harvest and compound |
| LP / Pendle | Medium | LP, STAKE, HARVEST | pendle, camelot | PT/YT or DEX LP + stake + harvest |

Always use **factor_simulate_strategy** before **factor_execute_strategy**. For existing vaults use **factor_get_vault_info** and **factor_get_factory_addresses** to get whitelisted assets and adapters.

---

