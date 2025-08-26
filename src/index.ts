console.log('[sdk] SDK v1.1 loaded. This version includes header parsing and extensive logging.');
import { ethers, Contract, Wallet, JsonRpcProvider, TransactionRequest, parseUnits, AbiCoder, keccak256, isAddress } from 'ethers';
import fetch, { RequestInit as NodeFetchRequestInit } from 'node-fetch'; // Import node-fetch and its RequestInit

// Default RPC URLs
const DEFAULT_ETH_RPC = 'https://rpc.ankr.com/eth';
const DEFAULT_BASE_RPC = 'https://mainnet.base.org';

interface TxResponseOptions {
    method?: string;
    data?: any;
    signature?: string;
}

interface InfoResponse {
    requiredAmount: string;
    walletAddress: string;
    httpMethod: string;
    tokenAddress?: string;
    chain: 'eth' | 'base';
    decimals?: number;
}

// New interfaces for x402 flow
interface X402PaymentOption {
    tokenAddress: string;
    symbol: string;
    amount?: string; // Optional: Either amount or usdAmount should be present
    usdAmount?: string; // New: Amount in USD
    decimals: number;
}

interface X402PaymentInfo {
    challenge: string;
    chain: 'eth' | 'base';
    recipientAddress: string;
    options: X402PaymentOption[];
}

interface X402PaymentConfig {
    preferredTokens?: string[];
    swapFromAssets?: { symbol: string; address: string; }[];
    slippagePercentage?: string;
}

interface ZeroXPriceResponse {
    buyAmount: string;
    sellAmount: string;
}

interface ZeroXSimplePriceResponse {
    price: string;
}

const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const CHAIN_CONFIG = {
    '1': { // Ethereum
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        ETH: NATIVE_TOKEN_ADDRESS
    },
    '8453': { // Base
        USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        WETH: '0x4200000000000000000000000000000000000006',
        ETH: NATIVE_TOKEN_ADDRESS
    }
};

// --- Helper function for fetch (Keep this) ---
async function fetchJson(url: string, options?: NodeFetchRequestInit): Promise<any> {
    console.error(`fetchJson (using node-fetch): Called with URL: ${url}`);

    // Safer logging for options to avoid mutating Uint8Array body
    if (options) {
        const { body, ...optionsWithoutBody } = options; // Destructure to separate body for logging
        console.error(`fetchJson (using node-fetch): Called with options (metadata):`, JSON.stringify(optionsWithoutBody, null, 2));

        if (options.headers) { // Log headers from original options
            const headers = options.headers as Record<string, string>;
            const contentLengthHeader = headers['Content-Length'] || headers['content-length'];
            console.error(`fetchJson (using node-fetch): Content-Length in options.headers before fetch: ${contentLengthHeader}`);
        }

        if (body) {
            // For node-fetch, string or Buffer bodies are common.
            // If we are passing a string, its length in bytes is what Content-Length should be.
            // If it's a Buffer, Buffer.length.
            if (typeof body === 'string'){
                console.error(`fetchJson (using node-fetch): Body in options is string, length: ${body.length}. Snippet (first ~100 chars): ${body.substring(0,100)}`);
            } else if (body instanceof Buffer) {
                 console.error(`fetchJson (using node-fetch): Body in options is Buffer, length: ${body.length}. Snippet (first ~100 bytes as hex): ${body.slice(0,100).toString('hex')}`);
            } else if (body instanceof Uint8Array) {
                // This case should ideally not be hit if txResponse prepares a string or Buffer
                console.error(`fetchJson (using node-fetch): Body in options is Uint8Array, length: ${body.length}.`);
            } else {
                try {
                    console.error(`fetchJson (using node-fetch): Body in options before fetch (first 500 chars): ${String(body).substring(0, 500)}`);
                } catch (e) {
                    console.error(`fetchJson (using node-fetch): Body in options before fetch: (Could not be easily stringified for logging)`);
                }
            }
        } else {
            console.error(`fetchJson (using node-fetch): No body in options.`);
        }
    } else {
        console.error(`fetchJson (using node-fetch): Called with no options.`);
    }

    let response;
    try {
        // @ts-ignore options might not perfectly match node-fetch's expected type if RequestInit from lib.dom.d.ts is too different
        response = await fetch(url, options);
    } catch (networkError: unknown) {
        let requestBodySummary = "No body provided";
        if (options?.body) {
            if (typeof options.body === 'string') {
                requestBodySummary = `String body (len ${options.body.length}): ${options.body.substring(0, 100)}...`;
            } else if (options.body instanceof Buffer) {
                requestBodySummary = `Buffer body (len ${options.body.length})`;
            } else if (options.body instanceof Uint8Array) { // Should not happen with current txResponse
                 requestBodySummary = `Uint8Array body (len ${options.body.length})`;
            } else {
                requestBodySummary = `Body of type ${(options.body as any)?.constructor?.name || 'unknown'}`;
            }
        }
        const errorMessage = `Network/fetch error for URL: ${url}, Method: ${options?.method || 'GET'}, Request: ${requestBodySummary}. Original error: ${networkError instanceof Error ? networkError.message : String(networkError)}`;
        console.error("fetchJson (using node-fetch): Fetch execution error - ", errorMessage);
        throw new Error(errorMessage);
    }

    console.error(`fetchJson (using node-fetch): Response status: ${response.status}, ok: ${response.ok}`);

    if (!response.ok) {
        const errorBodyText = await response.text();
        console.error(`fetchJson (using node-fetch): Error response body for ${url} (status ${response.status}): ${errorBodyText}`);
        
        let requestBodySummary = "No body provided";
        if (options?.body) {
            if (typeof options.body === 'string') {
                requestBodySummary = `String body (len ${options.body.length}): ${options.body.substring(0, 100)}...`;
            } else if (options.body instanceof Buffer) { 
                requestBodySummary = `Buffer body (len ${options.body.length})`;
            } else if (options.body instanceof Uint8Array) { // Should not happen with current txResponse
                 requestBodySummary = `Uint8Array body (len ${options.body.length})`;
            } else {
                requestBodySummary = `Body of type ${(options.body as any)?.constructor?.name || 'unknown'}`;
            }
        }
        const detailedErrorMessage = `HTTP error ${response.status} for URL: ${url}, Method: ${options?.method || 'GET'}, Request: ${requestBodySummary}. Response: ${errorBodyText}`;
        throw new Error(detailedErrorMessage);
    }

    const responseData = await response.json();
    console.error(`fetchJson: Successfully fetched and parsed JSON (first 500 chars): ${JSON.stringify(responseData).substring(0,500)}`);
    return responseData;
}

