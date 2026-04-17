# TronLink CLI

CLI tool for TRON blockchain operations via TronLink wallet signing.

All transactions are built locally and signed through the TronLink browser extension — private keys never leave TronLink.

## Requirements

- Node.js >= 20
- TronLink browser extension installed
- Browser running (write operations open TronLink for signing)

## Installation

```bash
# From npm
npm install -g @tronlink/tronlink-cli

# Local development
npm install
npm run build
npm link
```

After installation, the `tronlink` command is available globally.

## Global Options

| Option              | Default | Description                                                |
| ------------------- | ------- | ---------------------------------------------------------- |
| `--local-broadcast` | off     | CLI broadcasts locally instead of letting signer broadcast |
| `--json`            | off     | Output as JSON for scripts / AI agents                     |
| `--api-key <key>`   | -       | TronGrid API key (or set `TRON_API_KEY` env)               |
| `--timeout <ms>`    | 300000  | Signing/connection timeout in milliseconds                 |

All option names are **case-insensitive** (e.g. `--toAddress`, `--TOADDRESS`, `--toaddress` are equivalent).

## Commands

### Query (Read)

Read commands support two modes:

- **With `--address`**: queries directly via TronGrid, no wallet connection needed. Defaults to mainnet if `--network` is omitted.
- **Without `--address`**: connects wallet to get real-time address and network from TronLink.

```bash
# Query all token balances
tronlink balance --address <address> [--network mainnet]
tronlink balance                                          # connects wallet

# Query a specific TRC20 token balance (decimals auto-detected)
tronlink balance --address <address> --token <contract> [--decimals 6] [--network mainnet]

# Query a specific TRC10 token balance (decimals auto-detected)
tronlink balance --address <address> --tokenId <id> [--decimals 6] [--network mainnet]

# Query energy & bandwidth
tronlink resource --address <address> [--network nile]
tronlink resource                                         # connects wallet
```

**Mainnet tokens queried**: TRX, USDT, USDD, USDC, SUN, JST, BTT, WIN, WTRX
**Nile tokens queried**: TRX, USDT
**Shasta tokens queried**: TRX

### Transfer

```bash
# TRX (amount in TRX, not sun)
tronlink transfer --type trx --toAddress <to> --amount <amount> [--network nile]

# TRC10 (decimals auto-detected or specify --decimals)
tronlink transfer --type trc10 --tokenId <id> --toAddress <to> --amount <amount> [--decimals 6] [--network nile]

# TRC20 (decimals auto-detected; optional --fee-limit in TRX, default 100)
tronlink transfer --type trc20 --contract <contract> --toAddress <to> --amount <amount> [--decimals 6] [--fee-limit 150] [--network nile]

# TRC721 NFT (optional --fee-limit in TRX, default 100)
tronlink transfer --type trc721 --contract <contract> --toAddress <to> --tokenId <id> [--fee-limit 150] [--network nile]
```

Examples:

```bash
tronlink transfer --type trx --toAddress TYqx5gm3p3wLDE9Bv8TBJAbK4ELNbSLfJV --amount 100
tronlink transfer --type trc20 --contract TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t --toAddress TYqx5gm3p3wLDE9Bv8TBJAbK4ELNbSLfJV --amount 50
tronlink transfer --type trc721 --contract TContractAddr --toAddress TRecipient --tokenId 12345
```

Parameter validation per type:

| Type   | Required                                 | Not allowed                                           |
| ------ | ---------------------------------------- | ----------------------------------------------------- |
| trx    | `--toAddress`, `--amount`                | `--tokenId`, `--contract`, `--decimals`, `--fee-limit`|
| trc10  | `--toAddress`, `--amount`, `--tokenId`   | `--contract`, `--fee-limit`                           |
| trc20  | `--toAddress`, `--amount`, `--contract`  | `--tokenId`                                           |
| trc721 | `--toAddress`, `--contract`, `--tokenId` | `--amount`, `--decimals`                              |

### Staking (Stake 2.0)

