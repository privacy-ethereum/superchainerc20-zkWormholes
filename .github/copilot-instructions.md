# SuperchainERC20 Starter - ZK Wormholes Variant

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

### Starting Development

```bash
pnpm dev  # Starts mprocs orchestrator which runs:
          # - supersim (local 3-chain testnet on ports 8545/9545/9546)
          # - contract deployment
          # - frontend on localhost:5173
```

### Contract Development

**Deployment Pattern:** Uses `Create2` for deterministic addresses across chains (required for interop).

```bash
# Deploy token to configured chains
pnpm contracts:deploy:token

# Run contract tests
cd packages/contracts && forge test
```

**Config:** Edit `packages/contracts/configs/deploy-config.toml`:

- `salt` - Create2 salt for deterministic deployment
- `chains` - Target chains (must match `[rpc_endpoints]` in `foundry.toml`)
- `[token]` section - Token metadata and owner address

**Testing Pattern:** When creating custom SuperchainERC20 tokens, **always run `SuperchainERC20.t.sol` against your implementation** to ensure bridge compatibility:

```diff
- SuperchainERC20 public superchainERC20;
+ MyCustomToken public superchainERC20;
```

### SuperchainERC20 Implementation Rules

**Must-Know:** ERC-7802 defines the interface but NOT the implementation. You control:

1. **Access control** for `crosschainMint`/`crosschainBurn` (default: only `SuperchainTokenBridge` at `0x4200000000000000000000000000000000000028`)
2. **Minting/burning logic** (supply caps, pausability, etc.)
3. **Bridge choice** (can use custom bridge instead of `SuperchainTokenBridge`)

**Standard Implementation:**

```solidity
abstract contract SuperchainERC20 is ERC20, IERC7802 {
    function crosschainMint(address _to, uint256 _amount) external {
        require(msg.sender == PredeployAddresses.SUPERCHAIN_TOKEN_BRIDGE, "Unauthorized");
        _mint(_to, _amount);
        emit CrosschainMint(_to, _amount, msg.sender);
    }
    // Similar for crosschainBurn
}
```

**Customization:** To use a different bridge or add restrictions, modify the `require` check and minting logic. See `examples/L2NativeInteroperableGovernanceToken.sol` for governance token variant.

### Cross-Chain Bridging Flow

**Bridge Predeploy:** `0x4200000000000000000000000000000000000028` (SuperchainTokenBridge)

**Manual Bridge Example (using cast):**

```bash
# 1. Mint tokens on chain 901
cast send <token-addr> "mintTo(address,uint256)" <recipient> 1000 \
  --rpc-url http://127.0.0.1:9545 --private-key <key>

# 2. Send cross-chain via bridge
cast send 0x4200000000000000000000000000000000000028 \
  "sendERC20(address,address,uint256,uint256)" \
  <token-addr> <recipient> 1000 902 \
  --rpc-url http://127.0.0.1:9545 --private-key <key>

# 3. Wait for RelayedMessage log on chain 902 (supersim autorelay)
# 4. Verify balance: cast balance --erc20 <token-addr> <recipient> --rpc-url http://127.0.0.1:9546
```

**In Code:** Use `@eth-optimism/viem` extensions:

- `createInteropSentL2ToL2Messages()` - Extract cross-chain messages from receipts
- `decodeRelayedL2ToL2Messages()` - Decode relayed messages
- See `packages/e2e-test/src/tests/bridge.spec.ts` for full flow

### E2E Testing

```bash
pnpm e2e-test  # Runs mprocs-e2e-test.yaml config
pnpm e2e-test:ci  # CI-friendly variant
```

**Test Setup Pattern:**

1. `setBalance()` to fund test accounts (supersim allows this)
2. `impersonateAccount()` to mint tokens as owner
3. Bridge tokens and assert balance changes
4. Check for `RelayedMessage` events on destination chain

### zkWormholes (EIP-7503) Implementation

**Goal:** Implement privacy-preserving cross-chain token transfers using ZK proofs to hide sender identity while maintaining Superchain interoperability.

#### Architecture Overview

**Flow:**

1. **Deposit/Burn Phase (Source Chain):** User burns tokens to a derived address, creating a commitment
2. **Proof Generation (Off-chain):** Generate ZK proof of burn without revealing sender
3. **Relay Phase:** Submit proof + commitment to destination chain
4. **Withdraw/Mint Phase (Destination Chain):** Verify proof and mint tokens to recipient

#### Circuit Development (`packages/circuits/`)

