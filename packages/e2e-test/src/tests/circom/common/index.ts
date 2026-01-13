import { Circomkit } from 'circomkit'
import { readFileSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const configurationPath = `${dirname(fileURLToPath(import.meta.url))}/../../../../circomkit.json`
const configuration = JSON.parse(readFileSync(configurationPath, 'utf8'))

export const circomkit = new Circomkit(configuration)
