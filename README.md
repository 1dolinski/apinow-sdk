# ApiNow SDK

A TypeScript SDK for interacting with ApiNow endpoints, supporting Ethereum (including Base), and Solana chains. Designed to work in Node.js, browsers, and edge environments like Cloudflare Workers.

## Features

- Multi-chain support (Ethereum, Base, Solana)
- Native and Token transfers (ERC20 on ETH/Base, SPL on Solana)
- Environment Agnostic: Uses global `fetch` for broad compatibility.
- Optional RPC URL: Uses public RPCs by default, allows override.
- Fast mode for quicker transaction processing (skips confirmation wait).
- TypeScript types for better development experience.

## Installation

```bash
npm install apinow-sdk
# or
yarn add apinow-sdk
```

## Usage

### Basic Example (Using Default RPCs)

```typescript
import apiNow from 'apinow-sdk';

const ENDPOINT_URL = 'https://apinow.fun/api/endpoints/your-endpoint';
const YOUR_PRIVATE_KEY = '0x...'; // Or Solana base58 private key

// 1. Get endpoint info (payment details)
const info = await apiNow.info(ENDPOINT_URL);
// info will contain: { requiredAmount, walletAddress, httpMethod, tokenAddress, chain }
console.log('Payment required:', info);

// 2. Send payment and get the API response in one step
try {
  const response = await apiNow.infoBuyResponse(
    ENDPOINT_URL,
    YOUR_PRIVATE_KEY
    // Optional: Add RPC URL override here if needed
    // Optional: Add options like { fastMode: true } here
  );
  console.log('API Response:', response);
} catch (error) {
  console.error('Operation failed:', error);
}
```

### Providing a Custom RPC URL

If you need to use a specific RPC node:

```typescript
const CUSTOM_RPC_URL = 'https://your-custom-node.com';

const response = await apiNow.infoBuyResponse(
  ENDPOINT_URL,
  YOUR_PRIVATE_KEY,
  CUSTOM_RPC_URL // Provide the RPC URL here
);
```

### Fast Mode

Fast mode skips waiting for transaction confirmation. This provides faster responses but relies on the transaction being accepted by the network (mempool/leader inclusion).

```typescript
const response = await apiNow.infoBuyResponse(
  ENDPOINT_URL,
  YOUR_PRIVATE_KEY,
  undefined, // Use default RPC
  { fastMode: true } // Enable fast mode
);
```

### Manual Payment (Separate Steps)

You can also perform the payment manually if needed.

```typescript
import apiNow from 'apinow-sdk';
import { ethers } from 'ethers'; // For amount conversion if needed

const ENDPOINT_URL = 'https://apinow.fun/api/endpoints/your-endpoint';
const YOUR_PRIVATE_KEY = '0x...';
const YOUR_CUSTOM_RPC_URL = 'https://your-node.com'; // Optional

// 1. Get Info
const info = await apiNow.info(ENDPOINT_URL);
const { requiredAmount, walletAddress, chain, tokenAddress } = info;

// Convert requiredAmount (string) to bigint (smallest unit: wei/lamports)
const amountBigInt = BigInt(requiredAmount);

// 2. Send Payment
const txHash = await apiNow.buy(
  walletAddress,
  amountBigInt,
  YOUR_PRIVATE_KEY,
  chain, // Specify the chain from info
  YOUR_CUSTOM_RPC_URL, // Optional: override RPC
  tokenAddress, // Optional: specify token if required by endpoint
  false // Optional: fastMode (defaults to false)
);
console.log(`Payment sent: ${txHash}`);

// 3. Get API Response (after waiting for confirmation if not fastMode)
// Add a delay here if needed
await new Promise(resolve => setTimeout(resolve, 5000)); // Example 5s delay

const apiResponse = await apiNow.txResponse(
  ENDPOINT_URL,
  txHash
);
console.log('API Response:', apiResponse);
```

## API Reference

### `info(endpoint: string): Promise<InfoResponse>`

Gets payment requirement information about an ApiNow endpoint.

### `buy(walletAddress: string, amount: bigint, pkey: string, chain: 'eth' | 'sol' | 'base', rpcUrl?: string, tokenAddress?: string, fastMode?: boolean): Promise<string>`

Sends the required payment transaction to the specified address.
- `amount`: The required amount in the smallest unit (wei for ETH/Base, lamports for SOL).
- `chain`: The blockchain target ('eth', 'sol', 'base').
- `rpcUrl` (Optional): Overrides the default public RPC URL.
- `tokenAddress` (Optional): The contract address if paying with an ERC20/SPL token.
- `fastMode` (Optional): If true, returns the transaction hash immediately without waiting for confirmation.

Returns the transaction hash.

### `txResponse(endpoint: string, txHash: string, opts?: TxResponseOptions): Promise<any>`

Fetches the final API response from the endpoint after a successful payment.
- `txHash`: The hash of the payment transaction.
- `opts` (Optional): Options like `{ method: 'POST', data: {...} }` to be passed to the underlying endpoint API call if needed (usually configured by the endpoint itself).

Returns the endpoint's API response.

### `infoBuyResponse(endpoint: string, pkey: string, rpcUrl?: string, opts?: TxResponseOptions & { fastMode?: boolean }): Promise<any>`

Combines `info`, `buy`, and `txResponse` into a single call for convenience.
- `rpcUrl` (Optional): Overrides the default public RPC URL for the payment.
- `opts` (Optional): Contains `fastMode` boolean and any `TxResponseOptions`.

Returns the final API response.

## Types

```typescript
// Defined in the SDK
interface InfoResponse {
  requiredAmount: string; // Amount in smallest unit (string)
  walletAddress: string;
  httpMethod: string; // Usually GET or POST for txResponse
  tokenAddress?: string;
  chain: 'eth' | 'sol' | 'base';
}

interface TxResponseOptions {
  method?: string; // HTTP method for txResponse call
  data?: any;      // Body data for txResponse call
}
```

## Default RPC URLs

- **Ethereum:** `https://rpc.ankr.com/eth`
- **Base:** `https://mainnet.base.org`
- **Solana:** `https://api.mainnet-beta.solana.com`

You can override these by providing the `rpcUrl` parameter to `buy` or `infoBuyResponse`.

## Error Handling

The SDK throws descriptive errors for:
- Invalid endpoint URLs or configurations.
- RPC communication errors.
- Transaction signing or sending failures.
- Insufficient funds or token allowances.
- Failures during API response fetching (`txResponse`).

Wrap calls in `try...catch` blocks for robust error handling.

## Compatibility

This SDK uses the standard Web `fetch` API and avoids Node.js-specific modules, making it compatible with:
- Node.js (v18+ recommended for global fetch)
- Browsers (modern)
- Edge environments (Cloudflare Workers, Vercel Edge Functions, etc.)

## License

MIT

Copyright (c) 2024 Your Name

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.