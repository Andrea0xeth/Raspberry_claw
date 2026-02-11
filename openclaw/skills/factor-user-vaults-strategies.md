# Skill: Strategy canvas – examples and execution patterns

Use this for **strategy structure** and **typical Main/Exit block sequences**. Map blocks to **factor_build_strategy** or **factor_execute_manager** (see factor-reference and factor-strategies).

## Getting strategy canvas for any vault

- `GET https://factor-studio-stats-api.fly.dev/strategies/{vaultAddress}` with header `Origin: https://studio.factor.fi`.
- Response: `strategy.canvas[]` — each has `name` (e.g. "Main Strategy", "Exit Strategy") and `blocks[]` with `type` (LEND, BORROW, SWAP, REPAY, WITHDRAW_LENDING, FLASHLOAN, EXIT_SAFE, COLLECT_FEE, etc.).

## Strategy pattern examples (Main → Exit)

| Pattern | Main blocks | Exit blocks |
|---------|-------------|-------------|
| Liquid restaked ETH on USDC lend | LEND → BORROW → SWAP ×3 | SWAP ×3 → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| rETH / single LSD on USDC lend | LEND → BORROW → SWAP | SWAP → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| wstETH / dual LSD on USDC lend | LEND → BORROW → SWAP ×2 | SWAP ×2 → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| Boosted lending (flash) | LEND → BORROW → FLASHLOAN | FLASHLOAN → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| Diversified lending (2 protocols) | LEND → LEND | WITHDRAW_LENDING → WITHDRAW_LENDING → EXIT_SAFE |
| Carry + flash | LEND → BORROW → SWAP → FLASHLOAN | FLASHLOAN → REPAY → WITHDRAW_LENDING → EXIT_SAFE |
| Auto-compounder | COLLECT_FEE → SWAP → LEND | WITHDRAW_LENDING → EXIT_SAFE |
| Levered / flash-only | FLASHLOAN | FLASHLOAN → EXIT_SAFE or EXIT_SAFE |
| Delta neutral | FLASHLOAN → SWAP | EXIT_SAFE |

Execution: translate each block to MCP steps (e.g. LEND → aave supplyAll, BORROW → aave borrow, SWAP → uniswap exactInputSingleAll, REPAY → aave repay, WITHDRAW_LENDING → aave withdraw). Use factor_get_vault_info and factor_get_factory_addresses for addresses; factor_simulate_strategy before factor_execute_strategy.
