# Skill: Factor strategies (Stats API, canvas, patterns)

Use this when building or explaining strategies. Always run **factor_simulate_strategy** before **factor_execute_strategy**.

## Factor Studio Stats API

To get strategy blueprints (canvas + blocks) from the API:

- **List pro vaults**: `GET https://factor-studio-stats-api.fly.dev/utils/pro-vaults` with header `Origin: https://studio.factor.fi`
- **Strategy for one vault**: `GET https://factor-studio-stats-api.fly.dev/strategies/{vaultAddress}` with same Origin
- Response has `strategy.canvas[]`; each canvas has `name` (e.g. "Main Strategy", "Exit Strategy") and `blocks[]` (block types in order).

If you have a **web_fetch** tool, use it with that Origin to fetch pro-vaults or strategies. Otherwise use **factor_get_owned_vaults** and **factor_get_vault_info** for live data.

## Canvas and blocks

| Concept | Meaning |
|--------|---------|
| **Canvas** | One flow: "Main Strategy" (entry), "Exit Strategy" (exit). |
| **Block** | One step: LEND, BORROW, SWAP, REPAY, WITHDRAW_LENDING, FLASHLOAN, COLLECT_FEE, EXIT_SAFE. |

## Mapping API block → MCP

| API block | factor_build_strategy | factor_execute_manager |
|-----------|------------------------|-------------------------|
| LEND | adapter aave/morpho, action LEND | aave → supplyAll or supply |
| BORROW | aave/morpho → BORROW | aave → borrow |
| SWAP | uniswap → SWAP | uniswap → exactInputSingleAll |
| REPAY | aave/morpho → REPAY | aave → repay |
| WITHDRAW_LENDING | aave/morpho → WITHDRAW | aave → withdraw |
| FLASHLOAN | aaveFL / morphoFL | executeFL |
| COLLECT_FEE | uniswapV3Lp | collectFees |
| EXIT_SAFE | (optional) | (optional) |

Use **factor_list_adapters** for current chain adapter IDs.

## Arbitrum One token addresses (42161)

| Symbol | Address |
|--------|---------|
| USDC | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` (6 decimals) |
| WETH | `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` (18 decimals) |
| weETH | `0x724dc807b04555b71ed48a6896b6f41593b8c637` |
| rETH | `0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8` |
| wstETH | `0x5979d7b546e38e414f7e9822514be443a4800529` |
| rsETH | `0x2416092f143378750bb29b79ed961ab195cceea5` |
| ezETH | `0x35751007a407ca6feffe80b3cb397736d2cf4dbe` |

Example amounts: 1000 USDC = `1000000000`; 0.5 WETH = `500000000000000000`. Confirm with **factor_get_vault_info** / **factor_get_factory_addresses**.

## Strategy patterns (summary)

| Pattern | Main blocks | Exit blocks |
|---------|-------------|-------------|
| Liquid restaked ETH on USDC lend | LEND → BORROW → SWAP×3 | SWAP×3 → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| rETH/single LSD on USDC lend | LEND → BORROW → SWAP | SWAP → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| Boosted lending (flash) | LEND → BORROW → FLASHLOAN | FLASHLOAN → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| Diversified lending (2 protocols) | LEND → LEND | WITHDRAW_LENDING → WITHDRAW_LENDING → EXIT_SAFE |
| Carry + flash | LEND → BORROW → SWAP → FLASHLOAN | FLASHLOAN → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| Auto-compounder | COLLECT_FEE → SWAP → LEND | WITHDRAW_LENDING → EXIT_SAFE |
| Levered / flash-only | FLASHLOAN | FLASHLOAN → EXIT_SAFE |
| Delta neutral | FLASHLOAN → SWAP | EXIT_SAFE |

## Workflow to run a strategy

1. **Context**: factor_set_chain, factor_get_vault_info(vaultAddress), factor_get_factory_addresses.
2. **Build steps** from block order (and token table above); use factor_build_strategy with adapter + action + params.
3. **Simulate**: factor_simulate_strategy(strategyId).
4. **Execute** (after user confirmation): factor_execute_strategy(strategyId).

For execute_manager: same flow but with raw steps (protocol, action, params). Get adapter names from factor_list_adapters.
