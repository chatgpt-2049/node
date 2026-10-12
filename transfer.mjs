// transfer.mjs - Ethereum Transfer Script using ethers.js v6
// Transfers ETH and ERC-20 tokens (USDT) from ADDRESS to ADDRESS_RECEIVE

import { Wallet, Contract, JsonRpcProvider, parseEther, formatEther } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// ==============================================
// 1. ERC-20 Token ABI (USDT, USDC, etc)
// ==============================================
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) public returns (bool)',
  'function balanceOf(address account) public view returns (uint256)',
  'function decimals() public view returns (uint8)',
  'function symbol() public view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// ==============================================
// 2. Configuration from .env
// ==============================================
const config = {
  rpcUrl: process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com',
  chainId: parseInt(process.env.CHAIN_ID) || 1,
  address: process.env.ADDRESS,
  addressReceive: process.env.ADDRESS_RECEIVE,
  amountEth: process.env.AMOUNT_ETH || '0',
  amountUsdt: process.env.AMOUNT_USDT || '0',
  gasFee: parseFloat(process.env.GAS_FEE) || 0.0001,
  gasLimit: parseInt(process.env.GAS_LIMIT) || 76223,
  usdcContractAddress: process.env.USDC_CONTRACT_ADDRESS,
  privateKey: process.env.PRIVATE_KEY,
};

// ==============================================
// 3. Validate Configuration
// ==============================================
function validateConfig() {
  const errors = [];

  if (!config.address || config.address === '0x') {
    errors.push('❌ ADDRESS not set in .env');
  }
  if (!config.addressReceive || config.addressReceive === '0x') {
    errors.push('❌ ADDRESS_RECEIVE not set in .env');
  }
  if (!config.privateKey) {
    errors.push('❌ PRIVATE_KEY not set in .env');
  }
  if (!config.usdcContractAddress) {
    errors.push('❌ USDC_CONTRACT_ADDRESS not set in .env');
  }

  if (errors.length > 0) {
    errors.forEach(err => console.error(err));
    process.exit(1);
  }

  console.log('✅ Configuration validated\n');
}

// ==============================================
// 4. Transfer ETH
// ==============================================
async function transferEth(provider, signer) {
  if (config.amountEth === '0' || !config.amountEth) {
    console.log('⏭️  Skipping ETH transfer (AMOUNT_ETH = 0)\n');
    return null;
  }

  try {
    console.log('🚀 Transferring ETH...');
    console.log(`   From: ${config.address}`);
    console.log(`   To: ${config.addressReceive}`);
    console.log(`   Amount: ${config.amountEth} wei`);

    const tx = await signer.sendTransaction({
      to: config.addressReceive,
      value: config.amountEth,
      gasLimit: config.gasLimit,
      gasPrice: parseEther(config.gasFee.toString()),
    });

    console.log(`   📝 Transaction Hash: ${tx.hash}`);
    console.log(`   ⏳ Waiting for confirmation...\n`);

    const receipt = await tx.wait();
    console.log(`   ✅ ETH Transfer Confirmed!`);
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}\n`);

    return receipt;
  } catch (error) {
    console.error(`   ❌ ETH Transfer Failed: ${error.message}\n`);
    throw error;
  }
}

// ==============================================
// 5. Transfer ERC-20 Token (USDT)
// ==============================================
async function transferToken(provider, signer) {
  if (config.amountUsdt === '0' || !config.amountUsdt) {
    console.log('⏭️  Skipping USDT transfer (AMOUNT_USDT = 0)\n');
    return null;
  }

  try {
    console.log('🚀 Transferring USDT Token...');
    console.log(`   From: ${config.address}`);
    console.log(`   To: ${config.addressReceive}`);
    console.log(`   Amount: ${config.amountUsdt} base units`);

    const tokenContract = new Contract(
      config.usdcContractAddress,
      ERC20_ABI,
      signer
    );

    // Get token info
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    const balance = await tokenContract.balanceOf(config.address);

    console.log(`   Token: ${symbol} (${decimals} decimals)`);
    console.log(`   Balance: ${formatEther(balance, decimals)}\n`);

    // Send token
    const tx = await tokenContract.transfer(
      config.addressReceive,
      config.amountUsdt,
      { gasLimit: config.gasLimit }
    );

    console.log(`   📝 Transaction Hash: ${tx.hash}`);
    console.log(`   ⏳ Waiting for confirmation...\n`);

    const receipt = await tx.wait();
    console.log(`   ✅ USDT Transfer Confirmed!`);
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}\n`);

    return receipt;
  } catch (error) {
    console.error(`   ❌ USDT Transfer Failed: ${error.message}\n`);
    throw error;
  }
}

// ==============================================
// 6. Get Account Balance
// ==============================================
async function getBalance(provider) {
  try {
    const ethBalance = await provider.getBalance(config.address);
    console.log('💳 Account Balance:');
    console.log(`   ETH: ${formatEther(ethBalance)}`);

    const tokenContract = new Contract(
      config.usdcContractAddress,
      ERC20_ABI,
      provider
    );

    const tokenBalance = await tokenContract.balanceOf(config.address);
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();

    console.log(`   ${symbol}: ${formatEther(tokenBalance, decimals)}\n`);
  } catch (error) {
    console.error(`❌ Error getting balance: ${error.message}\n`);
  }
}

// ==============================================
// 7. Main Transfer Function
// ==============================================
async function main() {
  try {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔄 Ethereum Transfer Script - ethers.js v6');
    console.log('═══════════════════════════════════════════════════════\n');

    // Validate configuration
    validateConfig();

    // Initialize provider and signer
    const provider = new JsonRpcProvider(config.rpcUrl);
    const signer = new Wallet(config.privateKey, provider);

    console.log('📋 Configuration:');
    console.log(`   RPC URL: ${config.rpcUrl}`);
    console.log(`   Chain ID: ${config.chainId}`);
    console.log(`   From: ${config.address}`);
    console.log(`   To: ${config.addressReceive}`);
    console.log(`   ETH Amount: ${config.amountEth} wei`);
    console.log(`   USDT Amount: ${config.amountUsdt} base units`);
    console.log(`   Gas Limit: ${config.gasLimit}\n`);

    // Get balance before transfer
    console.log('📊 Checking Balances...\n');
    await getBalance(provider);

    // Transfer ETH
    const ethReceipt = await transferEth(provider, signer);

    // Transfer Token
    const tokenReceipt = await transferToken(provider, signer);

    // Final balance check
    console.log('📊 Final Balances...\n');
    await getBalance(provider);

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ All Transfers Completed Successfully!');
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('═══════════════════════════════════════════════════════');
    console.error(`❌ Error: ${error.message}`);
    console.error('═══════════════════════════════════════════════════════\n');
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { transferEth, transferToken, getBalance };