**Current Circuit:** `Withdraw.circom` - Privacy-preserving withdrawal proof

**Circuit Constraints:**

- **Value conservation:** `withdrawAmount + changeAmount == depositAmount`
- **Nullifier derivation:** `Poseidon(secret, DOMAIN_NULLIFIER) == nullifier` (prevents double-spend)
- **Change commitment:** `Poseidon(changeAmount, changeSalt, DOMAIN_CHANGE) == changeCommitment` (UTXO-style)
- **Burn address tie:** `Poseidon(secret, DOMAIN_ADDR) == burnAddr` (links secret to burn address)
- **Receipt verification:** `Poseidon(tokenAddr, fromAddr, burnAddr, depositAmount, blockNumber, txIndex, logIndex) == receiptFact`

**Domain Separators:**

```circom
DOMAIN_NULLIFIER = 1  // For spend prevention
DOMAIN_CHANGE = 2     // For change commitments
DOMAIN_ADDR = 3       // For burn address derivation
```

**Public Inputs:** `[receiptFact, tokenAddr, withdrawAmount, changeCommitment, nullifier]`

**Private Inputs:** `[secret, depositAmount, changeAmount, changeSalt, fromAddr, burnAddr, blockNumber, txIndex, logIndex]`

#### Circuit Build Workflow

```bash
# In packages/circuits/
# 1. Compile circuit
circom circom/Withdraw.circom --r1cs --wasm --sym --c

# 2. Generate trusted setup (or use existing ceremony)
snarkjs groth16 setup Withdraw.r1cs pot_final.ptau circuit_0000.zkey

# 3. Export verification key
snarkjs zkey export verificationkey circuit_final.zkey verification_key.json

# 4. Generate Solidity verifier
snarkjs zkey export solidityverifier circuit_final.zkey Verifier.sol
```

**Move `Verifier.sol` to:** `packages/contracts/src/zkWormholes/Verifier.sol`

#### Contract Integration (`packages/contracts/`)

**New Contracts to Create:**

1. **`src/zkWormholes/Verifier.sol`** - Auto-generated from circuit (via snarkjs)
2. **`src/zkWormholes/ZkWormholesERC20.sol`** - Main zkWormholes contract
   - Extends `SuperchainERC20`
   - Tracks nullifiers (prevent double-spend)
   - Verifies ZK proofs before minting
   - Emits privacy-preserving events

**Key Functions to Implement:**

```solidity
// ZkWormholesERC20.sol structure
contract ZkWormholesERC20 is SuperchainERC20 {
    mapping(uint256 => bool) public nullifiers; // Track spent commitments
    Verifier public verifier;

    function privateMint(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[5] calldata _pubSignals // [receiptFact, tokenAddr, withdrawAmount, changeCommitment, nullifier]
    ) external {
        require(!nullifiers[_pubSignals[4]], "Nullifier already used");
        require(verifier.verifyProof(_pA, _pB, _pC, _pubSignals), "Invalid proof");

        nullifiers[_pubSignals[4]] = true;
        _mint(msg.sender, _pubSignals[2]); // withdrawAmount

        emit PrivateMint(msg.sender, _pubSignals[2], _pubSignals[4]);
    }
}
```

**Integration with SuperchainTokenBridge:**

- Option A: Keep using `SuperchainTokenBridge` for public transfers, add zkWormholes for private transfers
- Option B: Modify `crosschainMint`/`crosschainBurn` to accept ZK proofs (breaks standard compatibility)
- **Recommended:** Option A - separate private transfer path alongside public bridge

#### Testing Strategy

**Unit Tests (Foundry):**

```bash
# packages/contracts/test/zkWormholes/
# - ZkWormholesERC20.t.sol - Test private burn/mint flow
# - Verifier.t.sol - Test proof verification with sample proofs
```

**E2E Tests (Vitest):**

```bash
# packages/e2e-test/src/tests/
# - zkWormholes.spec.ts - End-to-end private cross-chain transfer
#   1. Generate secret + commitment
#   2. Burn on chain A
#   3. Generate proof (using witness calculator)
#   4. Submit proof to chain B
#   5. Verify private mint + nullifier tracking
```

**Test Pattern:**

1. Pre-generate test proofs using snarkjs in CI
2. Store in `packages/e2e-test/src/fixtures/proofs/`
3. Use for deterministic testing without full circuit execution

#### Frontend Integration

**Witness Generation:**

