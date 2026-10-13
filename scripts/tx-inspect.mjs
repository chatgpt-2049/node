#!/usr/bin/env node
// scripts/tx-inspect.mjs
// Inspect a raw Bitcoin transaction hex and optionally fetch input amounts to compute fee.

import fs from 'fs'
import * as bitcoin from 'bitcoinjs-lib'

const NETWORKS = { mainnet: bitcoin.networks.bitcoin, testnet: bitcoin.networks.testnet }

export function cleanHex(input) {
  if (input === undefined || input === null) throw new TypeError('No input provided')
  if (typeof input !== 'string') input = String(input)
  let s = input.replace(/\s+/g, '')
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2)
  if (!/^[0-9a-fA-F]*$/.test(s)) throw new Error('Invalid hex: contains non-hex characters')
  if (s.length === 0) throw new Error('Empty hex string')
  if (s.length % 2 !== 0) throw new Error('Invalid hex length: must be even number of characters')
  return s.toLowerCase()
}

export function decodeTx(hex) {
  const tx = bitcoin.Transaction.fromHex(hex)
  const txid = tx.getId()
  const vin = tx.ins.map((i, idx) => ({
    index: idx,
    txid: Buffer.from(i.hash).reverse().toString('hex'),
    vout: i.index
  }))
  const vout = tx.outs.map((o, idx) => {
    let addr = null
    try { addr = bitcoin.address.fromOutputScript(o.script, NETWORKS.mainnet) } catch (e) {
      try { addr = bitcoin.address.fromOutputScript(o.script, NETWORKS.testnet) } catch (e2) { addr = null }
    }
    return { index: idx, valueSats: o.value, address: addr, scriptHex: o.script.toString('hex') }
  })
  const totalOut = vout.reduce((s, o) => s + o.valueSats, 0)
  return { txid, vin, vout, totalOut }
}

async function fetchPrevOutputValue(txid, voutIndex, network = 'mainnet') {
  const base = network === 'testnet' ? 'https://blockstream.info/testnet/api' : 'https://blockstream.info/api'
  const url = `${base}/tx/${txid}/hex`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch prev tx ${txid}: ${res.status} ${res.statusText}`)
  const hex = await res.text()
  const tx = bitcoin.Transaction.fromHex(hex)
  if (voutIndex < 0 || voutIndex >= tx.outs.length) throw new Error(`vout index ${voutIndex} out of range for tx ${txid}`)
  return tx.outs[voutIndex].value
}

async function inspectCli() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(`Usage: node scripts/tx-inspect.mjs <rawtxhex> [--network mainnet|testnet] [--fetch-inputs]

Examples:
  echo "<hex>" | node scripts/tx-inspect.mjs --fetch-inputs --network testnet
  node scripts/tx-inspect.mjs "<hex>" --network mainnet

Options:
  --network	Choose mainnet or testnet (default: mainnet)
  --fetch-inputs	Query Blockstream API for previous outputs to compute fee
`)
    process.exit(0)
  }

  // parse flags
  let network = 'mainnet'
  let fetchInputs = false
  const rawArgs = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--network' && argv[i+1]) { network = argv[i+1]; i++ }
    else if (a === '--fetch-inputs') fetchInputs = true
    else rawArgs.push(a)
  }

  let raw = ''
  if (!process.stdin.isTTY) {
    raw = fs.readFileSync(0, 'utf8')
  } else {
    raw = rawArgs.join(' ')
  }

  try {
    const hex = cleanHex(raw)
    const decoded = decodeTx(hex)
    let result = { network, txid: decoded.txid, totalOutSats: decoded.totalOut, outputs: decoded.vout, inputs: decoded.vin }

    if (fetchInputs) {
      // fetch each input's value and compute totals
      const values = await Promise.all(decoded.vin.map(async vin => {
        try {
          const v = await fetchPrevOutputValue(vin.txid, vin.vout, network)
          return { txid: vin.txid, vout: vin.vout, valueSats: v }
        } catch (e) {
          return { txid: vin.txid, vout: vin.vout, error: e.message }
        }
      }))
      const successful = values.filter(v => v.valueSats !== undefined && v.valueSats !== null && !v.error)
      const totalIn = successful.reduce((s, v) => s + (v.valueSats || 0), 0)
      result.inputValues = values
      result.totalInSats = totalIn
      if (typeof totalIn === 'number') result.feeSats = totalIn - decoded.totalOut
    }

    // Print both human readable and JSON
    console.log('txid:', result.txid)
    console.log('network:', result.network)
    console.log('totalOutSats:', result.totalOutSats)
    if (result.totalInSats !== undefined) console.log('totalInSats:', result.totalInSats, 'feeSats:', result.feeSats)
    console.log('outputs:')
    result.outputs.forEach(o => console.log(`  [${o.index}] ${o.valueSats} sats -> ${o.address || '<non standard script>'}`))
    console.log('inputs:')
    result.inputs.forEach(i => console.log(`  [${i.index}] ${i.txid}:${i.vout}`))
    if (fetchInputs) {
      console.log('\ninputValues:')
      result.inputValues.forEach(v => console.log(`  ${v.txid}:${v.vout} -> ${v.valueSats ?? v.error}`))
    }

    // JSON on stdout as well for programmatic use
    console.log('\nJSON:')
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(2)
  }
}

if (process.argv[1] && (process.argv[1].endsWith('tx-inspect.mjs') || process.argv[1].endsWith('/tx-inspect.mjs'))) {
  await inspectCli()
}
