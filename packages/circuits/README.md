# zkWormholes Circuits

Private cross-chain ERC20 token transfers using zero-knowledge proofs on the OP Stack Superchain.

## Overview

This package implements ZK circuits for zkWormholes (inspired by EIP-7503), enabling users to transfer tokens from Chain A to Chain B without publicly linking the sender and recipient addresses.

### How It Works

1. **Burn Phase (Source Chain):** User transfers tokens to a derived burn address
2. **Proof Generation (Off-chain):** Generate a ZK proof that the burn happened
3. **Mint Phase (Destination Chain):** Submit proof to mint tokens to any address

The burn address is derived from a secret known only to the sender. The nullifier (hash of the secret + address) prevents double-spending.

## Circuits

### 1. RLPEncode.circom

Encodes ERC20 Transfer event log data in RLP format for trie verification. It is assumed that the receipt contains only one Transfer event log and nothing else.

**Inputs:**

- `startBytes` - Bytes before the event log (e.g., receipt prefix)
- `sender` - Sender `from` address (32 bytes)
- `receiver` - Receiver `to` address. We will use burn address later (32 bytes)
- `amount` - Transfer amount padded (32 bytes)

**Outputs:**

- `out` - RLP-encoded event log as bits (fixed length assuming one log: 426 bytes)