// Helper to check ERC20 token balance
async function getTokenBalance(
    provider: JsonRpcProvider,
    ownerAddress: string,
    tokenAddress: string
): Promise<bigint> {
    const abi = ["function balanceOf(address owner) view returns (uint256)"];
    const contract = new Contract(tokenAddress, abi, provider);
    try {
        const balance = await contract.balanceOf(ownerAddress);
        return balance;
    } catch (e) {
        console.error(`[sdk] Could not get balance for token ${tokenAddress} (this is expected for invalid tokens in fallback tests). Error: ${e instanceof Error ? e.message : String(e)}`);
        return 0n; // Return 0 if the token address is invalid or another error occurs
    }
}

// Helper to check ERC20 token allowance
async function checkAllowance(
    provider: JsonRpcProvider,
    ownerAddress: string,
    tokenAddress: string,
    spenderAddress: string
): Promise<bigint> {
    const abi = ["function allowance(address owner, address spender) view returns (uint256)"];
    const contract = new Contract(tokenAddress, abi, provider);
    const allowance = await contract.allowance(ownerAddress, spenderAddress);
    return allowance;
}


// New helper for x402 flow
async function fetchWithX402(
    url: string,
    options: RequestInit,
    api: ApiNow, // Pass in the ApiNow instance
    userWalletPrivateKey: string,
    paymentConfig: X402PaymentConfig = {}
): Promise<any> {
    const originalResponse = await fetch(url, options as NodeFetchRequestInit);

    if (originalResponse.status !== 402) {
        if (!originalResponse.ok) {
            const errorBody = await originalResponse.text();
            throw new Error(`HTTP Error ${originalResponse.status}: ${errorBody}`);
        }
        return originalResponse.json();
    }

    console.error("402 Payment Required. Handling payment...");
    
    // --- FIX START: Parse the www-authenticate header instead of the body ---
    const wwwAuthHeader = originalResponse.headers.get('www-authenticate');
    console.log('[sdk] Raw www-authenticate header:', wwwAuthHeader);
    if (!wwwAuthHeader) {
        throw new Error('402 response is missing the www-authenticate header.');
    }

    const l402Match = wwwAuthHeader.match(/L402="([^"]+)"/);
    console.log('[sdk] Regex match for L402 token:', l402Match);
    if (!l402Match || !l402Match[1]) {
        throw new Error('Could not parse L402 token from www-authenticate header.');
    }

    const l402Token = l402Match[1];
    console.log('[sdk] Extracted L402 Base64 token:', l402Token);
    let paymentInfo: X402PaymentInfo;
    try {
        const decodedToken = Buffer.from(l402Token, 'base64').toString('utf8');
        console.log('[sdk] Decoded token (JSON string):', decodedToken);

        const parsedToken = JSON.parse(decodedToken);
        console.log('[sdk] Parsed token (JavaScript object):', JSON.stringify(parsedToken, null, 2));

        // Ensure the parsed token matches the X402PaymentInfo interface
        if (typeof parsedToken === 'object' && parsedToken !== null && 'challenge' in parsedToken && 'chain' in parsedToken && 'recipientAddress' in parsedToken && 'options' in parsedToken && Array.isArray(parsedToken.options)) {
             paymentInfo = parsedToken as X402PaymentInfo;
        } else {
            console.error('[sdk] Parsed token failed validation. Keys:', Object.keys(parsedToken));
            throw new Error('Parsed L402 token is not in the expected X402PaymentInfo format (missing challenge, chain, recipientAddress, or options).');
        }
    } catch (e) {
        console.error('[sdk] Error during token decoding/parsing:', e);
        throw new Error(`Failed to decode or parse L402 token: ${e instanceof Error ? e.message : String(e)}`);
    }
    // --- FIX END ---
    
    // --- NEW FIX START: Select RPC URL based on the parsed chain ---
    const rpcUrl = paymentInfo.chain === 'base' ? DEFAULT_BASE_RPC : DEFAULT_ETH_RPC;
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(userWalletPrivateKey, provider);
    console.log(`[sdk] Using RPC URL for chain "${paymentInfo.chain}": ${rpcUrl}`);
    // --- NEW FIX END ---

    const { 
        challenge, 
        chain,
        recipientAddress,
        options: paymentOptions
    } = paymentInfo;

    let txHash: string | undefined;

    // Define a preference order for payment tokens.
    const preferredTokens = paymentConfig.preferredTokens || ['USDC', 'WETH']; // Default preference

    const sortedOptions = [...paymentOptions].sort((a, b) => {
        const aIndex = preferredTokens.indexOf(a.symbol);
        const bIndex = preferredTokens.indexOf(b.symbol);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });

    const nativeSymbol = chain === 'base' ? 'ETH' : 'ETH'; // Could be more specific
    const nativeOption = sortedOptions.find(o => o.symbol === nativeSymbol);
    if(nativeOption){
        const nativeIndex = sortedOptions.indexOf(nativeOption);
        sortedOptions.splice(nativeIndex, 1);
        sortedOptions.push(nativeOption); // Always try native token last unless specified
    }
    
    for (const option of sortedOptions) {
        const { tokenAddress, amount, decimals, symbol, usdAmount } = option;
        
        let requiredAmount: bigint;

        if (usdAmount) {
            console.log(`[sdk] Option requires a USD value of ${usdAmount}. Fetching price for ${symbol}...`);
            const tokenPriceInUsd = await getUsdcPriceForToken(tokenAddress, chain, decimals);
            const requiredTokens = parseFloat(usdAmount) / tokenPriceInUsd;
            console.log(`[sdk] Current price of ${symbol} is ~$${tokenPriceInUsd.toFixed(4)}. Required tokens: ${requiredTokens}`);
            requiredAmount = parseUnits(requiredTokens.toString(), decimals);
        } else if (amount) {
            requiredAmount = parseUnits(amount, decimals);
        } else {
            console.warn(`[sdk] Skipping payment option for ${symbol} because it has no 'amount' or 'usdAmount'.`);
            continue;
        }
        
        console.log(`[sdk] Checking balance for ${symbol} (${tokenAddress}). Required: ${requiredAmount.toString()}`);
        
        let balance: bigint;
        if (tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
            balance = await provider.getBalance(wallet.address);
        } else {
            balance = await getTokenBalance(provider, wallet.address, tokenAddress);
        }
        
        console.log(`[sdk] Found balance for ${symbol}: ${balance.toString()}`);

        if (balance >= requiredAmount) {
            console.log(`[sdk] Sufficient balance found for ${symbol}. Proceeding with payment.`);
            txHash = await api.buy(
                recipientAddress,
                requiredAmount,
                userWalletPrivateKey,
                chain,
                rpcUrl,
                tokenAddress
            );
            break; 
        }
    }

    if (!txHash) {
        // --- Try to swap ---
        console.log("No direct payment option possible. Attempting to find a swap.");
        
        const chainId = chain === 'base' ? '8453' : '1';
        const defaultSwapAssets = [
            { symbol: 'USDC', address: CHAIN_CONFIG[chainId].USDC },
            { symbol: 'WETH', address: CHAIN_CONFIG[chainId].WETH },
            { symbol: 'ETH', address: CHAIN_CONFIG[chainId].ETH } 
        ];

        const swapHierarchy = paymentConfig.swapFromAssets || defaultSwapAssets;

        for (const targetOption of sortedOptions) {
            for (const sourceAsset of swapHierarchy) {
                try {
                    const quote = await get0xSwapQuote(
                        targetOption.tokenAddress,
                        sourceAsset.address,
                        // --- FIX for USD amounts in swaps ---
                        targetOption.usdAmount ? 
                            (await (async () => {
                                console.log(`[sdk] Swap target requires a USD value of ${targetOption.usdAmount}. Fetching price for ${targetOption.symbol}...`);
                                const tokenPriceInUsd = await getUsdcPriceForToken(targetOption.tokenAddress, chain, targetOption.decimals);
                                const requiredTokens = parseFloat(targetOption.usdAmount!) / tokenPriceInUsd;
                                console.log(`[sdk] Swap target ${targetOption.symbol} price is ~$${tokenPriceInUsd.toFixed(4)}. Required tokens for swap: ${requiredTokens}`);
                                return parseUnits(requiredTokens.toFixed(18), targetOption.decimals); // Use high precision for swap amount
                            })()) :
                            parseUnits(targetOption.amount!, targetOption.decimals), // Use non-null assertion for amount
                        // --- End FIX ---
                        targetOption.decimals,
                        wallet.address,
                        chain,
                        paymentConfig.slippagePercentage
                    );

                    const buyAmount = BigInt(quote.buyAmount);

                    let cost: bigint;
                    let sourceBalance: bigint;

                    if (sourceAsset.address === NATIVE_TOKEN_ADDRESS) {
                        if (!quote.transaction || !quote.transaction.gasPrice || !quote.transaction.gas) {
                             throw new Error('0x quote response for native asset swap is missing transaction details (gas/gasPrice).');
                        }
                        cost = BigInt(quote.sellAmount) + (BigInt(quote.transaction.gasPrice) * BigInt(quote.transaction.gas)); // Correctly reference gasPrice and gas
                        sourceBalance = await provider.getBalance(wallet.address);
                    } else {
                        cost = BigInt(quote.sellAmount);
                        sourceBalance = await getTokenBalance(provider, wallet.address, sourceAsset.address);
                        
                        // Check allowance for the 0x spender contract and approve if necessary
                        const allowance = await checkAllowance(provider, wallet.address, sourceAsset.address, quote.allowanceTarget);
                        if (allowance < cost) {
                            console.log(`Insufficient allowance for ${sourceAsset.symbol}. Approving ${quote.allowanceTarget} now...`);
                            const approveTxHash = await api.approve(
                                wallet,
                                sourceAsset.address,
                                quote.allowanceTarget,
                                cost, // Approve the required amount
                            );
                            console.log(`Approval transaction sent: ${approveTxHash}. Waiting for confirmation...`);
                            const approveReceipt = await provider.waitForTransaction(approveTxHash);
                            if (!approveReceipt || approveReceipt.status === 0) {
                                throw new Error(`Approval transaction for ${sourceAsset.symbol} failed.`);
                            }
                            console.log('✅ Approval confirmed.');
                        }
                    }

                    if (sourceBalance >= cost) {
                        console.log(`Found affordable swap: ${sourceAsset.symbol} -> ${targetOption.symbol}.`);
                        console.log('--- Full 0x Quote Response ---');
                        console.log(JSON.stringify(quote, null, 2));
                        console.log('-----------------------------');
                        
                        // Execute Swap
                        const swapTx = {
                            to: quote.transaction.to,
                            data: quote.transaction.data,
                            value: quote.transaction.value,
                            gasPrice: quote.transaction.gasPrice,
                            gasLimit: quote.transaction.gas, // Add gasLimit from quote
                            nonce: await provider.getTransactionCount(wallet.address, 'latest'),
                            chainId: parseInt(chainId),
                        };
                        console.log("Sending swap transaction...");
                        const signedSwapTx = await wallet.signTransaction(swapTx);
                        const swapTxHash = await provider.send('eth_sendRawTransaction', [signedSwapTx]);
                        console.log(`Swap transaction sent: ${swapTxHash}. Waiting for confirmation...`);
                        
                        const swapReceipt = await provider.waitForTransaction(swapTxHash);
                        if (!swapReceipt || swapReceipt.status === 0) {
                            throw new Error(`Swap transaction failed: ${swapTxHash}`);
                        }
                        console.log('Swap transaction confirmed.');

                        // Execute Payment
                        console.log(`Swap successful. Proceeding with final payment.`);
                        txHash = await api.buy(
                            recipientAddress,
                            buyAmount, // Use the amount from the swap quote
                            userWalletPrivateKey,
                            chain,
                            rpcUrl,
                            targetOption.tokenAddress
                        );
                        break; // Exit the source asset loop
                    }
                } catch (error) {
                    console.error(`Could not get swap quote for ${sourceAsset.symbol} -> ${targetOption.symbol}:`, error instanceof Error ? error.message : String(error));
                    continue; // Try next source asset
                }
            }
            if (txHash) break; // Exit the target option loop
        }

        if (!txHash) {
            throw new Error("Could not find a valid payment or swap option.");
        }
    }

    console.error(`Payment transaction sent: ${txHash}. Waiting for confirmation...`);
    const paymentReceipt = await provider.waitForTransaction(txHash);
    if (!paymentReceipt || paymentReceipt.status === 0) {
        throw new Error(`Final payment transaction failed: ${txHash}`);
    }
    console.log('Final payment transaction confirmed.');

    const signature = await wallet.signMessage(challenge);
    const retryOptions = { ...options };
    (retryOptions.headers as Record<string, string>)['Authorization'] = `X402 ${txHash}:${signature}`;

    console.error(`Retrying request to ${url} with payment proof.`);
    const finalResponse = await fetch(url, retryOptions as NodeFetchRequestInit);

    if (!finalResponse.ok) {
        const errorBody = await finalResponse.text();
        throw new Error(`API request failed after payment: ${errorBody}`);
    }

    return finalResponse.json();
}

