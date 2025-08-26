# ApiNow Backend Changes for Enhanced SDK Payments

## 1. Overview of Changes

The ApiNow SDK has been significantly upgraded to provide a more flexible and user-friendly payment experience. The key change is a shift from requiring a single, predefined token for payment to supporting multiple payment options. This allows for two primary pricing models:

*   **Fixed Token Amount**: The endpoint requires a specific amount of a single token (e.g., 100 `MYTOKEN`).
*   **USD Equivalent**: The endpoint requires a specific value in USD (e.g., $5.00), allowing the user to pay with an equivalent amount of `USDC`, `WETH`, or another supported asset.

To enable this, changes are required on the ApiNow backend, specifically to the **API response for `402 Payment Required`** and the **`Endpoint` Mongoose model**.

## 2. Required API Changes: The New `402` Response

The most critical change is the structure of the JSON body returned with a `402 Payment Required` status. The SDK now expects a list of payment `options` instead of a single set of payment fields.

**Old `402` Response Body (❌ Deprecated):**

```json
{
  "requiredAmount": "1000000",
  "walletAddress": "0x...",
  "tokenAddress": "0x...",
  "chain": "base",
  "decimals": 6,
  "httpMethod": "POST" 
}
```

**New `402` Response Body (✅ Required):**

```json
{
  "challenge": "a_unique_server_generated_string_for_this_request",
  "chain": "base",
  "recipientAddress": "0x...",
  "options": [
    {
      "tokenAddress": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      "symbol": "USDC",
      "amount": "5.00",
      "decimals": 6
    },
    {
      "tokenAddress": "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
      "symbol": "WETH",
      "amount": "0.0015",
      "decimals": 18
    }
  ]
}
```

**Key differences:**

*   `recipientAddress` replaces `walletAddress`.
*   A `challenge` string, unique to the request, must be included. The SDK will sign this string as proof of ownership after the payment transaction is sent.
*   `requiredAmount`, `tokenAddress`, `decimals`, and `symbol` are now part of an object within the `options` array.

## 3. How to Set the Payment Type

The server controls the payment type by manipulating the `options` array in the `402` response.

### To require a Fixed Token Amount:

Return the `options` array with a single entry for the required token.

**Example**: Require exactly 100 `MY_API_TOKEN`.

```json
{
  "challenge": "...",
  "chain": "base",
  "recipientAddress": "0x...",
  "options": [
    {
      "tokenAddress": "0x...my_api_token_address...",
      "symbol": "MY_API_TOKEN",
      "amount": "100000000000000000000",
      "decimals": 18
    }
  ]
}
```

### To require a USD Equivalent:

When a `402` is triggered, your server should use a price feed to calculate the equivalent amount for several common assets (`USDC`, `WETH`, native `ETH`, etc.) and return them all in the `options` array.

**Example**: Require $5.00 USD.

The server calculates that $5.00 is currently 5.01 USDC and 0.0015 WETH. It then generates the following response:

```json
{
  "challenge": "...",
  "chain": "base",
  "recipientAddress": "0x...",
  "options": [
    {
      "tokenAddress": "0x...usdc_address...",
      "symbol": "USDC",
      "amount": "5.01",
      "decimals": 6
    },
    {
      "tokenAddress": "0x...weth_address...",
      "symbol": "WETH",
      "amount": "0.0015",
      "decimals": 18
    },
    {
      "tokenAddress": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "symbol": "ETH",
      "amount": "0.0015",
      "decimals": 18
    }
  ]
}
```

The SDK will automatically prioritize which token to use based on the user's balances and configuration.

## 4. Recommended `Endpoint` Model Changes

The current `EndpointSchema` is designed for a single, fixed payment and is no longer sufficient. We recommend replacing the flat payment fields with a more flexible `pricing` object.

**Current `EndpointSchema` fields to be replaced:**

*   `requiredAmount`
*   `tokenAddress`
*   `decimals`
*   `tokenSymbol`

**Proposed New Schema Structure:**

We recommend adding a `pricing` sub-document to your schema. This allows you to define the price type in the database and generate the appropriate `402` response at runtime.

```javascript
import mongoose from 'mongoose';
import { Schema } from 'mongoose';

// New sub-schema for defining the price
const PricingSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['fixed_token', 'usd_equivalent'],
    required: true,
    default: 'usd_equivalent'
  },
  // Used for 'fixed_token' type
  tokenInfo: {
    address: { type: String },
    symbol: { type: String },
    decimals: { type: Number },
    amount: { type: String },
  },
  // Used for 'usd_equivalent' type
  amountUsd: {
    type: String,
  }
}, { _id: false });


const EndpointSchema = new mongoose.Schema({
  // ... existing fields like namespace, endpointName, httpMethod, etc.
  
  walletAddress: {
    type: String,
    required: true,
    trim: true,
  },

  // --- NEW ---
  pricing: {
    type: PricingSchema,
    required: true,
    default: () => ({ type: 'usd_equivalent', amountUsd: '0.01' })
  },
  
  // --- DEPRECATED ---
  // requiredAmount: { ... },
  // tokenAddress: { ... },
  // decimals: { ... },
  // tokenSymbol: { ... },

  // ... other existing fields
});

// ... rest of your model definition
```

### Migration Plan:

1.  **Add the new `pricing` field** to your schema with a default value.
2.  **Write a migration script** to iterate through existing `Endpoint` documents and populate the new `pricing` field based on the old fields.
    *   If `tokenAddress` exists, create a `pricing` object of type `fixed_token`.
    *   Otherwise, create a `pricing` object of type `usd_equivalent` using the value from `requiredAmount` as `amountUsd`.
3.  **Update your API logic** that generates the `402` response to read from the new `pricing` object.
4.  **Remove the old fields** (`requiredAmount`, `tokenAddress`, etc.) from the schema once the migration is complete and the API is updated.
