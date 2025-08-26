# APINow SDK x402 Payment Scenarios

This document outlines the various test scenarios implemented in `test/test-runner.js` to validate the functionality of the APINow SDK's x402 payment flow.

### Scenarios Overview

| Test Name                                | Payment Token | Payment Type   | User Wallet Pre-conditions              | Expected Outcome      |
| ---------------------------------------- | ------------- | -------------- | --------------------------------------- | --------------------- |
| 1. Pay with USDC                         | USDC          | Fixed Amount   | Has sufficient USDC                     | Success (Direct Pay)  |
| 2. Fallback Token Payment                | OTHER / USDC  | Fixed Amount   | No "OTHER", but has sufficient USDC     | Success (Fallback)    |
| 3. Pay with Fixed Token Amount           | TRANSLATE     | Fixed Amount   | Has sufficient TRANSLATE                | Success (Direct Pay)  |
| 4. Pay with Token in USD Equivalent      | TRANSLATE     | USD Equivalent | Has sufficient TRANSLATE                | Success (Direct Pay)  |
| 5. Insufficient Balance                  | USDC          | Fixed Amount   | Insufficient USDC                       | Failure (Error)       |
| 6. Server Error After Payment            | USDC          | Fixed Amount   | Has sufficient USDC                     | Failure (Error)       |
| 7. Invalid Configuration                 | N/A           | N/A            | N/A (Tests bad inputs/responses)        | Failure (Error)       |
| 8. Concurrent Requests                   | USDC          | Fixed Amount   | Has sufficient USDC for all calls       | Success (Sequential)  |
| 9. Swap-to-Pay (Failure)                 | STAGE         | Fixed Amount   | No STAGE, but has sufficient USDC       | Failure (Swap Fails)  |
| 10. Swap-to-Pay (Success)                | BETR          | Fixed Amount   | No BETR, but has sufficient USDC        | Success (Swap & Pay)  |

---

### 1. Standard Payment with USDC

-   **Title**: Successful Payment with a Standard Token (USDC)
-   **TL;DR**: The client requests a resource, the server demands a USDC payment, the client's wallet has sufficient funds and pays, and the server grants access to the resource. This is the primary "happy path" scenario.
-   **Input**:
    -   API Request: `POST /pay-with-usdc`
    -   User Wallet: Must have > 0.01 USDC and sufficient ETH for gas on the Base network.
-   **Output**:
    -   A successful API response containing the requested data.
    ```json
    {
      "success": true,
      "data": "Here is your premium data paid with USDC."
    }
    ```
-   **Flowchart**:
    ```mermaid
    sequenceDiagram
        participant Client as Client (SDK)
        participant Server as API Server
        participant Blockchain as Base Network

        Client->>Server: POST /pay-with-usdc
        Server-->>Client: 402 Payment Required (demanding 0.01 USDC)
        Client->>Client: Check wallet balance for USDC
        Client->>Blockchain: Submit USDC Transfer Transaction
        Blockchain-->>Client: Transaction Confirmed
        Client->>Server: POST /pay-with-usdc (with TX proof in header)
        Server-->>Client: 200 OK (with premium data)
    ```

---

### 2. Fallback Token Payment

-   **Title**: Successful Payment Using a Fallback Token
-   **TL;DR**: The server requests payment with a primary token the user doesn't have, but also provides a secondary (fallback) token that the user *does* have. The SDK intelligently skips the first option and pays with the fallback token.
-   **Input**:
    -   API Request: `POST /fallback-token`
    -   User Wallet: Has 0 "OTHER" tokens, but > 0.03 USDC and gas.
-   **Output**:
    -   A successful API response.
    ```json
    {
      "success": true,
      "data": "Data paid with a fallback token."
    }
    ```
-   **Flowchart**:
    ```mermaid
     sequenceDiagram
        participant Client as Client (SDK)
        participant Server as API Server
        participant Blockchain as Base Network

        Client->>Server: POST /fallback-token
        Server-->>Client: 402 (demanding "OTHER" or USDC)
        Client->>Client: Check balance for "OTHER" token (first option)
        Client->>Client: Balance is 0. Skip.
        Client->>Client: Check balance for USDC (second option)
        Client->>Client: Sufficient balance found.
        Client->>Blockchain: Submit USDC Transfer Transaction
        Blockchain-->>Client: Transaction Confirmed
        Client->>Server: POST /fallback-token (with USDC TX proof)
        Server-->>Client: 200 OK (with data)
    ```

---

### 3. Payment with a Fixed Token Amount

-   **Title**: Successful Payment with a Specific, Non-Stablecoin Token
-   **TL;DR**: The server demands payment in a specific token the user possesses (TRANSLATE). The SDK checks the user's balance for that token and, finding it sufficient, proceeds with the direct payment.
-   **Input**:
    -   API Request: `POST /pay-with-token`
    -   User Wallet: Must have > 10 TRANSLATE tokens and gas.
