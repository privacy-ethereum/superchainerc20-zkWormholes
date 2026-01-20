# SuperchainERC20 Starter - ZK Wormholes Variant

## Principles

1. Simple and readable codebase
2. Always write tests to show intended usage
3. Focus on core functionality, avoid unnecessary features and abstractions. You can use hardcoded values if makes it efficient

## Project Architecture

This is a **fork of ethereum-optimism/superchainerc20-starter** implementing **zkWormholes (EIP-7503)** for privacy-preserving cross-chain SuperchainERC20 token transfers on the OP Stack Superchain.

**Project Goal:** Integrate ZK proofs with Superchain interoperability to enable private cross-chain token transfers where:

1. Users burn tokens on source chain
2. Generate a ZK proof-of-inclusion in the receipt trie of a specific block without revealing sender identity
3. Send the proof to smart contract on destination chain to mint tokens with privacy guarantees

**Core Components:**

- `packages/contracts/` - Foundry contracts implementing ERC-7802 (SuperchainERC20 standard) + zkWormholes integration
- `packages/circuits/` - Circom ZK circuits for privacy-preserving cross-chain transfers (EIP-7503)
- `packages/frontend/` - React/Vite demo app with private token bridging UI
- `packages/e2e-test/` - Vitest integration tests against supersim

**Key Insight:** This is a **monorepo using pnpm workspaces + nx**, not a standard npm project. All commands must use `pnpm` from the root.

## Development Workflow

1. Read the circuits documentation in `packages/circuits/README.md` to understand the ZK proof generation process.
2. Write or modify the circuits according to the need
3. Guide yourselft from the tests in `packages/e2e-test/` to see how to integrate the circuits with the contracts. Here you can find what input data can be send to the circuits and what output data you can expect.

Please ask any questions if you need clarification.
