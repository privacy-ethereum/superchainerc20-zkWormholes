import { testClientByChain, testClients } from '@/utils/clients'
import {
  decodeEventLog,
  pad,
  parseEther,
  parseUnits,
  numberToHex,
  TransactionReceipt,
  Hex,
  toHex,
  toEventSelector,
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

  const amountToSend = parseUnits('10', decimals)

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
    const hash = await testClientByChain.supersimL2A.writeContract({
      account: testAccount,
      ...l2NativeSuperchainERC20Contract,
      functionName: 'transfer',
      args: [recipientAccount.address, amountToSend],
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
    expect(args.amount).toBe(amountToSend)

    // Verify recipient received tokens
    const recipientBalance = await testClientByChain.supersimL2A.readContract({
      ...l2NativeSuperchainERC20Contract,
      functionName: 'balanceOf',
      args: [recipientAccount.address],
    })
    expect(recipientBalance).toBe(amountToSend)
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

  it("should be the same transaction log as the downloaded receipt's log", async () => {
    const transactionLog = receipt.logs[0]
    const downloadedLog = receipts[0].logs[0]

    // @ts-expect-error - Runtime conversion works; viem types don't reflect mutability
    transactionLog.blockNumber = toHex(transactionLog.blockNumber)
    // @ts-expect-error
    transactionLog.logIndex = toHex(transactionLog.logIndex)
    // @ts-expect-error
    transactionLog.transactionIndex = toHex(transactionLog.transactionIndex)

    expect(transactionLog).toStrictEqual(downloadedLog)
  })

  it("should be the transfer event selector in the log's first topic [0]", async () => {
    const firstTopic = receipts[0].logs[0].topics[0].toLowerCase()

    const transferEventSelector = toEventSelector(
      'Transfer(address,address,uint256)',
    )

    expect(firstTopic).toBe(transferEventSelector)
  })

  it("should be the padded sender address in the log's second topic [1]", async () => {
    const sender = pad(testAccount.address).toLowerCase()

    const secondTopic = receipts[0].logs[0].topics[1]

    expect(secondTopic).toBe(sender)
  })

  it("should be the padded recipient address in the log's third topic [2]", async () => {
    const recipient = pad(recipientAccount.address).toLowerCase()

    const thirdTopic = receipts[0].logs[0].topics[2]

    expect(thirdTopic).toBe(recipient)
  })

  it('should have the padded sended amount as hex in the log data', async () => {
    const paddedAmountToSendInHex = pad(toHex(amountToSend))

    const logData = receipts[0].logs[0].data

    expect(logData).toBe(paddedAmountToSendInHex)
  })

  it('should locally build the receipt trie with the ERC20 transfer log', async () => {
    const { rootHash } = await buildReceiptTrie({
      receipts,
      targetTxIndex: numberToHex(receipt.transactionIndex),
    })

    expect(rootHash).toBe(receiptsRootHash)
  })
})
