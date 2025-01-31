# ApiNow SDK

A TypeScript SDK for interacting with ApiNow endpoints, supporting Ethereum (including Base), and Solana chains.

## Features

- Multi-chain support (Ethereum, Base, Solana)
- Token transfers (ERC20 on ETH/Base, SPL on Solana)
- Fast mode for quicker transaction processing
- TypeScript types for better development experience

## Installation

```bash
npm install apinow-sdk
```

## Usage

### Basic Example

```typescript
import apiNow from 'apinow-sdk';

// Get endpoint info
const info = await apiNow.info('https://apinow.fun/api/endpoints/your-endpoint');

// Send payment and get response
const response = await apiNow.infoBuyResponse(
  'https://apinow.fun/api/endpoints/your-endpoint',
  'YOUR_PRIVATE_KEY',
  'YOUR_RPC_URL'
);
```

### Fast Mode

Fast mode skips transaction confirmation and only waits for the transaction to be in the mempool. This provides much faster responses but slightly less security:

```typescript
const response = await apiNow.infoBuyResponse(
  'https://apinow.fun/api/endpoints/your-endpoint',
  'YOUR_PRIVATE_KEY',
  'YOUR_RPC_URL',
  { fastMode: true }
);
```

### Chain-Specific Examples

#### Ethereum/Base

```typescript
// Native ETH/BASE transfer
const txHash = await apiNow.buy(
  'RECIPIENT_ADDRESS',
  ethers.parseEther('0.1'),
  'YOUR_PRIVATE_KEY',
  'YOUR_RPC_URL',
  'eth'
);

// ERC20 token transfer
const txHash = await apiNow.buy(
  'RECIPIENT_ADDRESS',
  ethers.parseUnits('100', 18), // Use appropriate decimals
  'YOUR_PRIVATE_KEY',
  'YOUR_RPC_URL',
  'eth',
  'TOKEN_ADDRESS'
);
```

#### Solana

```typescript
// Native SOL transfer
const txHash = await apiNow.buy(
  'RECIPIENT_ADDRESS',
  BigInt(LAMPORTS_PER_SOL), // 1 SOL
  'YOUR_PRIVATE_KEY',
  'YOUR_RPC_URL',
  'sol'
);

// SPL token transfer
const txHash = await apiNow.buy(
  'RECIPIENT_ADDRESS',
  BigInt(1000000), // Amount in raw units (e.g. 1.0 for 6 decimals)
  'YOUR_PRIVATE_KEY',
  'YOUR_RPC_URL',
  'sol',
  'TOKEN_ADDRESS'
);
```

## API Reference

### `info(endpoint: string): Promise<InfoResponse>`

Gets information about an endpoint.

### `buy(walletAddress: string, amount: bigint, pkey: string, rpc: string, chain?: 'eth' | 'sol', tokenAddress?: string, fastMode?: boolean): Promise<string>`

Sends a payment transaction. For tokens, provide the amount in raw units (e.g. wei for ERC20, raw units for SPL).

### `txResponse(endpoint: string, txHash: string, opts?: TxResponseOptions): Promise<any>`

Gets the API response for a transaction.

### `infoBuyResponse(endpoint: string, pkey: string, rpc: string, opts?: TxResponseOptions & { fastMode?: boolean }): Promise<any>`

Combines info, buy, and txResponse into a single call.

## Types

```typescript
interface TxResponseOptions {
  method?: string;
  data?: any;
}

interface InfoResponse {
  requiredAmount: string;
  walletAddress: string;
  httpMethod: string;
  tokenAddress?: string;
  chain: 'eth' | 'sol';
}
```

## Error Handling

The SDK throws descriptive errors for various failure cases:
- Invalid endpoint URLs
- Transaction failures
- Network issues
- Invalid addresses or amounts

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