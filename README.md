# ApiNow SDK

A TypeScript SDK for interacting with ApiNow endpoints, supporting Ethereum and Base chains. This SDK simplifies payments by automatically handling `402 Payment Required` responses, including on-the-fly token swaps.

## Features

- **Automatic x402 Payments**: Intercepts `402` responses to handle payment flows automatically.
- **On-the-fly Token Swaps**: If you don't have the required payment token, the SDK can swap a common asset (like ETH, WETH, or USDC) to make the payment, powered by 0x.
- **Flexible Pricing**: Supports endpoints that require a fixed token amount or a USD equivalent.
- **Configurable Payment**: Prioritize which tokens you prefer to pay with.
- **Multi-chain support**: Works with Ethereum and Base.
- **Node.js Environment**: Designed to work in a Node.js environment.

## Installation

```bash
npm install apinow-sdk
# or
yarn add apinow-sdk
```

## Usage

The primary way to use the SDK is with the `execute` method. It's a single call that handles all the complexity of API payments for you.

```typescript
import apiNow from 'apinow-sdk';

// The API endpoint you want to interact with.
const ENDPOINT_URL = 'https://apinow.fun/api/endpoints/your-endpoint';

// Your private key, securely stored (e.g., in an environment variable).
const YOUR_WALLET_PRIVATE_KEY = '0x...'; 

async function main() {
  try {
    // The `execute` method handles everything automatically.
    // If the API requires a payment (402), the SDK will:
    // 1. Find the best token you hold to pay with.
    // 2. If needed, swap a common asset (like ETH or USDC) to the required token.
    // 3. Send the payment transaction.
    // 4. Retry the original request with proof of payment.
    const response = await apiNow.execute(
      ENDPOINT_URL,
      YOUR_WALLET_PRIVATE_KEY,
      { // Optional: request options
        method: 'POST',
        data: { query: 'your-data' }
      }
    );

    console.log('API Response:', response);
  } catch (error) {
    console.error('Operation failed:', error);
  }
}

main();
```

## How It Works: Automatic Payments

When you call `execute`, the SDK makes a request to the endpoint. If the server responds with a `402 Payment Required` status, the SDK automatically performs the following steps:

1.  **Parses Payment Options**: The `402` response contains a list of accepted payment options. This can be a single token (fixed price) or multiple tokens (USD equivalent price, e.g., "$5 of USDC" or "$5 of ETH").
2.  **Checks Balances**: It checks your wallet balance for each of the accepted payment tokens.
3.  **Prioritizes Payment**: It attempts to pay using your tokens in a preferred order (default: `['USDC', 'WETH', 'ETH']`).
4.  **Swaps if Needed**: If you don't have any of the *required* tokens, the SDK will try to swap one of your preferred assets for the required one. For example, it can swap your USDC to pay with a different required token.
5.  **Pays and Retries**: Once the payment transaction is sent, the SDK automatically retries the original API request, now with proof of payment.

## Configuration

You can customize the behavior of the `execute` method with the `opts` and `paymentConfig` parameters.

### Request Options (`opts`)

Passed as the third argument to `execute`. This corresponds to `TxResponseOptions`.

-   `method`: The HTTP method for your request (e.g., `'GET'`, `'POST'`). Defaults to `'GET'`.
-   `data`: The payload for your request. For `POST` requests, this is the JSON body. For `GET`, it's converted to query parameters.

### Payment Configuration (`paymentConfig`)

Passed as the fourth argument to `execute`. This corresponds to `X402PaymentConfig`.

-   `preferredTokens`: An array of token symbols (e.g., `['USDC', 'WETH']`) that you prefer to pay with. The SDK will check your balance of these tokens first.

```typescript
await apiNow.execute(
  ENDPOINT_URL,
  YOUR_WALLET_PRIVATE_KEY,
  { method: 'POST', data: { /* ... */ } }, // opts
  { preferredTokens: ['DAI', 'USDC'] }   // paymentConfig
);
```

## Legacy Flow (Backward Compatibility)

For backward compatibility, the `infoBuyResponse` method is still available. It performs a less sophisticated multi-step payment process.

```typescript
const response = await apiNow.infoBuyResponse(
  ENDPOINT_URL,
  YOUR_WALLET_PRIVATE_KEY
);
```

## API Reference

### `execute(endpoint, privateKey, opts?, paymentConfig?)`
Handles a request and its potential payment in a single, automatic call. This is the recommended method.

### `infoBuyResponse(endpoint, privateKey, rpcUrl?, opts?)`
(Legacy) Combines `info`, `buy`, and `txResponse` into a single call.

### `info(endpoint)`
(Legacy) Gets payment requirement information from an endpoint.

### `buy(walletAddress, amount, privateKey, chain, ...)`
(Legacy) Sends a payment transaction.

### `txResponse(endpoint, txHash, opts?)`
(Legacy) Fetches the API response after a payment has been made manually.

## Types

```typescript
// Response from a 402 error
interface X402PaymentInfo {
  challenge: string;
  chain: 'eth' | 'base';
  recipientAddress: string;
  options: X402PaymentOption[];
}

// A single way to pay
interface X402PaymentOption {
  tokenAddress: string;
  symbol: string;
  amount: string;
  decimals: number;
}

// Configuration for payments
interface X402PaymentConfig {
  preferredTokens?: string[];
}

// Options for the API request itself
interface TxResponseOptions {
  method?: string; 
  data?: any;      
}
```

## Default RPC URLs

- **Ethereum:** `https://rpc.ankr.com/eth`
- **Base:** `https://mainnet.base.org`

## Error Handling

The SDK throws descriptive errors for:
- Invalid endpoint URLs or configurations.
- RPC communication errors.
- Transaction signing or sending failures.
- Insufficient funds or failure to find a valid swap.
- Failures during API response fetching.

Wrap calls in `try...catch` blocks for robust error handling.

## Compatibility

This SDK uses `node-fetch`, making it compatible with:
- Node.js (v18+ recommended)

It is NOT directly compatible with browsers or edge environments that do not provide a Node.js-compatible `fetch` API.

## License

MIT

## Examples

This project includes a test server and a test runner to demonstrate various payment scenarios.

1.  **Create a `.env` file** in the root of the project and add your wallet's private key:
    ```
    PRIVATE_KEY=your_private_key_here
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the test server:**
    The test server simulates an API that requires different types of payments.
    ```bash
    node test/test-server.js
    ```

4.  **Run the test runner:**
    In a separate terminal, run the test runner to execute a series of transactions against the test server.
    ```bash
    node test/test-runner.js
    ```

This will demonstrate:
- Paying with USDC
- Paying with a custom ERC20 token
- Paying with a token priced in USDC
- Fallback token payments
- Handling various error conditions

## Local Development

1. **Build the project:**
   ```bash
   npm run build
   ```

This will compile the TypeScript source files into JavaScript in the `dist` directory.

## Contributing
