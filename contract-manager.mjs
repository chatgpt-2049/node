// contract-manager.mjs - Ethereum Contract Manager
// Load contract ABI, listen to events, and send transactions

import { Wallet, Contract, JsonRpcProvider, parseUnits, formatUnits } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// ==============================================
// 1. ERC-20 Token ABI
// ==============================================
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) public returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) public returns (bool)',
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function allowance(address owner, address spender) public view returns (uint256)',
  'function balanceOf(address account) public view returns (uint256)',
  'function decimals() public view returns (uint8)',
  'function symbol() public view returns (string)',
  'function name() public view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

// ==============================================
// 2. Safe helper functions
// ==============================================
function toDisplayAmount(value, decimals = 18) {
  if (value === undefined || value === null) return '0';
  try {
    return formatUnits(value, decimals);
  } catch {
    return String(value);
  }
}

function normalizeDecimalInput(rawValue, decimals = 18, label = 'amount') {
  const value = String(rawValue ?? '0').trim();

  if (!value || value === '0') return 0n;

  // If user supplied decimal-form value, convert to base units.
  // If user supplied raw integer units, keep it as-is.
  const useHumanReadable = process.env[`${label.toUpperCase()}_MODE`] === 'human' || value.includes('.') || value.includes(',');

  if (useHumanReadable) {
    const normalized = value.replace(',', '.');
    return parseUnits(normalized, decimals);
  }

  return BigInt(value);
}

function showPreview(kind, payload) {
  console.log(`\n🔎 DRY RUN PREVIEW - ${kind}`);
  console.log(JSON.stringify(payload, null, 2));
  console.log('');
}

async function showBalances(provider, contract, address) {
  const ethBal = await provider.getBalance(address);
  console.log('ETH:', formatUnits(ethBal, 18));

  try {
    const decimals = await contract.decimals();
    const tokenBal = await contract.balanceOf(address);
    console.log(`${await contract.symbol()}:`, formatUnits(tokenBal, decimals));
  } catch {
    console.log('Token balance: (not available)');
  }

  console.log('');
}

// ==============================================
// 3. Load or Create Contract ABI from file
// ==============================================
function loadContractAbi(abiPath = 'contract-abi.json') {
  try {
    if (fs.existsSync(abiPath)) {
      const abiData = fs.readFileSync(abiPath, 'utf-8');
      return JSON.parse(abiData);
    }
    console.log(`ℹ️  ABI file not found at ${abiPath}, using default ERC-20 ABI`);
    return ERC20_ABI;
  } catch (error) {
    console.error(`❌ Error loading ABI: ${error.message}`);
    return ERC20_ABI;
  }
}

// ==============================================
// 4. Configuration
// ==============================================
const config = {
  rpcUrl: process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com',
  chainId: parseInt(process.env.CHAIN_ID) || 1,
  contractAddress: process.env.USDC_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS,
  senderAddress: process.env.ADDRESS,
  recipientAddress: process.env.ADDRESS_RECEIVE,
  privateKey: process.env.PRIVATE_KEY,
  amountEth: process.env.AMOUNT_ETH || '0',
  amountUsdt: process.env.AMOUNT_USDT || '0',
  gasLimit: parseInt(process.env.GAS_LIMIT) || 76223,
  gasFee: process.env.GAS_FEE || '0.0001',
  dryRun: process.env.DRY_RUN === '1',
};

// ==============================================
// 5. Initialize Provider and Contract
// ==============================================
async function initializeContract() {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.privateKey, provider);

  const contractAbi = loadContractAbi('./contract-abi.json');
  const contract = new Contract(config.contractAddress, contractAbi, wallet);

  console.log('✅ Contract Initialized');
  console.log(`   Provider: ${config.rpcUrl}`);
  console.log(`   Contract: ${config.contractAddress}`);
  console.log(`   Sender: ${config.senderAddress}\n`);

  return { provider, wallet, contract, contractAbi };
}

// ==============================================
// 6. Listen to Contract Events
// ==============================================
async function listenToEvents(contract) {
  console.log('🔍 Listening to Contract Events...\n');

  contract.on('Transfer', (from, to, value, event) => {
    console.log('📤 Transfer Event Detected:');
    console.log(`   From: ${from}`);
    console.log(`   To: ${to}`);
    console.log(`   Value: ${value.toString()}`);
    console.log(`   TxHash: ${event.log.transactionHash}`);
    console.log(`   Block: ${event.log.blockNumber}\n`);
  });

  contract.on('Approval', (owner, spender, value, event) => {
    console.log('🔓 Approval Event Detected:');
    console.log(`   Owner: ${owner}`);
    console.log(`   Spender: ${spender}`);
    console.log(`   Value: ${value.toString()}`);
    console.log(`   TxHash: ${event.log.transactionHash}\n`);
  });

  contract.on('*', (event) => {
    console.log(`📡 Event: ${event.eventName || 'Unknown'}`);
  });
}

