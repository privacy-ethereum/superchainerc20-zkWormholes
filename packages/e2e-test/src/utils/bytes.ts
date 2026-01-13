export const textToBytes = (text: string): number[] => {
  return Buffer.from(text).toJSON().data
}
