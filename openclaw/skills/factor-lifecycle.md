# Skill: Factor full lifecycle (create vault, post-deploy, manage, exit)

Use this when the user wants to **create a new vault**, **configure an existing one**, or **exit positions**. All steps use Factor MCP tools.

## 1. Wallet and config

- **factor_get_config** — verify chain, RPC, active wallet, simulation mode.
- **factor_set_chain** — set ARBITRUM_ONE, BASE, or MAINNET before creating vaults or strategies.
- **factor_set_rpc** — optional custom RPC URL.
- **factor_wallet_setup** — import (privateKey) or generate (generateNew: true); setActive: true. Stored in ~/.factor-mcp/wallets/.

## 2. Creating a vault (always use templates)

**Rule: always call factor_vault_templates first.** Never hand-build params for factor_create_vault.

- **factor_vault_templates** — Pass `denominator` ("USDC", "USDT", "WETH") and optionally `lendingProtocol` ("aave", "compoundV3", "morpho"). Returns `createVaultParams`, `approvalStep`, `postDeploySteps`.
- **factor_give_approval** — Use the template’s `approvalStep` to approve the denominator for the factory. Required before factor_create_vault.
- **factor_create_vault** — Pass the template’s `createVaultParams`. You can override: name, symbol, upgradeable (true/false), upgradeTimelockSeconds, depositFee, withdrawFee, managementFee, performanceFee, maxCap, maxDebtRatio, cooldownTimeSeconds, initialDepositAmount. Then **factor_get_transaction_status** with the returned tx hash to confirm.
- **factor_validate_vault_config** — Optional: validate params before create when customizing beyond the template.

## 3. Post-deploy (lending vaults)

- **Aave**: No extra steps. Deposit then factor_lend_supply (protocol: "aave", assetAddress, amount or "all").
- **Compound V3**: Run **factor_execute_manager** with the template’s postDeploySteps **registerMarket** step first. Then factor_deposit and factor_lend_supply (protocol: "compoundV3", marketAddress, assetAddress, amount).
- **Morpho**: User must choose a marketId from template’s lending.availableMarkets. Then **factor_execute_manager** with step addMarketToAssetAndDebt, params { marketId: "<chosen>" }. Then factor_deposit and factor_lend_supply (protocol: "morpho", marketId, amount).

**Adding adapters/tokens later:** factor_get_factory_addresses, factor_add_adapter (vaultAddress, adapterAddress), factor_add_vault_token (type, tokenAddress, accountingAddress). Verify with factor_get_vault_info.

## 4. Deposit and withdraw

- **factor_preview_deposit** (vaultAddress, assetAddress, amount) — expected shares (read-only).
- **factor_give_approval** — approve deposit token for vault if needed (spender = vault address).
- **factor_deposit** (vaultAddress, assetAddress, amount) — execute deposit.
- **factor_get_shares** (vaultAddress) — user shares, total supply, price per share.
- **factor_preview_withdraw** (vaultAddress, shares) — expected assets out (read-only).
- **factor_withdraw** (vaultAddress, shares) — redeem shares. If there are open lending/borrow positions, run exit steps first (repay, withdraw lending, swap back), then factor_withdraw.

## 5. Vault management (fees, cap, managers)

All owner-only. Fees in basis points (10000 = 100%) where applicable.

- **factor_set_deposit_fee**, **factor_set_withdraw_fee**, **factor_set_performance_fee**, **factor_set_management_fee** (vaultAddress, feeBps).
- **factor_set_fee_receiver** (vaultAddress, receiverAddress).
- **factor_charge_performance_fee** (vaultAddress) — callable by anyone; mints fee shares to receiver.
- **factor_set_max_cap** (vaultAddress, maxCap in base units; 0 = no cap).
- **factor_set_max_debt_ratio** (vaultAddress, maxDebtRatioBps).
- **factor_set_price_deviation_allowance** (vaultAddress, allowanceBps).
- **factor_add_vault_manager** (vaultAddress, managerAddress) — manager can run strategies.
- **factor_remove_vault_manager**, **factor_set_risk_manager**.

## 6. End-to-end checklist

1. factor_get_config → factor_set_chain.
2. factor_vault_templates (denominator + lendingProtocol if needed).
3. factor_give_approval (approvalStep from template).
4. factor_create_vault (createVaultParams; set upgradeable: true if needed).
5. factor_get_transaction_status to confirm deploy.
6. Post-deploy: registerMarket (Compound) or addMarketToAssetAndDebt (Morpho) via factor_execute_manager.
7. factor_deposit (after approval if needed).
8. Run strategies (factor_lend_supply / factor_execute_manager / factor_build_strategy + simulate + execute).
9. factor_set_* for fees, cap, managers.
10. factor_withdraw when exiting (after unwinding strategies if needed).