// ==============================================
// 7. Send Token Transfer
// ==============================================
async function sendTokenTransfer(contract, provider) {
  if (!config.amountUsdt || config.amountUsdt === '0') {
    console.log('⏭️  Skipping token transfer (AMOUNT_USDT = 0)\n');
    return null;
  }

  try {
    const decimals = await contract.decimals().catch(() => 6);
    const amountBaseUnits = normalizeDecimalInput(config.amountUsdt, decimals, 'amount_usdt');

    const transferPayload = {
      to: config.recipientAddress,
      amountBaseUnits: amountBaseUnits.toString(),
      decimals,
      humanReadable: config.amountUsdt,
    };

    if (config.dryRun) {
      showPreview('USDT transfer', transferPayload);
      return null;
    }

    console.log('🚀 Sending Token Transfer...');
    console.log(`   From: ${config.senderAddress}`);
    console.log(`   To: ${config.recipientAddress}`);
    console.log(`   Amount: ${config.amountUsdt} (~${toDisplayAmount(amountBaseUnits, decimals)} tokens)\n`);

    const tx = await contract.transfer(config.recipientAddress, amountBaseUnits, { gasLimit: config.gasLimit });

    console.log(`📝 Transaction Hash: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...\n');
    const receipt = await tx.wait();

    console.log('✅ Transfer Confirmed!');
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);
    console.log(`   Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);

    return receipt;
  } catch (error) {
    console.error(`❌ Transfer Failed: ${error.message}\n`);
    throw error;
  }
}

// ==============================================
// 8. Approve spender
// ==============================================
async function approveSpender(contract, spender, amount) {
  try {
    const decimals = await contract.decimals().catch(() => 6);
    const amountBaseUnits = normalizeDecimalInput(amount, decimals, 'approve_amount');

    const preview = {
      spender,
      amountRaw: amountBaseUnits.toString(),
      humanReadable: amount,
      decimals,
    };

    if (config.dryRun) {
      showPreview('Approve', preview);
      return null;
    }

    console.log(`🔓 Approving spender ${spender} for amount ${amount}...`);
    const tx = await contract.approve(spender, amountBaseUnits, { gasLimit: config.gasLimit });
    console.log(`📝 Approve TxHash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Approve Confirmed - Block: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed}\n`);
    return receipt;
  } catch (error) {
    console.error(`❌ Approve Failed: ${error.message}\n`);
    throw error;
  }
}

// ==============================================
// 9. Check allowance
// ==============================================
async function checkAllowance(contract, owner, spender) {
  try {
    const allowance = await contract.allowance(owner, spender);
    console.log(`💰 Allowance of spender ${spender} by owner ${owner}: ${allowance.toString()} base units\n`);
    return allowance;
  } catch (error) {
    console.error(`❌ Allowance check failed: ${error.message}\n`);
    throw error;
  }
}

// ==============================================
// 10. TransferFrom (useful for relayers)
// ==============================================
async function performTransferFrom(contract, from, to, amount) {
  try {
    const decimals = await contract.decimals().catch(() => 6);
    const amountBaseUnits = normalizeDecimalInput(amount, decimals, 'transfer_from_amount');

    const preview = {
      from,
      to,
      amountRaw: amountBaseUnits.toString(),
      humanReadable: amount,
      decimals,
    };

    if (config.dryRun) {
      showPreview('transferFrom', preview);
      return null;
    }

    console.log(`🔁 Performing transferFrom ${from} -> ${to} amount ${amount}...`);
    const tx = await contract.transferFrom(from, to, amountBaseUnits, { gasLimit: config.gasLimit });
    console.log(`📝 transferFrom TxHash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ transferFrom Confirmed - Block: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed}\n`);
    return receipt;
  } catch (error) {
    console.error(`❌ transferFrom failed: ${error.message}\n`);
    throw error;
  }
}

