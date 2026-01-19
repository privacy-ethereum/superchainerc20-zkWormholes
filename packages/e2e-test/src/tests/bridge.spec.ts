import { parseEther, parseUnits } from 'viem'
import { beforeAll, describe, expect, it } from 'vitest'
import { testClientByChain, testClients } from '@/utils/clients'
import { envVars } from '@/envVars'
import { L2NativeSuperchainERC20Abi } from '@/abi/L2NativeSuperchainERC20Abi'
import {
  generatePrivateKey,
  privateKeyToAccount,
  toAccount,
} from 'viem/accounts'

const testPrivateKey = generatePrivateKey()
const testAccount = privateKeyToAccount(testPrivateKey)

// Private key-less account - used with impersonation
const minterAccount = toAccount(envVars.VITE_TOKEN_MINTER_ADDRESS)

const l2NativeSuperchainERC20Contract = {
  address: envVars.VITE_TOKEN_CONTRACT_ADDRESS,
  abi: L2NativeSuperchainERC20Abi,
} as const

describe('bridge token from L2 to L2', { timeout: 20 * 1000 }, async () => {
  const decimals = await testClientByChain.supersimL2A.readContract({
    ...l2NativeSuperchainERC20Contract,
    functionName: 'decimals',
  })

  beforeAll(async () => {
    // Deal 1000 ETH to the test account on each chain
    await Promise.all(
      testClients.map((client) =>
        client.setBalance({
          address: testAccount.address,
          value: parseEther('1000'),
        }),
      ),
    )
  })

  beforeAll(async () => {
    // Impersonate the minter account and mint 1000 tokens to the test account
    await Promise.all(
      testClients.map(async (client) => {
        await client.impersonateAccount({
          address: envVars.VITE_TOKEN_MINTER_ADDRESS,
        })
        const hash = await client.writeContract({
          account: minterAccount,
          address: envVars.VITE_TOKEN_CONTRACT_ADDRESS,
          abi: L2NativeSuperchainERC20Abi,
          functionName: 'mintTo',
          args: [testAccount.address, parseUnits('1000', decimals)],
        })
        await client.waitForTransactionReceipt({ hash })
      }),
    )
  })

  it.for([
    {
      source: testClientByChain.supersimL2A,
      destination: testClientByChain.supersimL2B,
    },
    {
      source: testClientByChain.supersimL2B,
      destination: testClientByChain.supersimL2A,
    },
  ] as const)(
    'should bridge tokens from $source.chain.id to $destination.chain.id',
    async ({ source: sourceClient, destination: destinationClient }) => {
      const startingDestinationBalance = await destinationClient.readContract({
        ...l2NativeSuperchainERC20Contract,
        functionName: 'balanceOf',
        args: [testAccount.address],
      })

      const amountToBridge = parseUnits('10', decimals)

      // Initiate bridge transfer of 10 tokens from L2A to L2B
      const hash = await sourceClient.sendSupERC20({
        account: testAccount,
        tokenAddress: envVars.VITE_TOKEN_CONTRACT_ADDRESS,
        amount: amountToBridge,
        chainId: destinationClient.chain.id,
        to: testAccount.address,
      })

      await sourceClient.waitForTransactionReceipt({
        hash,
      })

      // With supersim's --interop.autorelay, the message is automatically relayed
      // We just need to wait for the balance to update on the destination chain
      const maxAttempts = 50
      let attempts = 0
      let endingBalance = startingDestinationBalance

      while (attempts < maxAttempts) {
        endingBalance = await destinationClient.readContract({
          ...l2NativeSuperchainERC20Contract,
          functionName: 'balanceOf',
          args: [testAccount.address],
        })

        if (endingBalance === startingDestinationBalance + amountToBridge) {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 400)) // Wait 0.4 seconds before checking again
        attempts++
      }

      expect(endingBalance).toEqual(startingDestinationBalance + amountToBridge)
    },
  )

  it.for([
    {
      source: testClientByChain.supersimL2A,
      destination: testClientByChain.supersimL2B,
    },
  ] as const)(
    'should fail when trying to bridge more tokens than available balance',
    async ({ source: sourceClient }) => {
      const currentBalance = await sourceClient.readContract({
        ...l2NativeSuperchainERC20Contract,
        functionName: 'balanceOf',
        args: [testAccount.address],
      })

      const excessiveAmount = currentBalance + parseUnits('1', decimals)

      // Attempt to bridge more tokens than available
      await expect(
        sourceClient.sendSupERC20({
          account: testAccount,
          tokenAddress: envVars.VITE_TOKEN_CONTRACT_ADDRESS,
          amount: excessiveAmount,
          chainId: testClientByChain.supersimL2B.chain.id,
          to: testAccount.address,
        }),
      ).rejects.toThrow(/reverted/i)
    },
  )
})