-   **Output**:
    -   A successful API response.
    ```json
    {
      "success": true,
      "data": "Here is your premium data paid with a specific token."
    }
    ```
-   **Flowchart**:
    ```mermaid
    sequenceDiagram
        participant Client as Client (SDK)
        participant Server as API Server
        participant Blockchain as Base Network

        Client->>Server: POST /pay-with-token
        Server-->>Client: 402 Payment Required (demanding 10 TRANSLATE)
        Client->>Client: Check wallet balance for TRANSLATE token
        Client->>Blockchain: Submit TRANSLATE Token Transfer Transaction
        Blockchain-->>Client: Transaction Confirmed
        Client->>Server: POST /pay-with-token (with TX proof)
        Server-->>Client: 200 OK (with premium data)
    ```

---

### 4. Payment with a Token in USD Equivalent

-   **Title**: Successful Payment with a Token Amount Pegged to a USD Value
-   **TL;DR**: The server demands a payment equivalent to a specific USD amount (e.g., $0.02), payable in a specific token (TRANSLATE). The SDK would need to calculate the correct amount of the token to send.
-   **Input**:
    -   API Request: `POST /pay-with-token-usd-equiv`
    -   User Wallet: Must have enough TRANSLATE token to cover the $0.02 equivalent and gas.
-   **Output**: A successful API response.
    -   **Flowchart**:
    ```mermaid
    sequenceDiagram
        participant Client as Client (SDK)
        participant Server as API Server
        participant DEX as 0x API
        participant Blockchain as Base Network

        Client->>Server: POST /pay-with-usd-value
        Server-->>Client: 402 (demanding $0.05 of SPEC)
        Client->>DEX: Get price of SPEC in USDC
        DEX-->>Client: Price data (e.g., 1 SPEC = $2.50)
        Client->>Client: Calculate required SPEC (0.05 / 2.50 = 0.02 SPEC)
        Client->>Client: Check wallet for SPEC (fails)
        Client->>DEX: Get quote to buy 0.02 SPEC with ETH
        DEX-->>Client: Swap Quote
        Client->>Client: Check wallet for ETH (succeeds)
        Client->>Blockchain: Submit Swap Transaction (ETH -> SPEC)
        Blockchain-->>Client: Swap Confirmed
        Client->>Blockchain: Submit Payment Transaction (SPEC)
        Blockchain-->>Client: Payment Confirmed
        Client->>Server: POST /pay-with-usd-value (with proof)
        Server-->>Client: 200 OK
    ```

---

### 5. Error Handling: Insufficient Balance

-   **Title**: Graceful Failure on Insufficient Balance
-   **TL;DR**: The server demands payment, but the SDK checks the user's wallet and finds it lacks the required funds for *any* of the payment options. The process stops and throws a descriptive error without attempting any blockchain transaction, saving the user gas fees.
-   **Input**:
    -   API Request: `POST /test-error` with body `{ "errorType": "insufficient-balance" }`
    -   User Wallet: Has less than the 1,000,000 USDC required by the server.
-   **Output**:
    -   A clear error message from the SDK.
    ```
    Error: Could not find a valid payment or swap option.
    ```
-   **Flowchart**:
    ```mermaid
    sequenceDiagram
        participant Client as Client (SDK)
        participant Server as API Server

        Client->>Server: POST /test-error
        Server-->>Client: 402 (demanding 1,000,000 USDC)
        Client->>Client: Check wallet balance for USDC
        Client->>Client: Balance is insufficient.
        Client->>Client: Attempt to find a swap (fails).
        Client-->>Client: Abort and throw "Could not find valid payment" error.
    ```

---

### 6. Error Handling: Server Error After Payment

-   **Title**: Graceful Failure when the Server Fails After a Successful Payment
-   **TL;DR**: The SDK successfully pays for the resource, but when it retries the request with the payment proof, the server returns an error (e.g., 500 Internal Server Error). The SDK throws a specific error, alerting the user that payment was sent but the resource was not delivered.
-   **Input**:
    -   API Request: `POST /test-error` with body `{ "errorType": "server-error-after-payment" }`
    -   User Wallet: Has sufficient USDC.
-   **Output**:
    -   An error indicating the payment was made but the API failed on the retry.
    ```
    Error: API request failed after payment: Internal Server Error after payment.
    ```
-   **Flowchart**:
    ```mermaid
    sequenceDiagram
        participant Client as Client (SDK)
        participant Server as API Server
        participant Blockchain as Base Network

        Client->>Server: POST /test-error
        Server-->>Client: 402 Payment Required
        Client->>Blockchain: Submit USDC Transfer Transaction
        Blockchain-->>Client: Transaction Confirmed
        Client->>Server: POST /test-error (with TX proof)
        Server-->>Client: 500 Internal Server Error
        Client-->>Client: Abort and throw "API request failed after payment" error.
    ```

