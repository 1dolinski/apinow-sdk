import { ethers, Contract, Wallet, JsonRpcProvider, TransactionRequest, parseUnits, AbiCoder, keccak256, isAddress } from 'ethers';
import {
    Connection,
    PublicKey,
    LAMPORTS_PER_SOL,
    Transaction,
    SystemProgram,
    Keypair,
    ComputeBudgetProgram,
    sendAndConfirmTransaction // Using this for simplicity now, but could replace with fetch later if needed
} from '@solana/web3.js';
import {
    createTransferInstruction,
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
    getMint
} from '@solana/spl-token';
import bs58 from 'bs58';

// Default RPC URLs
const DEFAULT_ETH_RPC = 'https://rpc.ankr.com/eth'; // Example public RPC
const DEFAULT_SOL_RPC = 'https://api.mainnet-beta.solana.com'; // Example public RPC
const DEFAULT_BASE_RPC = 'https://mainnet.base.org'; // Example public RPC

interface TxResponseOptions {
    method?: string;
    data?: any;
}

interface InfoResponse {
    requiredAmount: string;
    walletAddress: string;
    httpMethod: string;
    tokenAddress?: string;
    chain: 'eth' | 'sol' | 'base';
}

// --- Helper function for fetch ---
async function fetchJson(url: string, options?: RequestInit): Promise<any> {
    const response = await fetch(url, options);
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error ${response.status}: ${errorBody}`);
    }
    return response.json();
}

// --- Helper function for RPC calls ---
async function sendJsonRpc(rpcUrl: string, method: string, params: any[]): Promise<any> {
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1, // Simple static ID
            method: method,
            params: params,
        }),
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`RPC error ${response.status} for method ${method}: ${errorBody}`);
    }
    const jsonResponse = await response.json();
    if (jsonResponse.error) {
        throw new Error(`RPC error for method ${method}: ${JSON.stringify(jsonResponse.error)}`);
    }
    return jsonResponse.result;
}


interface ChainHandler {
    buy(
        walletAddress: string,
        amount: bigint,
        pkey: string,
        rpcUrl?: string, // Now optional
        tokenAddress?: string,
        fastMode?: boolean // Note: fastMode might be less relevant with direct RPC calls
    ): Promise<string>; // Returns tx hash
}

class EthereumHandler implements ChainHandler {
    async buy(
        walletAddress: string,
        amount: bigint,
        pkey: string,
        rpcUrl?: string,
        tokenAddress?: string,
        fastMode?: boolean // Keep param for API consistency, but might not affect logic much now
    ): Promise<string> {
        const rpc = rpcUrl || (rpcUrl && rpcUrl.includes('base') ? DEFAULT_BASE_RPC : DEFAULT_ETH_RPC); // Determine default based on presence/content of rpcUrl or use general ETH

        if (!walletAddress || !isAddress(walletAddress)) {
            throw new Error('Invalid recipient wallet address');
        }

        const wallet = new Wallet(pkey); // Create wallet without provider initially
        const senderAddress = wallet.address;

        try {
            // Get nonce manually
            const nonce = await sendJsonRpc(rpc, 'eth_getTransactionCount', [senderAddress, 'latest']);

            // Get gas price suggestion (EIP-1559)
            const feeData = await sendJsonRpc(rpc, 'eth_gasPrice', []); // Using legacy gasPrice for simplicity, could fetch EIP-1559 fees

            let txRequest: TransactionRequest;

            if (tokenAddress) {
                if (!isAddress(tokenAddress)) {
                    throw new Error('Invalid token address');
                }
                // ERC20 Transfer
                const abi = ["function transfer(address to, uint256 amount)"];
                const iface = new ethers.Interface(abi);
                const data = iface.encodeFunctionData("transfer", [walletAddress, amount]);

                txRequest = {
                    to: tokenAddress,
                    nonce: parseInt(nonce, 16),
                    gasPrice: feeData, // Use fetched gas price
                    // Estimate gas manually if needed, or use a standard limit
                    gasLimit: 100000, // Adjust as necessary for ERC20 transfers
                    data: data,
                    chainId: (await sendJsonRpc(rpc, 'eth_chainId', [])), // Fetch chainId
                };
            } else {
                // Native ETH/Base Transfer
                txRequest = {
                    to: walletAddress,
                    value: amount,
                    nonce: parseInt(nonce, 16),
                    gasPrice: feeData, // Use fetched gas price
                    gasLimit: 21000, // Standard limit for native transfers
                    chainId: (await sendJsonRpc(rpc, 'eth_chainId', [])), // Fetch chainId
                };
            }

            const signedTx = await wallet.signTransaction(txRequest);
            const txHash = await sendJsonRpc(rpc, 'eth_sendRawTransaction', [signedTx]);

            // TODO: Optionally wait for confirmation if fastMode is false
            // This would involve polling eth_getTransactionReceipt

            return txHash;

        } catch (error: unknown) {
            console.error('Detailed ETH error:', error);
            throw new Error(
                `Ethereum transaction failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

class SolanaHandler implements ChainHandler {
      // Keep using Connection for some helpers, but sendRawTransaction manually
      private async getConnection(rpcUrl?: string): Promise<Connection> {
        const rpc = rpcUrl || DEFAULT_SOL_RPC;
        return new Connection(rpc, {
            commitment: 'processed',
            confirmTransactionInitialTimeout: 10000 // Used by getMint etc.
        });
    }


    async buy(
        walletAddress: string,
        amount: bigint,
        pkey: string,
        rpcUrl?: string,
        tokenAddress?: string,
        fastMode?: boolean
    ): Promise<string> {
        const rpc = rpcUrl || DEFAULT_SOL_RPC;
        const connection = await this.getConnection(rpc); // Still useful for some reads

        try {
            const recipientPubkey = new PublicKey(walletAddress);
            const senderKeypair = Keypair.fromSecretKey(bs58.decode(pkey));

            const transaction = new Transaction();

            // Add priority fee instruction
            transaction.add(
                ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: 50000 // Example fee, adjust as needed
                })
            );

             // Add compute unit limit if necessary, e.g., for token transfers
             transaction.add(
                ComputeBudgetProgram.setComputeUnitLimit({
                    units: tokenAddress ? 200000 : 50000 // Higher limit for token ops
                })
            );


            if (tokenAddress) {
                const mint = new PublicKey(tokenAddress);
                // Use connection helpers for these reads
                const senderATA = await getAssociatedTokenAddress(mint, senderKeypair.publicKey);
                const recipientATA = await getAssociatedTokenAddress(mint, recipientPubkey);

                // Check if recipient ATA exists, if not, add instruction to create it
                const recipientATAInfo = await connection.getAccountInfo(recipientATA);
                 if (!recipientATAInfo) {
                    // This part needs @solana/spl-token's createAssociatedTokenAccountInstruction
                    // Import: import { createAssociatedTokenAccountInstruction } from '@solana/spl-token';
                    // transaction.add(
                    //     createAssociatedTokenAccountInstruction(
                    //         senderKeypair.publicKey, // Payer
                    //         recipientATA,
                    //         recipientPubkey,
                    //         mint
                    //     )
                    // );
                     console.warn("Recipient Associated Token Account does not exist. Auto-creation commented out. Ensure recipient has the ATA.");
                      // For now, we'll proceed assuming it exists or will be created elsewhere.
                      // Production code should handle this creation properly.

                 }


                transaction.add(
                    createTransferInstruction(
                        senderATA,
                        recipientATA,
                        senderKeypair.publicKey,
                        Number(amount) // SPL transfer amount expects number
                    )
                );
            } else {
                // SOL transfer
                transaction.add(
                    SystemProgram.transfer({
                        fromPubkey: senderKeypair.publicKey,
                        toPubkey: recipientPubkey,
                        lamports: Number(amount) // SystemProgram.transfer expects number
                    })
                );
            }

            // Get blockhash manually
            const { blockhash, lastValidBlockHeight } = await sendJsonRpc(rpc, 'getLatestBlockhash', [{'commitment': 'processed'}]);

            transaction.recentBlockhash = blockhash;
            transaction.feePayer = senderKeypair.publicKey;
            transaction.sign(senderKeypair);

            const rawTx = transaction.serialize();
            const base64Tx = Buffer.from(rawTx).toString('base64');

            // Send transaction manually via RPC
            const signature = await sendJsonRpc(rpc, 'sendTransaction', [
                base64Tx,
                {
                    encoding: 'base64',
                    skipPreflight: false, // Usually false
                    preflightCommitment: 'processed',
                    maxRetries: 2
                }
            ]);

            // Optionally confirm transaction if not in fastMode
             if (!fastMode) {
                console.log('Waiting for Solana confirmation (up to 30s)... Signature:', signature);
                 try {
                    // Ensure blockhash is defined before confirming
                    if (!transaction.recentBlockhash) {
                        throw new Error("Transaction recentBlockhash is missing, cannot confirm.");
                    }
                    await connection.confirmTransaction({
                        signature,
                        blockhash: transaction.recentBlockhash, // Now confirmed non-undefined
                        lastValidBlockHeight // Use the height we got
                    }, 'processed'); // or 'confirmed'/'finalized'
                    console.log('Solana transaction confirmed!');
                } catch (confirmError) {
                    console.error(`Solana confirmation failed for ${signature}:`, confirmError);
                    // Don't necessarily throw here, tx might still succeed eventually
                    // Consider returning signature but warning about confirmation failure
                 }
             }


            return signature;

        } catch (error: unknown) {
            console.error('Detailed SOL error:', error);
             // Try to provide more specific error info if possible
            if (error instanceof Error && error.message.includes('AccountNotFound')) {
                 throw new Error(`Solana transaction failed: Source token account might not exist or have funds. ${error.message}`);
            }
             if (error instanceof Error && error.message.includes('Invalid private key')) {
                 throw new Error(`Solana transaction failed: Invalid private key provided. ${error.message}`);
            }
            throw new Error(
                `Solana transaction failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}


class ApiNow {
    private handlers: { [key: string]: ChainHandler } = {
        eth: new EthereumHandler(),
        sol: new SolanaHandler(),
        base: new EthereumHandler() // Base uses Ethereum handler
    };

    // Use helper function
    async info(endpoint: string): Promise<InfoResponse> {
         if (!endpoint || typeof endpoint !== 'string') {
            throw new Error('Invalid endpoint URL');
         }
        try {
             return await fetchJson(endpoint);
        } catch (error: unknown) {
            console.error(`Failed to fetch info from ${endpoint}:`, error);
            throw new Error(`Could not get endpoint info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Updated to accept optional rpcUrl
    async buy(
        walletAddress: string,
        amount: bigint,
        pkey: string,
        chain: 'eth' | 'sol' | 'base', // Chain is now required to choose handler
        rpcUrl?: string, // Optional RPC URL
        tokenAddress?: string,
        fastMode?: boolean
    ): Promise<string> { // Returns tx hash
        const handler = this.handlers[chain];
        if (!handler) {
            throw new Error(`Unsupported chain: ${chain}`);
        }
        if (amount <= 0n) {
             throw new Error('Amount must be positive.');
        }
        // Pass rpcUrl to the handler
        return handler.buy(walletAddress, amount, pkey, rpcUrl, tokenAddress, fastMode);
    }

     // Use helper function
    async txResponse(
        endpoint: string,
        txHash: string,
        opts: TxResponseOptions = {}
    ): Promise<any> {
         if (!endpoint || typeof endpoint !== 'string') {
            throw new Error('Invalid endpoint URL');
         }
         if (!txHash || typeof txHash !== 'string') {
             throw new Error('Invalid transaction hash');
         }

        const url = new URL(endpoint);
        // Append txHash respecting existing query params
        url.searchParams.append('txHash', txHash);

        try {
             return await fetchJson(url.toString(), {
                method: opts.method || 'GET', // Default to GET if not specified
                headers: {'Content-Type': 'application/json'}, // Assume JSON body if data exists
                 body: opts.data ? JSON.stringify(opts.data) : undefined
             });
        } catch (error: unknown) {
            console.error(`Failed to get txResponse from ${endpoint} for tx ${txHash}:`, error);
            throw new Error(`Could not get transaction response: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Updated to accept optional rpcUrl
    async infoBuyResponse(
        endpoint: string,
        pkey: string,
        rpcUrl?: string, // Optional RPC URL
        opts: TxResponseOptions & { fastMode?: boolean } = {}
    ): Promise<any> {
        console.log(`Starting infoBuyResponse for endpoint: ${endpoint}`);
        // 1. Get Info
        const info = await this.info(endpoint);
        console.log("Received info:", info);

        const { requiredAmount, walletAddress, chain, tokenAddress } = info;

        if (!chain || !this.handlers[chain]) {
             throw new Error(`Unsupported chain specified by endpoint: ${chain}`);
        }

        // Convert required amount string (assuming decimals handled by endpoint info) to bigint
        let amountBigInt: bigint;
         try {
             // Assume requiredAmount is in native smallest units (wei, lamports)
             amountBigInt = BigInt(requiredAmount);
             if (amountBigInt <= 0n) {
                 throw new Error('Required amount must be positive.');
             }
         } catch (e) {
             throw new Error(`Invalid requiredAmount format: ${requiredAmount}`);
         }

        console.log(`Attempting payment: Chain=${chain}, To=${walletAddress}, Amount=${amountBigInt.toString()}, Token=${tokenAddress || 'Native'}`);

        // 2. Perform Buy (Payment)
        const txHash = await this.buy(
            walletAddress,
            amountBigInt,
            pkey,
            chain, // Pass the chain from info
            rpcUrl, // Pass optional rpcUrl
            tokenAddress,
            opts.fastMode
        );
        console.log(`Transaction sent: ${txHash}`);

        // 3. Get Tx Response
        // Add a small delay before fetching the response, especially for non-fast mode
        if (!opts.fastMode) {
             await new Promise(resolve => setTimeout(resolve, 3000)); // 3-second delay
         } else {
             await new Promise(resolve => setTimeout(resolve, 500)); // Shorter delay for fast mode
         }

        console.log(`Fetching response for tx: ${txHash}`);
        return this.txResponse(endpoint, txHash, opts);
    }
}

const apiNow = new ApiNow();
export default apiNow;
// Export types and interfaces if needed for consumers
export type { InfoResponse, TxResponseOptions }; 