```typescript
// packages/frontend/src/zkWormholes/
// - witnessCalculator.ts - WASM witness generation
// - proofGenerator.ts - Call snarkjs in browser
// - commitment.ts - Generate commitments/nullifiers
```

**UI Flow:**

1. User enters amount + destination chain
2. Generate secret (store securely!)
3. Derive burn address, show warning about irreversible burn
4. Execute burn transaction
5. Generate proof (show progress indicator - can take 10-30s)
6. Submit proof to destination chain
7. Track nullifier for preventing double-spend

#### EIP-7503 Compliance

**Reference:** https://eips.ethereum.org/EIPS/eip-7503

**Key Requirements:**

- Asset privacy (hide sender/receiver linkage) ✓ Using nullifiers + commitments
- Cross-chain state verification ✓ Using receiptFact to prove burn
- Non-replayability ✓ Using nullifier tracking
- Deterministic address derivation ✓ Using Poseidon(secret, DOMAIN_ADDR)

**Deviations from EIP-7503:**

- Using Superchain interop instead of generic cross-chain messaging
- Poseidon hash instead of keccak256 (more circuit-efficient)
- UTXO-style change outputs (not in base EIP-7503)

#### Development Phases

**Phase 1: Circuit Development** ✓ (Current: Withdraw.circom exists)

- [ ] Write circuits to process receipt trie and generate inclusion proofs
- [ ] Integrate receipt trie with Withdraw circuit
- [ ] Optimize constraint count
- [ ] Run circuit tests with snarkjs

**Phase 2: Contract Integration** (In Progress)

- [ ] Generate Verifier.sol from circuit
- [ ] Implement ZkWormholesERC20 contract
- [ ] Add nullifier tracking + proof verification
- [ ] Write Foundry tests with mock proofs

**Phase 3: E2E Integration**

- [ ] Setup circom/snarkjs build pipeline
- [ ] Add witness generation to frontend
- [ ] Create e2e tests with real proof generation
- [ ] Test against supersim with multiple chains

## Project-Specific Conventions

- **No npm/yarn:** Use `pnpm` exclusively (enforced by `"packageManager": "pnpm@9.0.2"`)
- **Nx for orchestration:** Commands like `pnpm nx run @superchainerc20-starter/contracts:deploy:dev`
- **Solidity version:** `pragma solidity 0.8.25` (NOT ^0.8.25) for interop compatibility
- **Remappings:** Uses `@interop-lib`, `@solady`, `@openzeppelin` - see `remappings.txt`
- **Test accounts:** Default anvil account `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` with key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

## Common Pitfalls

### Supersim Issues

1. **Anvil crashes:** Usually fixed by updating `supersim` version or running `foundryup`
2. **Supersim autorelay:** Runs automatically, no need to manually relay messages (unlike production interop)
3. **RPC issues:** Chain names in `deploy-config.toml` must exactly match keys in `foundry.toml` `[rpc_endpoints]`

### Contract Issues

4. **Wrong addresses across chains:** Ensure Create2 salt in `deploy-config.toml` is consistent
5. **Bridge not working:** Verify token implements `supportsInterface()` for `type(IERC7802).interfaceId`

### zkWormholes Issues

6. **Circuit compilation errors:** Ensure circom v2.2+ installed: `circom --version`
7. **Proof generation timeout:** Large circuits can take +1min in browser. We will fix this later.
8. **Nullifier already used:** Each secret can only be used once - track spent nullifiers
9. **Proof verification gas:** Groth16 proofs cost ~280k gas - optimize public input count
10. **Witness generation mismatch:** Ensure circuit inputs match exactly (including field order and types)

## External Dependencies

- **Optimism Specs:** https://specs.optimism.io/interop/overview.html - authoritative interop reference
- **ERC-7802:** https://ethereum-magicians.org/t/erc-7802-crosschain-token-interface/21508 - standard spec
- **Supersim:** https://github.com/ethereum-optimism/supersim - local multi-chain testnet
- **@eth-optimism/viem:** Extended viem for OP Stack message passing
- **interop-lib:** Foundry library with predeploy addresses and interfaces

## File References

- Token implementation: `packages/contracts/src/L2NativeSuperchainERC20.sol`
- Base SuperchainERC20: `packages/contracts/src/SuperchainERC20.sol`
- Deployment script: `packages/contracts/scripts/SuperchainERC20Deployer.s.sol`
- Bridge UI: `packages/frontend/src/Bridge.tsx`
- E2E tests: `packages/e2e-test/src/tests/bridge.spec.ts`
- Config: `packages/contracts/configs/deploy-config.toml`
