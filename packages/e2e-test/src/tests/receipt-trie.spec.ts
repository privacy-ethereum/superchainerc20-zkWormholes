import { testClientByChain, testClients } from '@/utils/clients'
import {
  decodeEventLog,
  parseEther,
  parseUnits,
  numberToHex,
  TransactionReceipt,
  Hex,
} from 'viem'
import {
  generatePrivateKey,
  privateKeyToAccount,
  toAccount,
} from 'viem/accounts'
import { beforeAll, describe, it, expect } from 'vitest'
import { envVars } from '@/envVars'
import { L2NativeSuperchainERC20Abi } from '@/abi/L2NativeSuperchainERC20Abi'
import { buildReceiptTrie, RawRpcReceipt } from '@/utils/receiptTrieProof'

const testPrivateKey = generatePrivateKey()
const testAccount = privateKeyToAccount(testPrivateKey)

// TODO: transform this into a unspendable / burn address
const recipientPrivateKey = generatePrivateKey()
const recipientAccount = privateKeyToAccount(recipientPrivateKey)

// contract deployer - used with impersonation in tests
const minterAccount = toAccount(envVars.VITE_TOKEN_MINTER_ADDRESS)

// supersimL2A 901
// supersimL2B 902
const l2NativeSuperchainERC20Contract = {
  address: envVars.VITE_TOKEN_CONTRACT_ADDRESS,
  abi: L2NativeSuperchainERC20Abi,
}

describe('receipt trie', async () => {
  const decimals = await testClientByChain.supersimL2A.readContract({
    ...l2NativeSuperchainERC20Contract,
    functionName: 'decimals',
  })

  let receipt: TransactionReceipt
  let receipts: RawRpcReceipt[]
  let receiptsRootHash: Hex

  beforeAll(async () => {
    // Deal 1000 ETH to the test account on each chain
    await Promise.all(
      testClients.map(async (client) => {
        await client.setBalance({
          address: testAccount.address,
          value: parseEther('1000'),
        })

        await client.setBalance({
          address: minterAccount.address,
          value: parseEther('1000'),
        })
      }),
    )

    // Impersonate the minter account and mint tokens to the test account
    await testClientByChain.supersimL2A.impersonateAccount({
      address: envVars.VITE_TOKEN_MINTER_ADDRESS,
    })
    const hash = await testClientByChain.supersimL2A.writeContract({
      account: minterAccount,
      address: envVars.VITE_TOKEN_CONTRACT_ADDRESS,
      abi: L2NativeSuperchainERC20Abi,
      functionName: 'mintTo',
      args: [testAccount.address, parseUnits('1000', decimals)],
    })
    await testClientByChain.supersimL2A.waitForTransactionReceipt({ hash })
  })

  it('should locally build an empty receipt trie', async () => {
    await testClientByChain.supersimL2A.mine({ blocks: 1 })

    const block = await testClientByChain.supersimL2A.getBlock()

    const nreceipts = await testClientByChain.supersimL2A.request({
      method: 'eth_getBlockReceipts' as any, // getBlockReceipts is not yet typed in viem but available in most RPCs
      params: [numberToHex(block.number)],
    })

    const { rootHash } = await buildReceiptTrie({
      receipts: nreceipts,
      targetTxIndex: numberToHex(0),
    })

    expect(nreceipts.length).toBe(0)
    expect(rootHash).toBe(block.receiptsRoot)

    await testClientByChain.supersimL2A.mine({ blocks: 1 })
  })

  it('should execute an ERC-20 token transfer and capture transaction receipt', async () => {
    const amount = parseUnits('10', decimals)

    const hash = await testClientByChain.supersimL2A.writeContract({
      account: testAccount,
      ...l2NativeSuperchainERC20Contract,
      functionName: 'transfer',
      args: [recipientAccount.address, amount],
    })

    receipt = await testClientByChain.supersimL2A.waitForTransactionReceipt({
      hash,
    })

    expect(receipt).toBeDefined()
    expect(receipt.status).toBe('success')
    expect(receipt.transactionHash).toBe(hash)
    expect(receipt.blockNumber).toBeGreaterThan(0n)
    expect(receipt.logs).toHaveLength(1)

    const transferLog = receipt.logs[0]
    expect(transferLog.address.toLowerCase()).toBe(
      envVars.VITE_TOKEN_CONTRACT_ADDRESS.toLowerCase(),
    )

    const decodedLog = decodeEventLog({
      abi: L2NativeSuperchainERC20Abi,
      data: transferLog.data,
      topics: transferLog.topics,
    })

    const args = decodedLog.args as {
      from: `0x${string}`
      to: `0x${string}`
      amount: bigint
    }

    expect(decodedLog.eventName).toBe('Transfer')
    expect(args.from).toBe(testAccount.address)
    expect(args.to).toBe(recipientAccount.address)
    expect(args.amount).toBe(amount)

    // Verify recipient received tokens
    const recipientBalance = await testClientByChain.supersimL2A.readContract({
      ...l2NativeSuperchainERC20Contract,
      functionName: 'balanceOf',
      args: [recipientAccount.address],
    })
    expect(recipientBalance).toBe(amount)
  })

  it('should download block receipts and receipt-trie root hash for a given block', async () => {
    receipts = await testClientByChain.supersimL2A.request({
      method: 'eth_getBlockReceipts' as any, // getBlockReceipts is not yet typed in viem but available in most RPCs
      params: [numberToHex(receipt.blockNumber)],
    })

    const block = await testClientByChain.supersimL2A.getBlock({
      blockNumber: receipt.blockNumber,
    })

    receiptsRootHash = block.receiptsRoot

    expect(block.receiptsRoot).toBeDefined()
    expect(receipts.length).toBeGreaterThanOrEqual(1)
  })

  it('should locally build the receipt trie with the ERC20 transfer log', async () => {
    const { rootHash } = await buildReceiptTrie({
      receipts,
      targetTxIndex: numberToHex(receipt.transactionIndex),
    })

    expect(rootHash).toBe(receiptsRootHash)
  })
})
