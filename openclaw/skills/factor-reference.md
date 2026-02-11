# Skill: Factor strategy reference (execute_manager examples)

Use **factor_list_adapters** for current chain adapter IDs and actions. For **factor_execute_manager**, each step is `{ protocol, action, params }`. Get token/vault addresses from **factor_get_vault_info** and **factor_get_factory_addresses**.

## Building blocks (factor_build_strategy)

| Type | Main params |
|------|-------------|
| LEND | asset (address), amount |
| BORROW | asset, amount |
| SWAP | tokenIn, tokenOut, amountIn, minAmountOut |
| STAKE | asset, amount |
| LP | tokenA, tokenB, amountA, amountB |
| HARVEST | pool |
| FLASH_LOAN | asset, amount, calldata |

Adapter IDs (examples): aave, morpho, uniswap, compoundV3, aaveFL, morphoFL, pendle. Full list: factor_list_adapters.

## Leveraged Carry (factor_execute_manager)

Idea: Supply stable → borrow ETH → swap to rETH/wstETH. Replace vaultAddress and token addresses from factory/vault info.

```json
{
  "vaultAddress": "0x...",
  "steps": [
    { "protocol": "aave", "action": "supplyAll", "params": {} },
    { "protocol": "aave", "action": "borrow", "params": { "asset": "0xWETH", "amount": "..." } },
    { "protocol": "uniswap", "action": "exactInputSingleAll", "params": { "tokenIn": "0xWETH", "tokenOut": "0xrETH", "amountIn": "...", "minAmountOut": "0" } }
  ]
}
```

With flash loan: add executeFL (balancer/aave) at start and repay at end.

## Delta Neutral

Idea: Lend USDC → borrow ETH → swap to rETH (staking exposure). Same step format; optional flash at start + repay at end.

## Amplified LSD (wstETH/rETH/weETH)

Idea: Supply (stable or ETH) → borrow → swap to LSD (wstETH/rETH/weETH). Optional extra supply of LSD for yield. Same format: aave supplyAll → aave borrow → uniswap exactInputSingleAll (tokenOut = LSD address). For flash: use aaveFL or morphoFL.

## Operational notes

- **Always simulate**: factor_simulate_strategy before factor_execute_strategy; for factor_execute_manager check vault limits and whitelist.
- **Addresses**: Use only assets/adapters from factor_get_vault_info and factor_get_factory_addresses for the selected chain (factor_set_chain).
- **Slippage**: Use non-zero minAmountOut for SWAP steps when possible.
- **Flash loan**: executeFL requires calldata that implements logic and repay in the same tx; check factor_list_building_blocks / factor_list_adapters for the adapter.
