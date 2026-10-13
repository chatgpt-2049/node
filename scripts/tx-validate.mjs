#!/usr/bin/env node
// scripts/tx-validate.mjs
// Validate outputs (addresses and script types) and optionally check fee vs inputs

import fs from 'fs'
import * as bitcoin from 'bitcoinjs-lib'
import { cleanHex, decodeTx } from './tx-inspect.mjs'

const NETWORKS = { mainnet: bitcoin.networks.bitcoin, testnet: bitcoin.networks.testnet }

function validateOutputAddress(output, network) {
  // Attempt to decode the output script to an address
  try {
    const addr = bitcoin.address.fromOutputScript(Buffer.from(output.scriptHex, 'hex'), NETWORKS[network])
    return { ok: true, address: addr }
  } catch (e) {
    return { ok: false, error: 'non standard or unknown script' }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage: node scripts/tx-validate.mjs <rawtxhex> [--network mainnet|testnet] [--fetch-inputs]

Options:
  --network	mainnet or testnet (default: mainnet)
  --fetch-inputs	fetch previous outputs to compute totalIn / fee (uses Blockstream API)
`)
    process.exit(0)
  }

  let network = 'mainnet'
  let fetchInputs = false
  const rawArgs = []
  for (let i=0;i<argv.length;i++){
    const a = argv[i]
    if (a === '--network' && argv[i+1]) { network = argv[i+1]; i++ }
    else if (a === '--fetch-inputs') fetchInputs = true
    else rawArgs.push(a)
  }

  let raw = ''
  if (!process.stdin.isTTY) raw = fs.readFileSync(0,'utf8')
  else raw = rawArgs.join(' ')

  try {
    const hex = cleanHex(raw)
    const decoded = decodeTx(hex)

    const outputsValidation = decoded.vout.map(o => ({ index: o.index, valueSats: o.valueSats, address: o.address, scriptHex: o.scriptHex, validation: validateOutputAddress(o, network) }))

    const result = { txid: decoded.txid, network, outputsValidation }

    if (fetchInputs) {
      // reuse tx-inspect fetch logic
      const { fetchPrevOutputValue } = await import('./tx-inspect.mjs')
      const values = await Promise.all(decoded.vin.map(async vin => {
        try {
          const v = await fetchPrevOutputValue(vin.txid, vin.vout, network)
          return { txid: vin.txid, vout: vin.vout, valueSats: v }
        } catch (e) {
          return { txid: vin.txid, vout: vin.vout, error: e.message }
        }
      }))
      const successful = values.filter(v => v.valueSats !== undefined && !v.error)
      const totalIn = successful.reduce((s,v)=>s+(v.valueSats||0),0)
      result.inputValues = values
      result.totalInSats = totalIn
      result.totalOutSats = decoded.totalOut
      result.feeSats = (typeof totalIn === 'number') ? (totalIn - decoded.totalOut) : null
      // approximate fee per byte
      const txBytes = hex.length/2
      result.txBytes = txBytes
      result.feePerByte = result.feeSats !== null ? (result.feeSats / txBytes) : null
    }

    console.log(JSON.stringify(result,null,2))
    process.exit(0)
  } catch (e) {
    console.error('Error:', e.message)
    process.exit(2)
  }
}

if (process.argv[1] && (process.argv[1].endsWith('tx-validate.mjs') || process.argv[1].endsWith('/tx-validate.mjs'))) {
  await main()
}