---

### 7. Error Handling: Invalid Configuration

-   **Title**: Validation of Inputs and Server Responses
-   **TL;DR**: These tests ensure the SDK fails predictably when given bad inputs or when the server behaves unexpectedly.
-   **Scenarios**:
    -   **Invalid Private Key**: The `execute` call is made with a malformed private key.
        -   **Output**: `Error: invalid BytesLike value...`
    -   **Malformed 402 Header**: The server returns a 402 status, but the `www-authenticate` header is unreadable.
        -   **Output**: `Error: Failed to decode or parse L402 token...`
    -   **Unsupported Chain ID**: The server requests payment on a chain the SDK doesn't have an RPC endpoint for.
        -   **Output**: `Error: Could not find a valid payment or swap option.` (As it cannot connect to check balances).

---

### 8. Concurrent Requests

-   **Title**: Handling Multiple Concurrent Payments
-   **TL;DR**: Multiple paid requests are initiated in parallel. The SDK handles each payment flow independently without race conditions, successfully paying for and receiving all requested resources.
-   **Input**:
    -   Three simultaneous `POST /concurrent-request` calls.
    -   User Wallet: Has enough USDC to cover all three small payments.
-   **Output**:
    -   Three successful and distinct API responses are received.
-   **Note**: A flowchart for this is essentially three "Standard Payment" flows running sequentially.

---

### 9. Swap-to-Pay

-   **Title**: Automatic Swap to Acquire a Required Token for Payment
-   **TL;DR**: The server demands payment in a token the user does not possess (STAGE). The SDK finds that the user has a different token (USDC), gets a quote from a DEX (0x API), executes the swap, and then uses the newly acquired STAGE tokens to complete the payment.
-   **Input**:
    -   API Request: `POST /pay-with-stage-only`
    -   User Wallet: Must have sufficient USDC to cover the cost of 5 STAGE tokens plus swap fees, but an insufficient balance of STAGE itself.
-   **Output**:
    -   A successful API response.
    ```json
    {
      "success": true,
      "data": "Here is your premium data paid for with a swapped STAGE token."
    }
    ```
-   **Flowchart**:
    ```mermaid
    sequenceDiagram
        participant Client as Client (SDK)
        participant Server as API Server
        participant DEX as 0x API
        participant Blockchain as Base Network

        Client->>Server: POST /pay-with-stage-only
        Server-->>Client: 402 (demanding 5 STAGE)
        Client->>Client: Check balance for STAGE (fails)
        Client->>DEX: Get quote to buy 5 STAGE with USDC
        DEX-->>Client: Swap Quote (e.g., costs 0.05 USDC)
        Client->>Client: Check balance for USDC (succeeds)
        Client->>Blockchain: Submit Swap Transaction (USDC -> STAGE)
        Blockchain-->>Client: Swap Confirmed
        Client->>Blockchain: Submit Payment Transaction (STAGE)
        Blockchain-->>Client: Payment Confirmed
        Client->>Server: POST /pay-with-stage-only (with payment TX proof)
        Server-->>Client: 200 OK (with data)
    ```

---

### 10. Successful Swap-to-Pay (with Liquidity)

-   **Title**: Automatic Successful Swap to Acquire a Required Token for Payment
-   **TL;DR**: The server demands payment in a token the user does not possess, but which has on-chain liquidity (BETR). The SDK finds the user has USDC, gets a valid quote from a DEX, executes the swap, and then uses the newly acquired BETR tokens to complete the payment.
-   **Input**:
    -   API Request: `POST /pay-with-betr-swap`
    -   User Wallet: Must have sufficient USDC to cover the cost of 1 BETR token plus swap fees, but an insufficient balance of BETR itself.
-   **Output**:
    -   A successful API response.
    ```json
    {
      "success": true,
      "data": "Here is your premium data paid for with a successfully swapped BETR token."
    }
    ```
-   **Flowchart**:
    ```mermaid
    sequenceDiagram
        participant Client as Client (SDK)
        participant Server as API Server
        participant DEX as 0x API
        participant Blockchain as Base Network

        Client->>Server: POST /pay-with-betr-swap
        Server-->>Client: 402 (demanding 1 BETR)
        Client->>Client: Check balance for BETR (fails)
        Client->>DEX: Get quote to buy 1 BETR with USDC
        DEX-->>Client: Swap Quote
        Client->>Client: Check balance for USDC (succeeds)
        Client->>Blockchain: Submit Swap Transaction (USDC -> BETR)
        Blockchain-->>Client: Swap Confirmed
        Client->>Blockchain: Submit Payment Transaction (BETR)
        Blockchain-->>Client: Payment Confirmed
        Client->>Server: POST /pay-with-betr-swap (with payment TX proof)
        Server-->>Client: 200 OK (with data)
    ```
