
import apiNow from './dist/index.js';
import { Wallet } from 'ethers';
import 'dotenv/config';

// This example demonstrates the original "legacy" flow using infoBuyResponse.
// It's a multi-step process:
// 1. Get info from the endpoint.
// 2. Make a payment.
// 3. Get the final response from the API.

// --- Configuration ---
// Make sure to set your private key in a .env file.
// NEVER commit your private key to git.
const userWalletPrivateKey = process.env.PRIVATE_KEY;
if (!userWalletPrivateKey) {
    throw new Error('PRIVATE_KEY is not set in the .env file.');
}

// The API endpoint you want to interact with.
// This would be provided by the service you're using.
const API_ENDPOINT = 'https://example-api.com/protected-resource'; // Replace with a real endpoint for testing

// Optional: If you have specific data to send with your final request.
const requestData = {
    query: 'What is the weather in New York?'
};

async function main() {
    console.log('--- Starting Legacy Flow Example ---');
    
    // Create a wallet instance from the private key.
    const wallet = new Wallet(userWalletPrivateKey);
    console.log(`Using wallet address: ${wallet.address}`);

    try {
        console.log(`\nStep 1 & 2 & 3: Calling infoBuyResponse for endpoint: ${API_ENDPOINT}`);
        
        // This single method handles fetching payment info, making the payment,
        // signing the transaction hash, and fetching the final data.
        const result = await apiNow.infoBuyResponse(
            API_ENDPOINT,
            userWalletPrivateKey,
            undefined, // Optional RPC URL
            {
                data: requestData, // The data to be sent in the final request
                method: 'POST'     // The HTTP method for the final request
            }
        );

        console.log('\n✅ Success! Received final response:');
        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('\n❌ An error occurred during the legacy flow:');
        // The error could be in fetching info, making the payment, or the final request.
        console.error(error);
    }

    console.log('\n--- Legacy Flow Example Finished ---');
}

main().catch(err => {
    console.error('Unhandled error in main function:', err);
});
