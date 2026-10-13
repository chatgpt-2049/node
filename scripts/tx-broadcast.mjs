#!/usr/bin/env node
// scripts/tx-broadcast.mjs
// Broadcast a signed raw tx hex to Blockstream API (mainnet or testnet)

import fs from 'fs'
import { cleanHex } from './rawtransactionshex.mjs'

async function broadcast(hex, network='mainnet'){
  const base = network === 'testnet' ? 'https://blockstream.info/testnet/api' : 'https://blockstream.info/api'
  const url = `${base}/tx`
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: hex })
  const text = await res.text()
  if (res.ok) return { ok: true, txid: text.trim() }
  return { ok: false, status: res.status, body: text }
}

async function main(){
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')){
    console.log(`Usage: node scripts/tx-broadcast.mjs <signed_rawtx_hex> [--network mainnet|testnet] [--dry]

Options:
  --network  mainnet or testnet (default: mainnet)
  --dry      Do not actually broadcast, just print the API request
`)
    process.exit(0)
  }

  let network = 'mainnet'
  let dry = false
  const rawArgs = []
  for (let i=0;i<argv.length;i++){
    const a = argv[i]
    if (a === '--network' && argv[i+1]){ network = argv[i+1]; i++ }
    else if (a === '--dry') dry = true
    else rawArgs.push(a)
  }

  let raw = ''
  if (!process.stdin.isTTY) raw = fs.readFileSync(0,'utf8')
  else raw = rawArgs.join(' ')

  try{
    const hex = cleanHex(raw)
    if (dry){
      console.log('Dry run - would POST to Blockstream API')
      console.log('Network:', network)
      console.log('Hex length (bytes):', hex.length/2)
      console.log('Hex (trim):', hex.slice(0,200))
      process.exit(0)
    }

    const res = await broadcast(hex, network)
    if (res.ok){
      console.log('Broadcast OK - txid:', res.txid)
      process.exit(0)
    } else {
      console.error('Broadcast failed:', res.status)
      console.error(res.body)
      process.exit(2)
    }
  } catch (e){
    console.error('Error:', e.message)
    process.exit(2)
  }
}

if (process.argv[1] && (process.argv[1].endsWith('tx-broadcast.mjs') || process.argv[1].endsWith('/tx-broadcast.mjs'))) {
  await main()
}
