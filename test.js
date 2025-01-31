// Import the SDK
import apiNow from './src/index';
import { ethers } from 'ethers';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// Replace these with your values
const ENDPOINT = 'https://apinow.fun/api/endpoints/placeholder/posts';

// Individual function examples:

// 1. Get endpoint info
// const info = await apiNow.info(ENDPOINT);
// console.log(info);

// // 2. ETH native transfer
// const ethTxHash = await apiNow.buy(
//   process.env.ETH_RECIPIENT,
//   ethers.parseEther('0.000001'),
//   process.env.ETH_PRIVATE_KEY,
//   process.env.ETH_RPC_URL,
//   'eth'
// );
// console.log(ethTxHash);

// // 3. BASED base token transfer
// const tokenTxHash = await apiNow.buy(
//   process.env.ETH_RECIPIENT,
//   ethers.parseUnits('10', 18), // Use appropriate decimals
//   process.env.ETH_PRIVATE_KEY,
//   process.env.ETH_RPC_URL,
//   'eth',
//   process.env.ETH_TOKEN_ADDRESS
// );
// console.log(tokenTxHash);

// // 4. SOL transfer
// const solTxHash = await apiNow.buy(
//   process.env.SOL_RECIPIENT,
//   BigInt(LAMPORTS_PER_SOL)  * BigInt(1) / BigInt(10000),
//   process.env.SOL_PRIVATE_KEY,
//   process.env.SOL_RPC_URL,
//   'sol'
// );
// console.log(solTxHash);

// // 5. SOL token transfer fast mode
// const solTxHash = await apiNow.buy(
//   process.env.SOL_RECIPIENT,
//   BigInt(10000), // Amount of tokens to send
//   process.env.SOL_PRIVATE_KEY,
//   process.env.SOL_RPC_URL,
//   'sol',
//   process.env.SOL_TOKEN_ADDRESS,
//   true  // Enable fast mode
// );
// console.log(solTxHash);

// 6. SOL token transfer
// const solConfirmTxHash = await apiNow.buy(
//     process.env.SOL_RECIPIENT,
//     BigInt(10000) * BigInt(1000000), // Multiply by 10^6 for 6 decimals
//     process.env.SOL_PRIVATE_KEY,
//     process.env.SOL_RPC_URL,
//     'sol',
//     process.env.SOL_TOKEN_ADDRESS,
//     false
// );
// console.log(solConfirmTxHash);

// // 7. Get API response for transaction
// const response = await apiNow.txResponse(ENDPOINT, txHash, {
//   method: 'POST',
//   data: { example: 'data' }
// });

// // 7. Complete flow with fast mode
// const completeResponse = await apiNow.infoBuyResponse(
//   ENDPOINT,
//   process.env.ETH_PRIVATE_KEY,
//   process.env.ETH_RPC_URL,
//   { fastMode: true }
// ); 
