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
export function encodeRPCReceipt(receipt: RawRpcReceipt): Uint8Array {
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
 * Concatenate the start of the receipt
 * This can be considered data that will not be used inside the circuit
 *
 * For the total bytes we need to concat: startOfReceipt + startOfLogs + endLogs
 * endLogs = `from`, `to`, `amount`
 */
export function concatStartOfReceipt(receipt: RawRpcReceipt): Uint8Array {
  // Hardcoded RLP list prefix for ERC20 Transfer receipt
  // For typical ERC20 transfer: contentLength = 422 bytes
  // RLP long list: 0xf9 (249) + length in 2 bytes [0x01, 0xa6] = 422
  const listPrefix = Uint8Array.from([249, 1, 166])

  const statusEncoded = RLP.encode(
    receipt.status === '0x1' ? Uint8Array.from([1]) : Uint8Array.from([]),
  )
  const gasEncoded = RLP.encode(receipt.cumulativeGasUsed)
  const bloomEncoded = RLP.encode(receipt.logsBloom)

  const bytes = concatBytes(listPrefix, statusEncoded, gasEncoded, bloomEncoded)

  const txType = Number(receipt.type)
  if (txType === TransactionType.Legacy) {
    return bytes
  }

  return concatBytes(intToBytes(txType), bytes)
}

/**
 * Concatenate the start of the log bytes.
 * Total log: [[address, [topic0, topic1, topic2], data]]
 * This function returns bytes of [[address, [topic0,
 * The prefixes indicate the [] and [[]] required
 *
 * For the total bytes we only need to concat: topic1, topic2, data
 * topic1 = `from`
 * topic2 = `to`
 * data = `amount`
 *
 *
 * ASSUMPTION: This is optimized for a single ERC20 Transfer event with hardcoded RLP prefixes:
 * - All topics are 32 bytes (33 bytes RLP-encoded with 0xa0 prefix)
 * - Address is 20 bytes (21 bytes RLP-encoded with 0x94 prefix)
 * - Data is 32 bytes (33 bytes RLP-encoded with 0xa0 prefix)
 */
export function concatStartOfLog(receipt: RawRpcReceipt) {
  // Wrap in outer array [[log]]
  // Hardcoded values for single ERC20 Transfer log in array
  // logsLength = 157 (155 bytes log + 2 bytes log prefix)
  const logsListPrefix = Uint8Array.from([248, 157])

  // Hardcoded values for ERC20 Transfer individual log entry
  // logLength = 155 (21 bytes address + 101 bytes topics + 33 bytes data)
  const logListPrefix = Uint8Array.from([248, 155])

  const addressEncoded = RLP.encode(receipt.logs[0].address)

  // Hardcoded values for ERC20 Transfer event (3 topics of 32 bytes data + 1 byte prefix each)
  // topicsLength = 99 (3 * 33 bytes RLP-encoded)
  const topicsListPrefix = Uint8Array.from([248, 99])

  const topic0Encoded = RLP.encode(receipt.logs[0].topics[0])

  const startLog = concatBytes(
    logsListPrefix,
    logListPrefix,
    addressEncoded,
    topicsListPrefix,
    topic0Encoded,
  )

  return startLog
}

/**
 * Concatenate the starts to have the final start bytes ready
 * Wrapper from the previous two functions
 *
 * For the total bytes we only need: startOfReceiptAndLogs + endLogs
 * endLogs = `from`, `to`, `amount`
 */
export function concatStartsOfReceiptAndLog(
  receipt: RawRpcReceipt,
): Uint8Array {
  const startOfReceipt = concatStartOfReceipt(receipt)
  const startOfLog = concatStartOfLog(receipt)

  return concatBytes(startOfReceipt, startOfLog)
}

/**
 * Concatenate the end data that will be used in the circuit (aka endLogs)
 *
 * For the total bytes we need: startOfReceiptAndLogs + endLogs
 *
 * @param sender - Could be used to generate burn address
 * @param receiver - Will be generate inside circuit
 * @param amount - Needs to be checked out
 * @returns - endLogs = final bytes to concat to startOfReceiptAndLogs to get finalRLPEncoded
 */
export function encodeERC20TransferData(
  sender: Hex,
  receiver: Hex,
  amount: Hex,
) {
  const topic1Encoded = RLP.encode(sender)
  const topic2Encoded = RLP.encode(receiver)
  const dataEncoded = RLP.encode(amount)

  return concatBytes(topic1Encoded, topic2Encoded, dataEncoded)
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