```bash
# Stake TRX for energy or bandwidth
tronlink stake --amount <amount> --resource <energy|bandwidth> [--network nile]

# Unlock staked TRX
tronlink unstake --amount <amount> --resource <energy|bandwidth> [--network nile]

# Withdraw unfrozen TRX (after 14-day unlock period)
tronlink withdraw [--network nile]
```

### Resource Delegation

```bash
# Delegate energy or bandwidth (lock-period in days, supports decimals e.g. 1.5)
tronlink delegate --toAddress <to> --amount <amount> --resource <energy|bandwidth> [--lock-period <days>] [--network nile]

# Reclaim delegated resources
tronlink reclaim --fromAddress <from> --amount <amount> --resource <energy|bandwidth> [--network nile]
```

### Voting

```bash
# Vote for super representatives (format: address:count, supports multiple)
tronlink vote --votes <address:count...> [--network nile]

# Claim voting rewards
tronlink reward [--network nile]
```

Examples:

```bash
tronlink vote --votes TXxx:5 TYyy:3 TZzz:2
tronlink reward
```

## Transaction Signing

Write operations (transfer, stake, delegate, vote, etc.) require TronLink approval in the browser:

1. CLI builds the transaction locally and displays a preview
2. Browser opens the TronLink Signer approval page
3. User reviews and clicks Approve or Reject
4. Result is returned to the CLI

The browser window is reused across multiple commands — only one browser tab is needed per session. Closing the browser tab ends the session.

Multiple concurrent commands are supported. The browser UI shows each pending request as its own tab; approve them in any order.

Cancelling a command (Ctrl+C) cancels only that transaction. Other queued transactions are unaffected.

## Transaction Preview

All write operations display a preview before signing:

```text
Transaction Preview
┌───────────┬────────────────────────────────────────┐
│ Action    │ Transfer TRX                           │
│ Network   │ nile                                   │
│ From      │ TXxx...                                │
│ To        │ TYyy...                                │
│ Amount    │ 100 TRX                                │
│ Broadcast │ Signer                                 │
└───────────┴────────────────────────────────────────┘
Awaiting TronLink approval...
```

## Broadcast

By default, signed transactions are broadcast by the signer (TronLink). Use `--local-broadcast` to have the CLI broadcast locally via its own TronWeb instead:

```bash
# Default: signer broadcasts after signing
tronlink transfer --type trx --toAddress TYqx5gm3p3wLDE9Bv8TBJAbK4ELNbSLfJV --amount 100

# CLI broadcasts locally
tronlink transfer --type trx --toAddress TYqx5gm3p3wLDE9Bv8TBJAbK4ELNbSLfJV --amount 100 --local-broadcast
```

## Input Validation

All inputs are validated before connecting to TronLink:

- **Amounts**: non-negative numbers only, no scientific notation, no multiple decimals
- **TRX amounts**: must be > 0, within safe integer range after sun conversion
- **TRC20/TRC10 amounts**: decimal places must not exceed the token's decimals. Decimals auto-detected from chain if `--decimals` is omitted
- **Addresses**: valid TRON address format (verified via `TronWeb.isAddress()`)
- **Contract existence**: verified on the specified network before querying decimals
- **Vote counts**: positive integers, no duplicate SR addresses
- **Network**: must be `mainnet`, `nile`, or `shasta`
- **Decimals**: non-negative integer (0-77)
- **Fee limit**: positive number in TRX (TRC20/TRC721 only)
- **Transfer type validation**: missing required params or extra inapplicable params are rejected with clear errors

Invalid inputs are rejected immediately with a clear error before any wallet interaction.

## Output Formats

**Table (default):** Human-readable table output.

**JSON (`--json`):** Machine-readable output for scripts and AI agents.

## Supported Networks

| Network | API Endpoint                     | Explorer                      |
| ------- | -------------------------------- | ----------------------------- |
| mainnet | `https://api.trongrid.io`        | `https://tronscan.org`        |
| nile    | `https://nile.trongrid.io`       | `https://nile.tronscan.org`   |
| shasta  | `https://api.shasta.trongrid.io` | `https://shasta.tronscan.org` |

