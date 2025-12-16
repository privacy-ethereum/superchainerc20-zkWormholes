import { Trie } from '@ethereumjs/trie'
import { RLP } from '@ethereumjs/rlp'
import { bytesToHex, hexToBytes } from '@ethereumjs/util'
import type { TransactionReceipt, Hex } from 'viem'

/**
 * Receipt status enum (EIP-658)
 * - 0: failure
 * - 1: success
 */
type ReceiptStatus = 0 | 1

/**
 * Ethereum receipt structure for RLP encoding
 */
interface ReceiptForRLP {
  status: ReceiptStatus
  cumulativeGasUsed: bigint
  logsBloom: Uint8Array
  logs: Array<{
    address: Uint8Array
    topics: Uint8Array[]
    data: Uint8Array
  }>
}

/**
 * Result of receipt trie proof generation
 */
export interface ReceiptTrieProof {
  /** The key used to access the receipt in the trie (RLP-encoded receipt index) */
  key: Hex
  /** RLP-encoded receipt data */
  value: Hex
  /** Array of proof nodes (each node is RLP-encoded) */
  proofNodes: Hex[]
  /** Total length of all proof nodes concatenated */
  proofNodesLength: number
  /** Individual lengths of each proof node */
  proofNodeLengths: number[]
  /** Receipt root hash (should match block.receiptsRoot) */
  root: Hex
}

/**
 * Converts a TransactionReceipt to the format needed for RLP encoding
 */
function formatReceiptForRLP(receipt: TransactionReceipt): ReceiptForRLP {
  return {
    status: receipt.status === 'success' ? 1 : 0,
    cumulativeGasUsed: receipt.cumulativeGasUsed,
    logsBloom: hexToBytes(receipt.logsBloom),
    logs: receipt.logs.map((log) => ({
      address: hexToBytes(log.address),
      topics: log.topics.map((topic) => hexToBytes(topic)),
      data: hexToBytes(log.data),
    })),
  }
}

/**
 * Encodes a receipt using RLP (post-EIP-658 format with status field)
 * For EIP-2718 typed transactions (type > 0), prepends the transaction type byte
 */
function encodeReceipt(receipt: TransactionReceipt): Uint8Array {
  const formatted = formatReceiptForRLP(receipt)

  // Encode logs: [[address, [topic1, topic2, ...], data], ...]
  const encodedLogs = formatted.logs.map((log) => [
    log.address,
    log.topics,
    log.data,
  ])

  // Receipt structure: [status, cumulativeGasUsed, logsBloom, logs]
  // RLP.encode will handle bigint conversion automatically
  const receiptArray = [
    formatted.status,
    formatted.cumulativeGasUsed,
    formatted.logsBloom,
    encodedLogs,
  ]

  const rlpEncoded = RLP.encode(receiptArray)

  // For EIP-2718 typed transactions, prepend the transaction type byte
  // Type 0 (legacy) doesn't need a type prefix
  // Type 2 (EIP-1559) needs 0x02 prefix
  if (receipt.type === 'eip1559' || receipt.type === '0x2') {
    const typePrefix = new Uint8Array([2])
    const result = new Uint8Array(typePrefix.length + rlpEncoded.length)
    result.set(typePrefix, 0)
    result.set(rlpEncoded, typePrefix.length)
    return result
  } else if (receipt.type === 'eip2930' || receipt.type === '0x1') {
    const typePrefix = new Uint8Array([1])
    const result = new Uint8Array(typePrefix.length + rlpEncoded.length)
    result.set(typePrefix, 0)
    result.set(rlpEncoded, typePrefix.length)
    return result
  }

  // Legacy transaction (type 0)
  return rlpEncoded
}

/**
 * Generates a Merkle-Patricia proof for a specific receipt in a block's receipt trie
 *
 * @param receipts - All receipts from the block (ordered by transaction index)
 * @param receiptIndex - Index of the receipt to prove (0-based)
 * @returns Receipt trie proof data formatted for circuit input
 */
export async function generateReceiptTrieProof(
  receipts: TransactionReceipt[],
  receiptIndex: number,
): Promise<ReceiptTrieProof> {
  if (receiptIndex < 0 || receiptIndex >= receipts.length) {
    throw new Error(
      `Invalid receipt index ${receiptIndex}, must be between 0 and ${receipts.length - 1}`,
    )
  }

  // Create a new trie
  const trie = await Trie.create()

  // Build the receipt trie by inserting all receipts
  for (let i = 0; i < receipts.length; i++) {
    // Key is RLP-encoded transaction index
    const key = RLP.encode(i)

    // Value is RLP-encoded receipt
    const value = encodeReceipt(receipts[i])

    await trie.put(key, value)
  }

  // Get the root hash
  const root = bytesToHex(trie.root())

  // Generate proof for the target receipt
  const key = RLP.encode(receiptIndex)
  const proof = await trie.createProof(key)

  // Format proof nodes as hex strings
  const proofNodes = proof.map((node) => bytesToHex(node))

  // Calculate lengths
  const proofNodeLengths = proof.map((node) => node.length)
  const proofNodesLength = proofNodeLengths.reduce((sum, len) => sum + len, 0)

  // Get the value (RLP-encoded receipt)
  const value = bytesToHex(encodeReceipt(receipts[receiptIndex]))

  return {
    key: bytesToHex(key),
    value,
    proofNodes,
    proofNodesLength,
    proofNodeLengths,
    root,
  }
}

/**
 * Verifies a receipt trie proof against a known root hash
 *
 * @param proof - The proof to verify
 * @param expectedRoot - The expected root hash (from block.receiptsRoot)
 * @returns true if the proof is valid
 */
export async function verifyReceiptTrieProof(
  proof: ReceiptTrieProof,
  expectedRoot?: Hex,
): Promise<boolean> {
  try {
    // Verify the proof
    const key = hexToBytes(proof.key)
    const proofNodes = proof.proofNodes.map((node) => hexToBytes(node))

    const verified = await Trie.verifyProof(
      hexToBytes(expectedRoot || proof.root),
      key,
      proofNodes,
    )

    // Check if the verified value exists and matches
    if (!verified) {
      console.log('Proof verification returned null/undefined')
      return false
    }

    const verifiedHex = bytesToHex(verified)
    const matches = verifiedHex === proof.value

    if (!matches) {
      console.log('Value mismatch:')
      console.log('- Expected:', proof.value.substring(0, 66) + '...')
      console.log('- Verified:', verifiedHex.substring(0, 66) + '...')
    }

    return matches
  } catch (error) {
    console.error('Proof verification failed:', error)
    return false
  }
}

/**
 * Formats proof data for circuit input (concatenated bytes)
 *
 * @param proof - The receipt trie proof
 * @returns Object containing circuit-ready inputs
 */
export function formatProofForCircuit(proof: ReceiptTrieProof) {
  // Concatenate all proof nodes into a single byte array
  const concatenatedProof = proof.proofNodes.join('').replace(/0x/g, '')

  return {
    root: proof.root,
    key: proof.key,
    value: proof.value,
    proofNodes: `0x${concatenatedProof}` as Hex,
    proofNodeLengths: proof.proofNodeLengths,
    proofNodesLength: proof.proofNodesLength,
  }
}
