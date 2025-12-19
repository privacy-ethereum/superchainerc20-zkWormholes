import { createMerkleProof, createMPT } from '@ethereumjs/mpt'
import { RLP } from '@ethereumjs/rlp'
import { TransactionType } from '@ethereumjs/tx'
import { concatBytes, intToBytes } from '@ethereumjs/util'
import { bytesToHex, Hex } from 'viem'

/**
 * Raw receipt format from eth_getBlockReceipts RPC call
 * This not necesarily match the TransactionReceipt type from viem or ethereumjs
 */
export type RawRpcReceipt = {
  status: Hex // "0x1" or "0x0"
  cumulativeGasUsed: Hex
  logsBloom: Hex
  logs: Array<{
    address: Hex
    topics: Hex[]
    data: Hex
  }>
  type: Hex // "0x0", "0x1", "0x2", etc.
  transactionIndex: Hex
}

/**
 * Arguments for building a receipt trie
 */
type BuildReceiptTrieArgs = {
  receipts: RawRpcReceipt[]
  targetTxIndex: Hex
}

/**
 * Return type for building a receipt trie
 */
type BuildReceiptTrieReturn = {
  rootHash: Hex
  key: Hex
  proofNodes: Hex[]
}

/**
 * Encode a raw RPC receipt for the receipt trie
 */
function encodeRPCReceipt(receipt: RawRpcReceipt): Uint8Array {
  const txType = Number(receipt.type)

  const logs = receipt.logs.map((log) => [
    log.address,
    log.topics.map((topic) => topic),
    log.data,
  ])

  const encoded = RLP.encode([
    // zk-wormholes txs happen after byzantium, so status field exists
    receipt.status === '0x1' ? Uint8Array.from([1]) : Uint8Array.from([]),
    receipt.cumulativeGasUsed,
    receipt.logsBloom,
    logs,
  ])

  // Legacy transactions (type 0) are NOT prefixed with type byte
  if (txType === TransactionType.Legacy) {
    return encoded
  }

  return concatBytes(intToBytes(txType), encoded)
}

/**
 * Build a Merkle Patricia Trie from the given receipts.
 * @param param0 - The arguments for building the receipt trie.
 * @returns The return values of a receipt trie
 */
export async function buildReceiptTrie({
  receipts,
  targetTxIndex,
}: BuildReceiptTrieArgs): Promise<BuildReceiptTrieReturn> {
  const trie = await createMPT()

  for (const receipt of receipts) {
    const key = RLP.encode(Number(receipt.transactionIndex))
    const value = encodeRPCReceipt(receipt)

    await trie.put(key, value)
  }

  const trieRoot = bytesToHex(trie.root())

  const targetKey = RLP.encode(Number(targetTxIndex))
  const proof = await createMerkleProof(trie, targetKey)

  return {
    rootHash: trieRoot,
    key: bytesToHex(targetKey),
    proofNodes: proof.map((node) => bytesToHex(node)),
  }
}