## How It Works

1. CLI parses command and validates all inputs
2. For read operations with `--address`: queries TronGrid directly
3. For write/read without `--address`: connects to the TronLink browser extension for wallet info
4. Builds unsigned transaction using local TronWeb `transactionBuilder`
5. Sends transaction to TronLink for signing (browser approval page)
6. Broadcasts: signer broadcasts by default (returns txId); with `--local-broadcast`, CLI broadcasts locally and verifies the result
7. Outputs result

## AI / Agent Usage

TronLink CLI supports AI agent integration via `--json` output. All commands return structured JSON for easy parsing.

### Prerequisites

- `tronlink` installed globally (`npm i -g @tronlink/tronlink-cli`)
- TronLink browser extension installed and unlocked
- Browser running (write operations open TronLink for signing)

### Rules

1. Always append `--json` to get machine-readable output
2. Write operations (transfer, stake, vote, etc.) will open the browser for user signing — wait for the command to return (default timeout: 5 minutes)
3. Read operations with `--address` don't need wallet connection, faster for lookups
4. Use `--network` to specify network, otherwise defaults to wallet's current network (write) or mainnet (read with address)
5. Cancelling a command (Ctrl+C) cancels only that transaction, not the signing session

### AI Command Reference

#### Query (no signing needed)

```bash
# Check all token balances
tronlink balance --address <address> --network mainnet --json

# Check a specific TRC20 token balance
tronlink balance --address <address> --token <contract> --network mainnet --json

# Check a specific TRC10 token balance
tronlink balance --address <address> --tokenId <id> --network mainnet --json

# Check energy & bandwidth
tronlink resource --address <address> --network mainnet --json
```

#### Transfer (requires signing)

```bash
# TRX
tronlink transfer --type trx --toAddress <to> --amount <amount> --json

# TRC20 (decimals auto-detected)
tronlink transfer --type trc20 --contract <contract> --toAddress <to> --amount <amount> --json

# TRC10 (decimals auto-detected)
tronlink transfer --type trc10 --tokenId <id> --toAddress <to> --amount <amount> --json

# TRC721 NFT
tronlink transfer --type trc721 --contract <contract> --toAddress <to> --tokenId <id> --json
```

#### Staking

```bash
tronlink stake --amount <amount> --resource energy --json
tronlink unstake --amount <amount> --resource energy --json
tronlink withdraw --json
```

#### Resource Delegation

```bash
tronlink delegate --toAddress <to> --amount <amount> --resource energy --json
tronlink reclaim --fromAddress <from> --amount <amount> --resource energy --json
```

#### Voting

```bash
tronlink vote --votes <addr:count...> --json
tronlink reward --json
```

### Common Token Contracts

| Token | Network | Contract                            |
| ----- | ------- | ----------------------------------- |
| USDT  | mainnet | TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t |
| USDD  | mainnet | TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz |
| USDC  | mainnet | TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8 |

### Example: AI Transfer Flow

```bash
# 1. Check balance first
tronlink balance --address TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL --network mainnet --json

# 2. Send 10 TRX (opens browser for signing, wait for return)
tronlink transfer --type trx --toAddress TRecipientAddress --amount 10 --network mainnet --json

# 3. Verify result — output includes txId and explorer URL
# { "Status": "Success", "TxID": "abc...", "Explorer": "https://tronscan.org/#/transaction/abc..." }
```

### Notes

- All write commands block until the user approves/rejects in TronLink browser popup
- If the user rejects or the signing times out (5 min), the command exits with an error
- Cancelling a CLI command (Ctrl+C) cancels only that transaction — other queued transactions continue
- Use `--timeout <ms>` to adjust the signing timeout
- Amounts use string-based math internally — no floating point precision issues

## License

MIT License Copyright (c) 2026 TronLink
