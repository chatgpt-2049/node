#!/usr/bin/env bash
set -euo pipefail

# Config
REPO="chatgpt-2049/node"
REMOTE_URL="https://github.com/${REPO}.git"
BRANCH="${1:-chatgpt-2049-patch-1}"   # optional first arg to override branch
WORKDIR="$(pwd)/node-repo-temp"
GH_REPO_ARG="-R ${REPO}"

echo "Repo: $REPO"
echo "Branch: $BRANCH"
echo

# Prereqs
command -v git >/dev/null 2>&1 || { echo "git not installed"; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "gh (GitHub CLI) not installed"; exit 1; }

if ! gh auth status >/dev/null 2>&1; then
  echo "You are not logged in with gh. Run: gh auth login"
  exit 1
fi

# Clone or reuse
if [ -d "$WORKDIR" ]; then
  echo "Using existing workdir: $WORKDIR"
else
  echo "Cloning $REMOTE_URL to $WORKDIR..."
  git clone "$REMOTE_URL" "$WORKDIR"
fi
cd "$WORKDIR"

# Create branch
git fetch origin
if git rev-parse --verify --quiet "$BRANCH" >/dev/null; then
  echo "Branch $BRANCH exists. Checking out."
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH"
fi

# Create files if missing (package.json / script / workflow)
mkdir -p scripts .github/workflows

cat > package.json <<'JSON'
{
  "name": "bitcoin-actions-tools",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "auto": "node scripts/auto-decode-sign-broadcast.js"
  },
  "dependencies": {
    "bitcoinjs-lib": "^6.1.7",
    "ecpair": "^2.0.0",
    "tiny-secp256k1": "^1.1.0",
    "node-fetch": "^2.6.7"
  }
}
JSON

# write full script
cat > scripts/auto-decode-sign-broadcast.js <<'JS'
#!/usr/bin/env node
/**
 * auto-decode-sign-broadcast.js
 * Full script (decoding, fetching UTXOs, building PSBT, signing, optional broadcast).
 */
const fs = require('fs');
const path = require('path');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const ECPairFactory = require('ecpair').ECPairFactory;
const ECPair = ECPairFactory(ecc);

// Use global fetch if available (Node 18+), otherwise node-fetch
let fetchFn;
if (typeof fetch === 'function') fetchFn = fetch;
else fetchFn = require('node-fetch');

const HEX = (process.env.HEX || '').trim();
const RECEIVE_ADDRESS = (process.env.RECEIVE_ADDRESS || '').trim();
const CHAING_ADDRESS = (process.env.CHAING_ADDRESS || '').trim();
const WIF = (process.env.PRIVATE_KEY || process.env.WIF || '').trim();
const ADDRESS = (process.env.ADDRESS || '').trim();
const NETWORK = (process.env.NETWORK || 'mainnet').toLowerCase();
const AMOUNT_SATS = process.env.AMOUNT_SATS ? BigInt(process.env.AMOUNT_SATS) : 100000000n;
const FEE_RATE_OVERRIDE = process.env.FEE_RATE_SAT_PER_VBYTE ? Number(process.env.FEE_RATE_SAT_PER_VBYTE) : null;
const BROADCAST = (process.env.BROADCAST || 'false').toLowerCase() === 'true';

if (!HEX || !RECEIVE_ADDRESS || !CHAING_ADDRESS || !WIF) {
  console.error('Missing required env var. Required: HEX, RECEIVE_ADDRESS, CHAING_ADDRESS, PRIVATE_KEY (WIF)');
  process.exit(2);
}

const network = NETWORK === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
const BLOCKSTREAM = NETWORK === 'mainnet' ? 'https://blockstream.info/api' : 'https://blockstream.info/testnet/api';
const MEMPOOL = NETWORK === 'mainnet' ? 'https://mempool.space' : 'https://mempool.space/testnet';

async function fetchJson(url) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} ${url}`);
  return r.json();
}
async function fetchText(url, opts) {
  const r = await fetchFn(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} ${url}`);
  return r.text();
}

function estimateVBytes(numInputs, numOutputs) {
  return Math.ceil(numInputs * 68 + numOutputs * 31 + 10);
}