async function get0xSwapQuote(
    buyToken: string,
    sellToken: string,
    buyAmount: bigint,
    buyTokenDecimals: number,
    takerAddress: string,
    chain: 'eth' | 'base',
    slippagePercentage: string = '0.01' // Default 1% slippage
): Promise<any> {
    const apiUrl = `https://api.0x.org`;
    const chainId = chain === 'base' ? '8453' : '1';
    const apiKey = process.env.ZERO_X_API_KEY;
    if (!apiKey) {
        throw new Error('ZERO_X_API_KEY is not set in the .env file. Please get a free key from https://dashboard.0x.org/apps');
    }

    const headers = { 
        '0x-api-key': apiKey,
        '0x-version': 'v2' 
    };

    // Step 1: Get a spot price by making a "reverse" lookup.
    // We sell a nominal amount of the buyToken to get a price in terms of the sellToken.
    const nominalSellAmount = parseUnits('1', buyTokenDecimals);
    const priceParams = new URLSearchParams({
        chainId: chainId,
        buyToken: sellToken, // Swapped for reverse lookup
        sellToken: buyToken, // Swapped for reverse lookup
        sellAmount: nominalSellAmount.toString(),
        taker: takerAddress,
    }).toString();

    const priceUrl = `${apiUrl}/swap/permit2/price?${priceParams}`;
    console.log(`[sdk] Fetching 0x spot price with reverse lookup: ${priceUrl}`);
    const priceResponse = await fetch(priceUrl, { headers });
    if (!priceResponse.ok) {
        const errorBody = await priceResponse.text();
        console.error(`[sdk] Full 0x API spot price error response:`, errorBody);
        throw new Error(`Failed to get 0x spot price: ${errorBody}`);
    }
    const priceData = (await priceResponse.json()) as ZeroXPriceResponse;
    if (!priceData.buyAmount || !priceData.sellAmount || BigInt(priceData.sellAmount) === 0n) {
        throw new Error('Could not determine a valid price for the swap. This might be due to low liquidity.');
    }

    // Step 2: Calculate the required sellAmount based on the reverse price quote.
    // The reverse price gives us a ratio of sellToken per buyToken.
    // sellAmount = buyAmount * (priceData.buyAmount / priceData.sellAmount)
    const estimatedSellAmount = (buyAmount * BigInt(priceData.buyAmount)) / BigInt(priceData.sellAmount);

    // Add a slippage buffer to the sell amount to ensure the trade goes through.
    const slippageFactor = 1 + parseFloat(slippagePercentage);
    const finalSellAmount = BigInt(Math.ceil(Number(estimatedSellAmount) * slippageFactor));


    // Step 3: Get the firm quote with the estimated sellAmount.
    const quoteParams = new URLSearchParams({
        chainId: chainId,
        buyToken: buyToken,
        sellToken: sellToken,
        sellAmount: finalSellAmount.toString(),
        taker: takerAddress,
    }).toString();
    
    const quoteUrl = `${apiUrl}/swap/permit2/quote?${quoteParams}`;
    console.error(`Fetching 0x firm quote: ${quoteUrl}`);
    const response = await fetch(quoteUrl, { headers });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[sdk] Full 0x API quote error response for ${quoteUrl}:`, errorBody);
        throw new Error(`Failed to get 0x quote: ${errorBody}`);
    }

    return response.json();
}

// --- New helper to get the USDC price of a token ---
async function getUsdcPriceForToken(
    tokenAddress: string,
    chain: 'eth' | 'base',
    tokenDecimals: number
): Promise<number> {
    if (tokenAddress.toLowerCase() === CHAIN_CONFIG[chain === 'base' ? '8453' : '1'].USDC.toLowerCase()) {
        return 1.0; // USDC is always 1.0 USD
    }

    const apiUrl = `https://api.0x.org`;
    const chainId = chain === 'base' ? '8453' : '1';
    const apiKey = process.env.ZERO_X_API_KEY;
    if (!apiKey) {
        throw new Error('ZERO_X_API_KEY is not set in the .env file for price lookup.');
    }
    const headers = { 
        '0x-api-key': apiKey,
        '0x-version': 'v2' 
    };

    const nominalSellAmount = parseUnits('1', tokenDecimals).toString();

    // We're buying USDC by selling one full unit of the token to find its price.
    const priceParams = new URLSearchParams({
        chainId: chainId,
        buyToken: CHAIN_CONFIG[chainId].USDC,
        sellToken: tokenAddress,
        sellAmount: nominalSellAmount,
    }).toString();

    const priceUrl = `${apiUrl}/swap/permit2/price?${priceParams}`;
    console.log(`[sdk] Fetching USDC price for ${tokenAddress} via 0x: ${priceUrl}`);

    const priceResponse = await fetch(priceUrl, { headers });
    if (!priceResponse.ok) {
        const errorBody = await priceResponse.text();
        throw new Error(`Failed to get 0x price for ${tokenAddress}: ${errorBody}`);
    }

    const priceData = (await priceResponse.json()) as ZeroXPriceResponse;
    
    if (!priceData.buyAmount) {
        throw new Error(`Invalid price response from 0x API: ${JSON.stringify(priceData)}`);
    }

    // The buyAmount is the amount of USDC (6 decimals) we get for 1 full unit of the sellToken.
    const price = parseFloat(ethers.formatUnits(priceData.buyAmount, 6));
    
    if (isNaN(price) || price <= 0) {
        throw new Error(`Could not determine a valid price from 0x API response.`);
    }
    
    return price;
}


