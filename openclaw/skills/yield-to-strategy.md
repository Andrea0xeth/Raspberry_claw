# Skill: Yield → strategy (maxi skill)

**Obiettivo:** da un vault, produrre **strategie concretamente costruibili** (blocchi + adapter + APY) usando i yield disponibili sulla chain e i pattern supportati dal vault. Tutto deve basarsi su: **chain**, **address book** (adapter whitelist), **canvas/pattern** del vault, **DefiLlama yields** filtrati per quei protocolli.

Usa questa skill quando ti chiedono "miglior yield per questo vault", "proponi una strategia", "ottimizza il vault" o quando l’orchestrator chiede al DeFi Expert una strategia yield-maximizing.

---

## 1. Contesto vault (obbligatorio)

1. **factor_get_vault_info(vaultAddress)** → `chain`, denominator asset, `adapters` (se presenti), asset supportati.
2. **factor_set_chain(chain)** poi **factor_get_factory_addresses()** e **factor_list_adapters()** → elenco adapter disponibili sulla chain (address book).
3. **Canvas del vault:**  
   `GET https://factor-studio-stats-api.fly.dev/strategies/{vaultAddress}` con header `Origin: https://studio.factor.fi`  
   → `strategy.canvas[]`: ogni canvas ha `name` (es. "Main Strategy", "Exit Strategy") e `blocks[]` (LEND, BORROW, SWAP, REPAY, WITHDRAW_LENDING, FLASHLOAN, EXIT_SAFE, COLLECT_FEE).  
   I blocchi definiscono **quali pattern sono realizzabili** per quel vault (es. se c’è LEND → LEND c’è diversified lending; se c’è LEND → BORROW → SWAP c’è carry/LSD).

Se non hai **web_fetch**, usa i pattern generici sotto e verifica con factor_get_vault_info / factor_list_building_blocks che gli step siano supportati.

---

## 2. Yield (solo address book + chain)

- **Chain per DefiLlama:** ARBITRUM_ONE → `Arbitrum`, BASE → `Base`, MAINNET → `Ethereum`.
- **Mappa adapter → DefiLlama project** (solo adapter presenti in factor_list_adapters per quella chain): vedi **yield-hunting.md** (tabella per chain: aave-v3, compound-v3, morpho, pendle, uniswap-v3, gmx, camelot dove applicabile).
- Chiama **yield_opportunities(chain, symbol, project, limit)** solo con `project` = protocolli presenti in address book. Es.: per vault Arbitrum con aave-v3 e morpho → `yield_opportunities({"chain":"Arbitrum","symbol":"USDC","project":"aave-v3,morpho","limit":20})`. Per denominator USDC interessa `symbol: "USDC"`; per carry su LSD interessa anche WETH / weETH / rETH / ecc.

Risultato: pool con `apy`, `project`, `symbol`, `tvlUsd`. Usa questi numeri per **confezionare** le strategie sotto.

---

## 3. Pattern → blocchi e protocolli

Da **factor-user-vaults-strategies.md** e **factor-strategies.md**. Ogni pattern richiede blocchi e quindi adapter/yield specifici:

| Pattern | Main blocks | Cosa serve dai yield | Protocolli tipici |
|--------|-------------|----------------------|-------------------|
| **Diversified lending (2 protocolli)** | LEND → LEND | APY lending per 2 protocol (es. USDC su Aave + Morpho) | aave-v3, morpho, compound-v3 |
| **Liquid restaked ETH su USDC lend** | LEND → BORROW → SWAP×3 | USDC LEND APY, WETH borrow cost, LSD (weETH, rsETH, ezETH) | aave-v3 + uniswap |
| **rETH / single LSD su USDC lend** | LEND → BORROW → SWAP | USDC LEND, WETH borrow, 1 LSD | aave-v3 + uniswap |
| **Boosted lending (flash)** | LEND → BORROW → FLASHLOAN | Lending APY + flash availability | aave-v3 / morpho + aaveFL |
| **Carry + flash** | LEND → BORROW → SWAP → FLASHLOAN | Come carry + flash | aave + uniswap + flash |
| **Auto-compounder** | COLLECT_FEE → SWAP → LEND | LP fee + LEND APY | uniswap-v3 LP + aave/morpho |
| **Levered / flash-only** | FLASHLOAN | - | aaveFL / balancer |

Per ogni pattern che vuoi proporre: controlla che i blocchi siano **compatibili con il canvas del vault** (o con factor_list_building_blocks) e che gli adapter necessari siano in **factor_list_adapters** per quella chain.

---

## 4. Proposta strategia (output)

Per ogni strategia proposta restituisci:

1. **Nome pattern** (es. "Diversified lending USDC su Aave + Morpho").
2. **Chain** e **vault address**.
3. **Fonte yield:** pool DefiLlama usati (project, symbol, APY, TVL) — solo da address book.
4. **Main steps** (in ordine): es. LEND USDC su Aave (X% APY), LEND USDC su Morpho (Y% APY); oppure LEND → BORROW → SWAP con riferimenti ai pool.
5. **Exit steps** (in ordine): es. WITHDRAW_LENDING → WITHDRAW_LENDING → EXIT_SAFE.
6. **Come eseguirla:**  
   - **factor_build_strategy**: adapter + action + params (vedi factor-strategies.md, factor-reference.md).  
   - Oppure **factor_execute_manager**: `steps[]` con `protocol`, `action`, `params` (es. aave supplyAll, aave borrow, uniswap exactInputSingleAll).  
   Usa solo indirizzi da **factor_get_vault_info** / **factor_get_factory_addresses** e adapter da **factor_list_adapters**.

Se un pattern richiede un adapter non in address book (es. Compound V3 non in factory), **non** proporre quel pattern per quel vault; proponi solo strategie costruibili.

---

## 5. Workflow riassunto

1. **Vault + chain + address book:** factor_get_vault_info → factor_set_chain → factor_get_factory_addresses + factor_list_adapters.  
2. **Canvas (se possibile):** GET strategies/{vaultAddress} → canvas e blocks.  
3. **Yield:** yield_opportunities(chain, symbol, project, limit) con project = solo adapter presenti in address book (mappa per chain in yield-hunting.md).  
4. **Scelta pattern:** in base a canvas/blocks e adapter disponibili (es. 2 LEND → diversified lending; LEND+BORROW+SWAP → carry/LSD).  
5. **Output:** 1–3 strategie con pattern, APY (da DefiLlama), Main/Exit steps e istruzioni factor_build_strategy / factor_execute_manager.

Riferimenti: **yield-hunting.md** (DefiLlama + mappa per chain), **factor-user-vaults-strategies.md** (canvas e pattern), **factor-strategies.md** e **factor-reference.md** (build ed execute).