function saveOut(filename, content) {
  const outdir = path.resolve(process.cwd(), 'out');
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, filename), content, 'utf8');
}

(async () => {
  const result = { startedAt: new Date().toISOString(), network: NETWORK };
  try {
    console.log('Network:', NETWORK);
    const tx = bitcoin.Transaction.fromHex(HEX);
    const inputs = tx.ins.map((i, idx) => ({
      index: idx,
      txid: Buffer.from(i.hash).reverse().toString('hex'),
      vout: i.index
    }));
    result.decoded = { txid: tx.getId(), inputs: inputs.slice(), outputs: tx.outs.map(o => ({ value: o.value, scriptHex: o.script.toString('hex') })) };
    console.log('Decoded TXID:', result.decoded.txid);
    console.log('Inputs:', inputs.map(i => `${i.txid}:${i.vout}`).join(', '));

    // Fetch previous outputs (value & script)
    let totalInputSats = 0n;
    const prevTxHex = {};
    const prevOutputs = [];
    for (const inpt of inputs) {
      console.log('Fetching prev tx:', inpt.txid);
      const info = await fetchJson(`${BLOCKSTREAM}/tx/${inpt.txid}`);
      if (!info || !Array.isArray(info.vout)) throw new Error(`No vout data for ${inpt.txid}`);
      const outObj = info.vout[inpt.vout];
      if (!outObj) throw new Error(`Referenced vout ${inpt.vout} not found in ${inpt.txid}`);
      const value = BigInt(outObj.value);
      totalInputSats += value;
      prevOutputs.push({ txid: inpt.txid, vout: inpt.vout, value, scriptpubkey: outObj.scriptpubkey });
      prevTxHex[inpt.txid] = await fetchText(`${BLOCKSTREAM}/tx/${inpt.txid}/hex`);

      let derivedAddress = null;
      try {
        const script = Buffer.from(outObj.scriptpubkey, 'hex');
        derivedAddress = bitcoin.address.fromOutputScript(script, network);
      } catch (e) {
        derivedAddress = null;
      }
      inpt.derivedAddress = derivedAddress;
      if (derivedAddress) console.log(` - prev ${inpt.txid}:${inpt.vout} -> ${derivedAddress} (${value} sats)`);
      else console.log(` - prev ${inpt.txid}:${inpt.vout} -> script ${outObj.scriptpubkey} (${value} sats)`);
    }
    console.log('Total input sats:', totalInputSats.toString());
    result.totalInputSats = totalInputSats.toString();

    // Optional safety check with ADDRESS
    if (ADDRESS) {
      console.log('Checking provided ADDRESS against decoded prev-output addresses...');
      const mismatches = inputs.filter(i => i.derivedAddress && i.derivedAddress !== ADDRESS);
      if (mismatches.length > 0) {
        throw new Error(`ADDRESS mismatch for some inputs. Example mismatch: ${mismatches[0].txid}:${mismatches[0].vout} derived=${mismatches[0].derivedAddress}`);
      } else {
        console.log('All decoded prev-output addresses match provided ADDRESS (or were undecodable).');
        result.addressCheck = 'ok';
      }
    }

    let feeRate = FEE_RATE_OVERRIDE;
    if (!feeRate) {
      const fees = await fetchJson(`${MEMPOOL}/api/v1/fees/recommended`);
      feeRate = fees.fastestFee || fees.fastest || 50;
    }
    console.log('Fee rate (sat/vByte):', feeRate);
    result.feeRateSatPerVbyte = feeRate;

    const sendAmount = AMOUNT_SATS;
    if (totalInputSats < sendAmount) throw new Error(`Insufficient funds: ${totalInputSats} < ${sendAmount}`);

    const psbt = new bitcoin.Psbt({ network });
    for (const po of prevOutputs) {
      psbt.addInput({ hash: po.txid, index: po.vout, nonWitnessUtxo: Buffer.from(prevTxHex[po.txid], 'hex') });
    }

    const numOutputsIfChange = 2;
    const estimatedVbytes = estimateVBytes(prevOutputs.length, numOutputsIfChange);
    let estimatedFee = BigInt(Math.ceil(feeRate * estimatedVbytes));
    let change = totalInputSats - sendAmount - estimatedFee;
    const dust = 546n;
    if (change <= 0n) throw new Error(`Not enough funds after fee: change=${change}`);
    if (change < dust) {
      console.log('Change below dust threshold; adding to fee');
      estimatedFee = estimatedFee + change;
      change = 0n;
    }

    psbt.addOutput({ address: RECEIVE_ADDRESS, value: Number(sendAmount) });
    if (change > 0n) psbt.addOutput({ address: CHAING_ADDRESS, value: Number(change) });

    const unsignedBase64 = psbt.toBase64();
    saveOut('unsigned_psbt.base64', unsignedBase64);
    console.log('Saved out/unsigned_psbt.base64');

    const keyPair = ECPair.fromWIF(WIF, network);
    for (let i = 0; i < prevOutputs.length; i++) {
      try {
        psbt.signInput(i, keyPair);
        try { psbt.validateSignaturesOfInput(i); console.log(`Signature OK for input ${i}`); } catch (vErr) { console.warn(`Signature validation warning input ${i}: ${vErr.message}`); }
      } catch (sErr) {
        throw new Error(`Failed to sign input ${i}: ${sErr.message}`);
      }
    }

    try { psbt.finalizeAllInputs(); } catch (fErr) { throw new Error(`Finalize failed: ${fErr.message}`); }
    const signedTx = psbt.extractTransaction();
    const signedHex = signedTx.toHex();
    const txid = signedTx.getId();

    saveOut('signed_rawtx.hex', signedHex);
    console.log('Signed TXID:', txid);
    console.log('Saved out/signed_rawtx.hex');

    result.txid = txid;
    result.signedHex = signedHex;
    result.sendAmountSats = sendAmount.toString();
    result.feeSats = estimatedFee.toString();
    result.changeSats = change.toString();
    result.estimatedVbytes = estimatedVbytes;
    result.inputs = inputs;
    result.outputs = signedTx.outs.map(o => {
      let addr = null;
      try { addr = bitcoin.address.fromOutputScript(o.script, network); } catch (e) { addr = null; }
      return { value: o.value, scriptHex: o.script.toString('hex'), address: addr };
    });

    if (BROADCAST) {
      console.log('Broadcasting to mempool.space...');
      const r = await fetchFn(`${MEMPOOL}/api/tx`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: signedHex });
      if (!r.ok) {
        const txt = await r.text();
        result.broadcast = { ok: false, status: r.status, statusText: r.statusText, body: txt };
        console.error('Broadcast failed:', result.broadcast);
      } else {
        const btxid = await r.text();
        result.broadcast = { ok: true, txid: btxid };
        console.log('Broadcasted txid:', btxid);
      }
    } else {
      result.broadcast = { ok: false, reason: 'BROADCAST=false' };
      console.log('BROADCAST=false: not broadcasting');
    }

    saveOut('result.json', JSON.stringify(result, null, 2));
    console.log('Saved out/result.json');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    const e = { error: err.message || String(err), stack: err.stack || null };
    saveOut('error.json', JSON.stringify(e, null, 2));
    console.error('Error:', JSON.stringify(e));
    process.exit(1);
  }
})();
JS

