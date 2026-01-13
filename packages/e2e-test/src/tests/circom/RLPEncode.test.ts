import { describe, expect, it } from 'vitest'
import { circomkit } from './common'
import {
  concatStartsOfReceiptAndLog,
  encodeERC20TransferData,
  encodeRPCReceipt,
  RawRpcReceipt,
} from '@/utils/receiptTrieProof'
import { concatBytes } from '@ethereumjs/util'
import { hexToBytes } from 'viem'

describe('RLPEncode', async () => {
  const circuit = await circomkit.WitnessTester(`RLPEncodeReceipt`, {
    file: 'RLPEncodeReceipt',
    template: 'RLPEncodeReceipt',
  })

  const receipt: RawRpcReceipt = {
    type: '0x2',
    status: '0x1',
    cumulativeGasUsed: '0xc993',
    logs: [
      {
        address: '0x2c210d2710cee4cc67739acfad3db7ed82b00f5b',
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          '0x00000000000000000000000017dda80c412f4dec3d70dc9904c313838dabb2c9',
          '0x000000000000000000000000973c8c2ba29c7faf6ce41b72446cc27268b3f6e4',
        ],
        data: '0x0000000000000000000000000000000000000000000000008ac7230489e80000',
      },
    ],
    logsBloom:
      '0x00000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000008000000004000000000000000000000000000000000000000000000000000000000000000000001000000000040000010000000080002000000000000000000000100000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    transactionIndex: '0x0',
  }

  it('should concatenate receipt encodings', async () => {
    const encodedReceipt = encodeRPCReceipt(receipt)

    const start = concatStartsOfReceiptAndLog(receipt)

    const sender = receipt.logs[0].topics[1]
    const receiver = receipt.logs[0].topics[2]
    const amount = receipt.logs[0].data

    const encodedERC20Data = encodeERC20TransferData(sender, receiver, amount)

    const rlpEncoded = concatBytes(start, encodedERC20Data)

    expect(encodedReceipt).toEqual(rlpEncoded)
  })

  it('should encode a receipt inside the circuit', async () => {
    const startBytes = concatStartsOfReceiptAndLog(receipt)

    const sender = hexToBytes(receipt.logs[0].topics[1])
    const receiver = hexToBytes(receipt.logs[0].topics[2])
    const amount = hexToBytes(receipt.logs[0].data)

    const INPUT = {
      startBytes: Array.from(startBytes),
      sender: Array.from(sender),
      receiver: Array.from(receiver),
      amount: Array.from(amount),
    }

    const expectedOutput = encodeRPCReceipt(receipt)
    const OUTPUT = {
      out: Array.from(expectedOutput),
    }

    await circuit.expectPass(INPUT, OUTPUT)

    const { out } = await circuit.compute(INPUT, ['out'])

    const outAsNumbers = (out as bigint[]).map(Number)

    expect(outAsNumbers).toEqual(Array.from(expectedOutput))
  })

  it('should encode incorrectly if input data is incorrect', async () => {
    const startBytes = concatStartsOfReceiptAndLog(receipt)

    const sender = hexToBytes(receipt.logs[0].topics[1])
    const amount = hexToBytes(receipt.logs[0].data)

    const INPUT = {
      startBytes: Array.from(startBytes),
      sender: Array.from(sender),
      receiver: Array.from(sender),
      amount: Array.from(amount),
    }

    const expectedOutput = encodeRPCReceipt(receipt)

    const { out } = await circuit.compute(INPUT, ['out'])

    const outAsNumbers = (out as bigint[]).map(Number)

    expect(outAsNumbers).not.toEqual(Array.from(expectedOutput))
  })
})
