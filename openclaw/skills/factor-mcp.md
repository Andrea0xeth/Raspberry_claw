# Skill: Factor MCP

You have access to Factor Protocol via the Factor MCP server ([GitHub](https://github.com/FactorDAO/factor-mcp)). Config: `~/.factor-mcp/config.json` (chain, activeWallet, simulationMode). Wallet: `~/.factor-mcp/wallets/`. Chains: ARBITRUM_ONE, BASE, MAINNET (and optionally OPTIMISM, SONIC if supported). The server exposes 60+ tools; for the full list use **factor_list_adapters** or the /factor/tools API.

**Tool call format (exact):** `[TOOL_CALL:toolName:jsonObject]` — the first part is the **tool name** (e.g. factor_get_config), then a colon, then a **JSON object** (use `{}` for no params). Examples:
- `[TOOL_CALL:factor_get_config:{}]`
- `[TOOL_CALL:factor_get_owned_vaults:{}]`
- `[TOOL_CALL:factor_set_chain:{"chain":"ARBITRUM_ONE"}]`
- `[TOOL_CALL:factor_get_vault_info:{"vaultAddress":"0x..."}]`
Never write `[TOOL_CALL:name:...]` — "name" is wrong; use the actual tool name (factor_get_config, factor_get_owned_vaults, etc.).

## Tools

- **factor_get_config** — current chain, RPC, active wallet
- **factor_set_chain** — set chain: `{"chain":"ARBITRUM_ONE"}` or BASE or MAINNET
- **factor_get_owned_vaults** — list vaults for your wallet (no params or `{"ownerAddress":"0x..."}`)
- **factor_get_vault_info** — details: `{"vaultAddress":"0x..."}`
- **factor_get_shares** — user shares: `{"vaultAddress":"0x..."}`
- **factor_get_executions** — vault execution history: `{"vaultAddress":"0x..."}`
- **factor_get_factory_addresses** — whitelisted assets/adapters
- **factor_list_adapters** — available protocols on current chain
- **factor_list_building_blocks** — LEND, BORROW, SWAP, etc.
- **factor_build_strategy**, **factor_simulate_strategy**, **factor_execute_strategy**
- **factor_preview_deposit**, **factor_preview_withdraw**
- **factor_deposit**, **factor_withdraw**, **factor_execute_manager**, **factor_add_adapter**
- **factor_create_vault**, **factor_validate_vault_config**
- **factor_cast_call**, **factor_preview_transaction**, **factor_get_transaction_status**
- **factor_check_foundry**, **factor_simulate_transaction**, **factor_decode_error**
- **factor_get_address_book** — Pro adapter addresses for current chain
- **factor_vault_templates** — ready-to-use vault params (call before creating vaults)
- **factor_swap**, **factor_swap_exact_output**, **factor_swap_openocean**, **factor_swap_pendle** — DEX swaps
- **factor_lend_supply**, **factor_lend_withdraw**, **factor_lend_borrow**, **factor_lend_repay** — Aave/Compound/Morpho/Silo
- **factor_lp_create_position**, **factor_lp_add_liquidity**, **factor_lp_remove_liquidity**, **factor_lp_collect_fees** — Uniswap/Camelot/Aerodrome LP
- **factor_flashloan**, **factor_give_approval**, **factor_get_lending_tokens**, **factor_add_vault_token**
- Vault management: **factor_set_deposit_fee**, **factor_set_withdraw_fee**, **factor_set_max_cap**, **factor_add_vault_manager**, etc.

If a tool is not listed here, try calling it anyway (e.g. [TOOL_CALL:factor_vault_templates:{}]); the MCP may support it.

## When to use

- "What are our vaults?" / "check with factor-mcp" → call **factor_get_owned_vaults** (and optionally factor_get_config for chain). Then summarize.
- Vault details → **factor_get_vault_info** with vaultAddress.
- Always run **factor_simulate_strategy** before **factor_execute_strategy**.

Be direct. Use the tools; don't say you don't have access.
