#!/usr/bin/env node
// scripts/rawtransactionshex.mjs
// Helper to normalize and validate raw transaction hex strings.
// Exports: cleanHex(input) -> normalized hex (lowercase, no 0x, no whitespace)
// Usage (CLI):
//  - Pipe: echo " <hex> " | node scripts/rawtransactionshex.mjs
//  - Arg:  node scripts/rawtransactionshex.mjs "<hex>"
// Returns normalized hex on stdout. Exits with code 0 on success, 2 on validation error.

export function cleanHex(input) {
  if (input === undefined || input === null) {
    throw new TypeError('No input provided')
  }
  if (typeof input !== 'string') input = String(input)

  // Remove whitespace, newlines and leading 0x
  let s = input.replace(/\s+/g, '')
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2)

  // Basic hex validation
  if (!/^[0-9a-fA-F]*$/.test(s)) {
    throw new Error('Invalid hex: contains non-hex characters')
  }

  if (s.length === 0) {
    throw new Error('Empty hex string')
  }

  if (s.length % 2 !== 0) {
    throw new Error('Invalid hex length: must be even number of characters')
  }

  return s.toLowerCase()
}

export function isValidHex(input) {
  try {
    cleanHex(input)
    return true
  } catch (e) {
    return false
  }
}

// CLI entrypoint
if (process.argv[1] && (process.argv[1].endsWith('rawtransactionshex.mjs') || process.argv[1].endsWith('/rawtransactionshex.mjs'))) {
  const fs = await import('fs')
  let raw = ''
  if (!process.stdin.isTTY) {
    // read from stdin
    raw = fs.readFileSync(0, 'utf8')
  } else {
    // read from args
    raw = process.argv.slice(2).join(' ')
  }

  try {
    const cleaned = cleanHex(raw)
    process.stdout.write(cleaned + '\n')
    process.exit(0)
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(2)
  }
}
