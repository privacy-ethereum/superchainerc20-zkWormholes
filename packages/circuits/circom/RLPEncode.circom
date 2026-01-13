pragma circom 2.2.0;

/**
 * RLPEncode
 *
 * This circuit takes pre-computed start bytes and RLP-encodes the remaining
 * ERC20 Transfer event data (sender, receiver, amount) then concatenates them.
 *
 * Inputs:
 * - startBytes[327]: Pre-computed prefix (type, receipt header, bloom, log prefix, topic0, ...)
 * - sender[32]: ERC20 Transfer topic1 (address `from`, padded to 32 bytes)
 * - receiver[32]: ERC20 Transfer topic2 (address `to`, padded to 32 bytes)
 * - amount[32]: ERC20 Transfer data (uint256 `amount`, padded to 32 bytes)
 *
 * Outputs:
 * - out[426]: Complete RLP-encoded receipt: startBytes || rlpSender || rlpReceiver || rlpAmount
 */
template RLPEncode() {
    // Length constants
    var START_BYTES_LEN = 327; // (type + receipt prefix + status + gas + bloom + log prefixes + address + topics prefix + topic0)
    var TOPIC_LEN = 32; // Ethereum addresses (20 bytes + 12 bytes padding = 32 bytes)
    var RLP_ENCODED_32_BYTE_LEN = 1 + TOPIC_LEN;  // 0xa0 prefix + 32 bytes
    var TOTAL_OUTPUT_LEN = START_BYTES_LEN + (RLP_ENCODED_32_BYTE_LEN * 3); // 327 + (33 + 33 + 33)

    /* PRIVATE INPUTS: */
    signal input startBytes[START_BYTES_LEN];
    signal input sender[TOPIC_LEN];
    signal input receiver[TOPIC_LEN];
    signal input amount[TOPIC_LEN];

    /* OUTPUT: */
    signal output out[TOTAL_OUTPUT_LEN];

    var outIdx = 0;

    // Copy startBytes (327 bytes)
    for (var i = 0; i < START_BYTES_LEN; i++) {
        out[outIdx] <== startBytes[i];
        outIdx++;
    }

    out[outIdx] <== 160; // 0xa0 = 160 = 128 + 32 (RLP prefix for 32-byte string) prefix for sender
    outIdx++;

    for (var i = 0; i < TOPIC_LEN; i++) {
        out[outIdx] <== sender[i];
        outIdx++;
    }

    out[outIdx] <== 160; // 0xa0 = 160 = 128 + 32 (RLP prefix for 32-byte string) prefix for receiver
    outIdx++;

    for (var i = 0; i < TOPIC_LEN; i++) {
        out[outIdx] <== receiver[i];
        outIdx++;
    }

    out[outIdx] <== 160; // 0xa0 = 160 = 128 + 32 (RLP prefix for 32-byte string) prefix for amount
    outIdx++;

    for (var i = 0; i < TOPIC_LEN; i++) {
        out[outIdx] <== amount[i];
        outIdx++;
    }
}