// ==============================================
// 11. ETH transfer helper
// ==============================================
async function sendEthTransfer(signer) {
  if (!config.amountEth || config.amountEth === '0') {
    console.log('⏭️  Skipping ETH transfer (AMOUNT_ETH = 0)\n');
    return null;
  }

  const ethValue = normalizeDecimalInput(config.amountEth, 18, 'amount_eth');
  const preview = {
    from: config.senderAddress,
    to: config.recipientAddress,
    valueWei: ethValue.toString(),
    humanReadableEth: config.amountEth,
    gasLimit: config.gasLimit,
    gasPriceGwei: config.gasFee,
  };

  if (config.dryRun) {
    showPreview('ETH transfer', preview);
    return null;
  }

  try {
    console.log('🚀 Sending ETH Transfer...');
    console.log(`   From: ${config.senderAddress}`);
    console.log(`   To: ${config.recipientAddress}`);
    console.log(`   Amount: ${config.amountEth} ETH\n`);

    const tx = await signer.sendTransaction({
      to: config.recipientAddress,
      value: ethValue,
      gasLimit: config.gasLimit,
      gasPrice: parseUnits(config.gasFee, 'gwei'),
    });

    console.log(`📝 Transaction Hash: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...\n');
    const receipt = await tx.wait();

    console.log('✅ ETH Transfer Confirmed!');
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);
    console.log(`   Status: ${receipt.status === 1 ? 'Success' : 'Failed'}\n`);
    return receipt;
  } catch (error) {
    console.error(`❌ ETH Transfer Failed: ${error.message}\n`);
    throw error;
  }
}

// ==============================================
// 12. Get Contract Information
// ==============================================
async function getContractInfo(contract) {
  try {
    console.log('📋 Contract Information:\n');

    try {
      const name = await contract.name();
      console.log(`   Name: ${name}`);
    } catch {
      console.log('   Name: (not available)');
    }

    try {
      const symbol = await contract.symbol();
      console.log(`   Symbol: ${symbol}`);
    } catch {
      console.log('   Symbol: (not available)');
    }

    try {
      const decimals = await contract.decimals();
      console.log(`   Decimals: ${decimals}`);
    } catch {
      console.log('   Decimals: (not available)');
    }

    try {
      const balance = await contract.balanceOf(config.senderAddress);
      console.log(`   Balance: ${balance.toString()} (raw units)\n`);
    } catch {
      console.log('   Balance: (not available)\n');
    }
  } catch (error) {
    console.error(`❌ Error getting contract info: ${error.message}\n`);
  }
}

// ==============================================
// 13. Query Historical Events
// ==============================================
async function queryHistoricalEvents(contract, provider) {
  try {
    console.log('📜 Querying Historical Events...\n');

    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100);

    const transferFilter = contract.filters.Transfer();
    const events = await contract.queryFilter(transferFilter, fromBlock, currentBlock);

    console.log(`Found ${events.length} transfer events in last 100 blocks:\n`);

    events.slice(0, 10).forEach((event) => {
      const [from, to, value] = event.args;
      console.log(`   ${from.slice(0, 6)}...${from.slice(-4)} → ${to.slice(0, 6)}...${to.slice(-4)}: ${value.toString()}`);
    });

    if (events.length > 10) {
      console.log(`   ... and ${events.length - 10} more\n`);
    }
  } catch (error) {
    console.error(`❌ Error querying events: ${error.message}\n`);
  }
}

// ==============================================
// 14. Save Contract ABI to file
// ==============================================
function saveContractAbi(abi) {
  try {
    fs.writeFileSync('contract-abi.json', JSON.stringify(abi, null, 2));
    console.log('✅ Contract ABI saved to contract-abi.json\n');
  } catch (error) {
    console.error(`❌ Error saving ABI: ${error.message}\n`);
  }
}

// ==============================================
// 15. Main Execution
// ==============================================
async function main() {
  try {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔗 Ethereum Contract Manager - ethers.js v6');
    console.log('═══════════════════════════════════════════════════════\n');

    if (!config.contractAddress || config.contractAddress === '0x') {
      throw new Error('USDC_CONTRACT_ADDRESS not set in .env');
    }
    if (!config.senderAddress || config.senderAddress === '0x') {
      throw new Error('ADDRESS not set in .env');
    }
    if (!config.recipientAddress || config.recipientAddress === '0x') {
      throw new Error('ADDRESS_RECEIVE not set in .env');
    }
    if (!config.privateKey) {
      throw new Error('PRIVATE_KEY not set in .env');
    }

    if (config.dryRun) {
      console.log('⚠️  DRY RUN MODE ENABLED: no transactions will be signed or broadcast.\n');
    }

    const { provider, wallet, contract, contractAbi } = await initializeContract();

    await getContractInfo(contract);
    await queryHistoricalEvents(contract, provider);

    console.log('🎧 Starting Event Listener (background)...\n');
    listenToEvents(contract);

    if (config.amountEth && config.amountEth !== '0') {
      await sendEthTransfer(wallet);
    }

    if (config.amountUsdt && config.amountUsdt !== '0') {
      await sendTokenTransfer(contract, provider);
    }

    if (process.env.CHECK_ALLOWANCE === '1') {
      await checkAllowance(contract, config.senderAddress, config.recipientAddress);
    }

    if (process.env.APPROVE_SPENDER && process.env.APPROVE_AMOUNT) {
      await approveSpender(contract, process.env.APPROVE_SPENDER, process.env.APPROVE_AMOUNT);
    }

    if (process.env.TRANSFER_FROM && process.env.TRANSFER_FROM_AMOUNT) {
      await performTransferFrom(contract, process.env.TRANSFER_FROM, config.recipientAddress, process.env.TRANSFER_FROM_AMOUNT);
    }

    saveContractAbi(contractAbi);

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Contract Manager Ready!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('Press Ctrl+C to stop listening to events\n');

    await new Promise(() => {});
  } catch (error) {
    console.error('═══════════════════════════════════════════════════════');
    console.error(`❌ Error: ${error.message}`);
    console.error('═══════════════════════════════════════════════════════\n');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  initializeContract,
  listenToEvents,
  sendTokenTransfer,
  sendEthTransfer,
  getContractInfo,
  queryHistoricalEvents,
  loadContractAbi,
  approveSpender,
  checkAllowance,
  performTransferFrom,
  normalizeDecimalInput,
  showBalances,
};