// --- Helper function for RPC calls (Keep this) ---
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
    const jsonResponse: any = await response.json();
    if (jsonResponse.error) {
        throw new Error(`RPC error for method ${method}: ${JSON.stringify(jsonResponse.error)}`);
    }
    return jsonResponse.result;
}

interface ChainHandler {
    buy(
        walletAddress: string,
        amount: bigint,
        userWalletPrivateKey: string,
        chain: 'eth' | 'base',
        rpcUrl?: string,
        tokenAddress?: string
    ): Promise<string>;
}

class EthereumHandler implements ChainHandler {
    async buy(
        walletAddress: string,
        amount: bigint,
        userWalletPrivateKey: string,
        chain: 'eth' | 'base',
        rpcUrl?: string,
        tokenAddress?: string
    ): Promise<string> {
        const rpc = rpcUrl || (chain === 'base' ? DEFAULT_BASE_RPC : DEFAULT_ETH_RPC);
        const provider = new JsonRpcProvider(rpc);
        const wallet = new Wallet(userWalletPrivateKey, provider);

        if (!walletAddress || !isAddress(walletAddress)) {
            throw new Error('Invalid recipient wallet address');
        }
        
        try {
            let txRequest: TransactionRequest;

            if (tokenAddress) {
                if (!isAddress(tokenAddress)) {
                    throw new Error('Invalid token address');
                }
                const abi = ["function transfer(address to, uint256 amount)"];
                const iface = new ethers.Interface(abi);
                const data = iface.encodeFunctionData("transfer", [walletAddress, amount]);

                txRequest = {
                    to: tokenAddress,
                    data: data,
                    value: 0
                };
            } else {
                txRequest = {
                    to: walletAddress,
                    value: amount,
                };
            }
            
            const txResponse = await wallet.sendTransaction(txRequest);
            console.error(`Transaction sent: ${txResponse.hash}. Waiting for confirmation...`);
            await txResponse.wait();
            console.error(`Transaction confirmed: ${txResponse.hash}`);
            
            return txResponse.hash;

        } catch (error: unknown) {
            console.error('Detailed ETH error:', error);
            throw new Error(
                `Ethereum transaction failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

class ApiNow {
    private handlers: { [key: string]: ChainHandler } = {
        eth: new EthereumHandler(),
        base: new EthereumHandler()
    };

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

    async buy(
        walletAddress: string,
        amount: bigint,
        userWalletPrivateKey: string,
        chain: 'eth' | 'base',
        rpcUrl?: string,
        tokenAddress?: string,
        fastMode?: boolean
    ): Promise<string> {
        const handler = this.handlers[chain];
        if (!handler) {
            throw new Error(`Unsupported chain: ${chain}`);
        }
        if (amount <= 0n) {
             throw new Error('Amount must be positive.');
        }
        return handler.buy(walletAddress, amount, userWalletPrivateKey, chain, rpcUrl, tokenAddress);
    }

    async execute(
        endpoint: string,
        userWalletPrivateKey: string,
        opts: TxResponseOptions = {},
        paymentConfig: X402PaymentConfig = {}
    ): Promise<any> {
        console.error(`Executing request for endpoint: ${endpoint}`);

        const url = new URL(endpoint);
        const method = (opts.method || 'GET').toUpperCase();

        const fetchOptions: RequestInit = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': '*/*',
            },
        };

        if (opts.data) {
             if (method === 'GET' || method === 'HEAD') {
                const params = new URLSearchParams(opts.data as Record<string, string>);
                params.forEach((value, key) => url.searchParams.append(key, value));
            } else {
                fetchOptions.body = JSON.stringify(opts.data);
            }
        }
       
        return fetchWithX402(url.toString(), fetchOptions, this, userWalletPrivateKey, paymentConfig);
    }

    async approve(
        wallet: Wallet,
        tokenAddress: string,
        spenderAddress: string,
        amount: bigint,
    ): Promise<string> {
        const abi = ["function approve(address spender, uint256 amount)"];
        const contract = new Contract(tokenAddress, abi, wallet);
        const tx = await contract.approve(spenderAddress, amount);
        await tx.wait();
        return tx.hash;
    }

    async txResponse(
        endpoint: string,
        txHash: string,
        opts: TxResponseOptions = {}
    ): Promise<any> {
        console.error(`txResponse: Called with endpoint: ${endpoint}, txHash: ${txHash}, opts:`, JSON.stringify(opts, null, 2));

         if (!endpoint || typeof endpoint !== 'string') {
            console.error('txResponse: Invalid endpoint URL received.');
            throw new Error('Invalid endpoint URL');
         }
         if (!txHash || typeof txHash !== 'string') {
             console.error('txResponse: Invalid transaction hash received.');
             throw new Error('Invalid transaction hash');
         }

        const url = new URL(endpoint);
        // Add txHash as a query parameter
        url.searchParams.append('txHash', txHash);
        console.error(`txResponse: Constructed URL (with txHash query param) for fetch: ${url.toString()}`);

        // Determine method reliably
        const method = (opts.method || 'GET').toUpperCase();
        console.error(`txResponse: Preparing ${method} request to ${endpoint}`);

        const fetchOptions: NodeFetchRequestInit = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
                'X-Transaction-Hash': txHash
            },
            // body is set conditionally below
        };

        if (opts.signature) {
            (fetchOptions.headers as Record<string, string>)['X-Signature'] = opts.signature;
            console.error(`txResponse: Included signature in X-Signature header.`);
        }

        if (method === 'GET' || method === 'HEAD') {
            // --- GET/HEAD: Append data as query params ---
            if (opts.data && typeof opts.data === 'object' && Object.keys(opts.data).length > 0) {
                console.error(`txResponse: Appending data as query params for GET request:`, opts.data);
                // Convert potential non-string values in opts.data to strings for URLSearchParams
                const paramsData: Record<string, string> = {};
                for (const key in opts.data) {
                    if (Object.prototype.hasOwnProperty.call(opts.data, key)) {
                        paramsData[key] = String(opts.data[key]);
                    }
                }
                const params = new URLSearchParams(paramsData);
                params.forEach((value, key) => {
                    url.searchParams.append(key, value);
                });
            }
            // Ensure no body is sent for GET/HEAD
            delete fetchOptions.body; // Or just don't set it
        } else {
            // --- POST/PUT/etc.: Set data as body ---
            if (opts.data) {
                console.error(`txResponse: Setting data as body for ${method} request (to be used with node-fetch):`, opts.data);
                const requestBodyString = JSON.stringify(opts.data);

                fetchOptions.body = requestBodyString; // Use the string as the body for node-fetch
                // Let node-fetch set the Content-Length automatically for string bodies
                // const bodyBytes = new TextEncoder().encode(requestBodyString); 
                // (fetchOptions.headers as Record<string, string>)['Content-Length'] = String(bodyBytes.length);
            }
        }

        try {
             console.error(`txResponse: About to call fetchJson. Final URL: ${url.toString()}, Final fetchOptions:`, JSON.stringify(fetchOptions, null, 2));
             // Use the potentially modified URL and fetchOptions
             const result = await fetchJson(url.toString(), fetchOptions);
             console.error('txResponse: Successfully received response from fetchJson (first 500 chars): ', JSON.stringify(result).substring(0,500));
             return result;
        } catch (error: unknown) {
            console.error(`txResponse: Error during fetchJson call from ${url.toString()} for tx ${txHash} using method ${method}:`, error);
             throw new Error(`Could not get transaction response: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async infoBuyResponse(
        endpoint: string,
        userWalletPrivateKey: string,
        rpcUrl?: string,
        opts: TxResponseOptions & { fastMode?: boolean } = {}
    ): Promise<any> {
        console.error(`Starting infoBuyResponse for endpoint: ${endpoint}`);
        const info = await this.info(endpoint);
        console.error("Received info:", info);

        const { requiredAmount, walletAddress, chain, tokenAddress, decimals } = info;

        if (!chain || !this.handlers[chain]) {
             throw new Error(`Unsupported chain specified by endpoint: ${chain}`);
        }

        let amountBigInt: bigint;
        try {
            // Use info.decimals if available, otherwise default to 18 (for ETH)
            const parseDecimals = (tokenAddress && decimals !== undefined) ? decimals : 18;
            amountBigInt = parseUnits(requiredAmount, parseDecimals); 
            if (amountBigInt <= 0n) {
                throw new Error('Required amount must be positive.');
            }
        } catch (e) {
            throw new Error(`Invalid requiredAmount format or value: ${requiredAmount}. Could not parse with ${ (tokenAddress && decimals !== undefined) ? decimals : 18} decimals.`);
        }

       console.error(`Attempting payment: Chain=${chain}, To=${walletAddress}, Amount=${amountBigInt.toString()}, Token=${tokenAddress || 'Native'}`);

       const txHash = await this.buy(
           walletAddress,
           amountBigInt,
           userWalletPrivateKey,
           chain,
           rpcUrl,
           tokenAddress,
           opts.fastMode
       );
       console.error(`Transaction sent: ${txHash}`);

       const wallet = new Wallet(userWalletPrivateKey);
       const signature = await wallet.signMessage(txHash);
       console.error(`Generated signature for txHash ${txHash}: ${signature}`);

       if (!opts.fastMode) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            await new Promise(resolve => setTimeout(resolve, 500));
        }

       console.error(`Fetching response for tx: ${txHash}`);
       // Create specific options for txResponse
       const txResponseOpts: TxResponseOptions = {
           method: info.httpMethod || 'POST', // Use the method from info, default to POST
           data: opts.data, // Pass the original data payload intended for the API
           signature: signature
       };
       // Call txResponse with the tailored options
       return this.txResponse(endpoint, txHash, txResponseOpts);
   }
}

const apiNow = new ApiNow();
export default apiNow;
export { get0xSwapQuote }; // Export for testing
export type { InfoResponse, TxResponseOptions, X402PaymentInfo, X402PaymentOption, X402PaymentConfig };