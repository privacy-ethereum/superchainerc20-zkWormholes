import { describe, expect, it } from 'vitest'
import { circomkit } from './common'
import {
  concatStartsOfReceiptAndLog,
  encodeERC20TransferData,
  encodeRPCReceipt,
} from '@/utils/receiptTrieProof'
import { concatBytes } from '@ethereumjs/util'
import { hexToBytes } from 'viem'
import { RECEIPT } from '@/utils/constants'

describe('RLPEncode', async () => {
  const circuit = await circomkit.WitnessTester(`RLPEncode`, {
    file: 'RLPEncode',
    template: 'RLPEncode',
  })

  it('should concatenate receipt encodings', async () => {
    const encodedReceipt = encodeRPCReceipt(RECEIPT)

    const start = concatStartsOfReceiptAndLog(RECEIPT)

    const sender = RECEIPT.logs[0].topics[1]
    const receiver = RECEIPT.logs[0].topics[2]
    const amount = RECEIPT.logs[0].data

    const encodedERC20Data = encodeERC20TransferData(sender, receiver, amount)

    const rlpEncoded = concatBytes(start, encodedERC20Data)

    expect(encodedReceipt).toEqual(rlpEncoded)
  })

  it('should encode a receipt inside the circuit', async () => {
    const startBytes = concatStartsOfReceiptAndLog(RECEIPT)

    const sender = hexToBytes(RECEIPT.logs[0].topics[1])
    const receiver = hexToBytes(RECEIPT.logs[0].topics[2])
    const amount = hexToBytes(RECEIPT.logs[0].data)

    const input = {
      startBytes: Array.from(startBytes),
      sender: Array.from(sender),
      receiver: Array.from(receiver),
      amount: Array.from(amount),
    }

    const expectedOutput = encodeRPCReceipt(RECEIPT)
    const output = {
      out: Array.from(expectedOutput),
    }

    await circuit.expectPass(input, output)

    const { out } = await circuit.compute(input, ['out'])
    const outAsNumbers = (out as bigint[]).map(Number)

    expect(Array.from(expectedOutput)).toEqual(outAsNumbers)
  })

  it('should encode incorrectly if input data is incorrect', async () => {
    const startBytes = concatStartsOfReceiptAndLog(RECEIPT)

    const sender = hexToBytes(RECEIPT.logs[0].topics[1])
    const amount = hexToBytes(RECEIPT.logs[0].data)

    const input = {
      startBytes: Array.from(startBytes),
      sender: Array.from(sender),
      receiver: Array.from(sender),
      amount: Array.from(amount),
    }

    const { out } = await circuit.compute(input, ['out'])
    const outAsNumbers = Array.from(out as bigint[])

    const expectedOutput = encodeRPCReceipt(RECEIPT)

    expect(outAsNumbers).not.toEqual(expectedOutput)
  })
})
