# Onchain_Agents - Swap, Transfer, Balance Agent (EVM & Solana)
Multi-chain onchain AI agents - All agents were built with GOAT SDK,  and patch-package fixes.

Each agent has its own README.md file that contains setup instructions.

## Full Setup From Scratch

### 1. Clone and install

- git clone <repo-url>
- cd swap-agent
- npm install

### 2. Create .env in the project root


LLM  \\
OPENROUTER_API_KEY=

Wallets \\
WALLET_PRIVATE_KEY=       # EVM — hex private key (with 0x prefix)
SOLANA_PRIVATE_KEY=       # Solana — base58 encoded private key

EVM RPCs \\
BASE_RPC_URL=
ARBITRUM_RPC_URL=
OPTIMISM_RPC_URL=
ETH_MAINNET_RPC_URL=
BSC_RPC_URL=
MONAD_RPC_URL=

Solana RPC (Helius required) \\
HELIUS_RPC_URL=
Testnets (BASE_SEPOLIA_RPC_URL, ETH_SEPOLIA_RPC_URL) are optional unless you're testing on testnet.

### 3. Run

npm run x047