chmod +x scripts/auto-decode-sign-broadcast.js

cat > .github/workflows/auto-tx.yml <<'YML'
name: Auto decode/sign/broadcast TX

on:
  workflow_dispatch:

jobs:
  auto-tx:
    runs-on: ubuntu-latest

    env:
      ADDRESS: ${{ vars.ADDRESS }}
      HEX: ${{ vars.HEX }}
      RECEIVE_ADDRESS: ${{ vars.RECEIVE_ADDRESS }}
      CHAING_ADDRESS: ${{ vars.CHAING_ADDRESS }}
      NETWORK: ${{ vars.NETWORK || 'mainnet' }}
      AMOUNT_SATS: ${{ vars.AMOUNT_SATS || '100000000' }}
      FEE_RATE_SAT_PER_VBYTE: ${{ vars.FEE_RATE_SAT_PER_VBYTE || '' }}
      BROADCAST: ${{ vars.BROADCAST || 'false' }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Run auto decode/sign/broadcast
        env:
          PRIVATE_KEY: ${{ secrets.PRIVATE_KEY }}
        run: |
          node scripts/auto-decode-sign-broadcast.js
          ls -lah out || true

      - name: Upload out/ as artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: tx-out
          path: out/
YML

# Commit & push
git add package.json scripts/auto-decode-sign-broadcast.js .github/workflows/auto-tx.yml
git commit -m "Add auto-decode-sign-broadcast script, package.json and workflow" || echo "Nothing to commit"
git push -u origin "$BRANCH"

echo
echo "Now we'll prompt to auto-fill repository variables and set secret PRIVATE_KEY."
echo "Leave blank to set empty value."

read -p "HEX (raw tx hex) [press Enter to leave blank]: " INPUT_HEX
read -p "RECEIVE_ADDRESS (destination) []: " INPUT_RECEIVE
read -p "CHAING_ADDRESS (change) []: " INPUT_CHANGE
read -p "ADDRESS (optional safety check) []: " INPUT_ADDRESS
read -p "NETWORK (mainnet/testnet) [mainnet]: " INPUT_NETWORK
INPUT_NETWORK=${INPUT_NETWORK:-mainnet}
read -p "AMOUNT_SATS [100000000]: " INPUT_AMOUNT
INPUT_AMOUNT=${INPUT_AMOUNT:-100000000}
read -p "FEE_RATE_SAT_PER_VBYTE (leave empty to use mempool fast): " INPUT_FEERATE
read -p "BROADCAST (true/false) [false]: " INPUT_BROADCAST
INPUT_BROADCAST=${INPUT_BROADCAST:-false}

create_or_update_var() {
  local name="$1"
  local value="$2"
  echo "Setting variable $name..."
  if gh api --method POST /repos/"${REPO}"/actions/variables -f name="$name" -f value="$value" >/dev/null 2>&1; then
    echo "Created variable $name."
  else
    if gh api --method PATCH /repos/"${REPO}"/actions/variables/"$name" -f value="$value" >/dev/null 2>&1; then
      echo "Updated variable $name."
    else
      echo "Failed to create/update variable $name (check permissions)."
    fi
  fi
}

create_or_update_var "HEX" "$INPUT_HEX"
create_or_update_var "RECEIVE_ADDRESS" "$INPUT_RECEIVE"
create_or_update_var "CHAING_ADDRESS" "$INPUT_CHANGE"
create_or_update_var "ADDRESS" "$INPUT_ADDRESS"
create_or_update_var "NETWORK" "$INPUT_NETWORK"
create_or_update_var "AMOUNT_SATS" "$INPUT_AMOUNT"
create_or_update_var "FEE_RATE_SAT_PER_VBYTE" "$INPUT_FEERATE"
create_or_update_var "BROADCAST" "$INPUT_BROADCAST"

echo
echo "Now set PRIVATE_KEY secret for repo ${REPO} (WIF). It will NOT be echoed."
read -s -p "Paste PRIVATE_KEY (WIF) and press Enter: " WIF_INPUT
echo
TMPFILE="$(mktemp)"
trap 'shred -u "$TMPFILE" 2>/dev/null || rm -f "$TMPFILE"' EXIT
printf "%s" "$WIF_INPUT" > "$TMPFILE"
gh secret set PRIVATE_KEY -R "${REPO}" < "$TMPFILE"
echo "PRIVATE_KEY secret set."

read -p "Run workflow now on branch ${BRANCH}? (y/N) " run_now
if [[ "${run_now}" =~ ^[Yy]$ ]]; then
  echo "Dispatching workflow auto-tx.yml on ref $BRANCH..."
  gh workflow run auto-tx.yml -R "${REPO}" --ref "${BRANCH}"
  echo "Workflow dispatched. Use 'gh run list -R ${REPO}' to monitor."
else
  echo "Skipping workflow dispatch."
fi

echo
echo "Done. Verify repository variables via Settings -> Secrets and variables -> Actions."
