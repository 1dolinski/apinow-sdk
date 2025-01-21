# ApiNow SDK

The endpoint vending machine - SDK for interacting with ApiNow endpoints.

## Installation

```bash
npm install apinow-sdk
```

## Quick Start

```ts
import apiNow from 'apinow-sdk';

// One-shot purchase and response
const response = await apiNow.infoBuyResponse(
  'https://apinow.fun/api/endpoints/my-endpoint',
  '0x123...private-key',
  'https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY'
);
```

## API Reference

### info(endpoint)
Fetches endpoint metadata like required ETH amount and wallet address.

```ts
const info = await apiNow.info('https://apinow.fun/api/endpoints/my-endpoint');
// Returns: { 
//   requiredEth: "0.1",
//   walletAddress: "0x123...", 
//   httpMethod: "POST" 
// }
```

### buy(walletAddress, amount, privateKey, rpcUrl)
Sends an ETH transaction to purchase endpoint access.

```ts
const txHash = await apiNow.buy(
  "0x123...wallet",  // Destination wallet
  ethers.parseEther("0.1"), // Amount in ETH
  "0x456...private-key", // Your private key
  "https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY" // RPC URL
);
```

### txResponse(endpoint, txHash, options?)
Gets the API response using your transaction hash.

```ts
const response = await apiNow.txResponse(
  "https://apinow.fun/api/endpoints/my-endpoint",
  "0x789...txhash",
  {
    method: "POST", // Optional, defaults to GET
    data: { foo: "bar" } // Optional request body
  }
);
```

### infoBuyResponse(endpoint, privateKey, rpcUrl, options?)
Combines all steps: fetches info, sends payment, and gets response.

```ts
// Complete example with all parameters
const response = await apiNow.infoBuyResponse(
  "https://apinow.fun/api/endpoints/my-endpoint",
  "0x123...private-key",
  "https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY",
  {
    method: "POST", // Optional, defaults to endpoint's httpMethod
    data: { // Optional request body
      query: "example",
      limit: 10
    }
  }
);
```

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