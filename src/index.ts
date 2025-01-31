import { ethers } from 'ethers';
import fetch from 'node-fetch';
import { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  Keypair,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { 
  createTransferInstruction, 
  getAssociatedTokenAddress, 
  TOKEN_PROGRAM_ID,
  getMint 
} from '@solana/spl-token';
import bs58 from 'bs58';

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

interface ChainHandler {
  buy(
    walletAddress: string,
    amount: bigint,
    pkey: string,
    rpc: string,
    tokenAddress?: string,
    fastMode?: boolean
  ): Promise<string>;
}

class EthereumHandler implements ChainHandler {
  async buy(
    walletAddress: string,
    amount: bigint,
    pkey: string,
    rpc: string,
    tokenAddress?: string,
    fastMode?: boolean
  ): Promise<string> {
    if (!rpc || typeof rpc !== 'string') {
      throw new Error('Invalid RPC URL');
    }

    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      throw new Error('Invalid wallet address');
    }

    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(pkey, provider);
    
    try {
      await provider.getNetwork();
      
      const balance = await provider.getBalance(wallet.address);
      console.log('Sender balance:', ethers.formatEther(balance), 'ETH');
      
      const nonce = await provider.getTransactionCount(wallet.address, 'latest');
      
      const gasLimit = wallet.address.toLowerCase() === walletAddress.toLowerCase() 
        ? 30000
        : 21000;

      if (tokenAddress) {
        const abi = ["function transfer(address to, uint256 amount) returns (bool)"];
        const tokenContract = new ethers.Contract(tokenAddress, abi, wallet);
        const tx = await tokenContract.transfer(walletAddress, amount);
        return tx.hash;
      } else {
        const tx = await wallet.sendTransaction({
          to: walletAddress,
          value: amount,
          type: 2,
          maxFeePerGas: ethers.parseUnits('0.1', 'gwei'),
          maxPriorityFeePerGas: ethers.parseUnits('0.1', 'gwei'),
          gasLimit,
          nonce
        });
        return tx.hash;
      }
    } catch (error: unknown) {
      console.error('Detailed error:', error);
      throw new Error(
        `Transaction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

class SolanaHandler implements ChainHandler {
  private async sendWithRetry(
    connection: Connection,
    transaction: Transaction,
    senderKeypair: Keypair,
    fastMode: boolean,
    maxAttempts = 3
  ): Promise<string> {
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`\nAttempt ${attempt}/${maxAttempts}`);
        
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
        console.log('Got blockhash:', blockhash.slice(0, 10) + '...');
        
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        transaction.feePayer = senderKeypair.publicKey;
        
        transaction.signatures = [];
        transaction.sign(senderKeypair);
        
        const rawTx = transaction.serialize();
        
        const signature = await connection.sendRawTransaction(rawTx, {
          skipPreflight: false,
          maxRetries: 1,
          preflightCommitment: 'processed'
        });
        console.log('Transaction sent! Signature:', signature);

        if (!fastMode) {
          console.log('Waiting for confirmation...');
          let confirmationAttempt = 1;
          while (confirmationAttempt <= 5) {
            try {
              console.log(`Confirmation attempt ${confirmationAttempt}/5`);
              await connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight
              }, 'processed');
              console.log('Transaction confirmed!');
              return signature;
            } catch (confirmError) {
              console.log('Confirmation failed:', confirmError.message);
              if (confirmationAttempt === 5) throw confirmError;
              confirmationAttempt++;
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }

        return signature;
      } catch (error) {
        console.log('Attempt failed:', error.message);
        lastError = error;
        if (attempt < maxAttempts) {
          console.log('Waiting 500ms before retry...');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    throw lastError;
  }

  async buy(
    walletAddress: string,
    amount: bigint,
    pkey: string,
    rpc: string,
    tokenAddress?: string,
    fastMode?: boolean
  ): Promise<string> {
    const connection = new Connection(rpc, {
      commitment: 'processed',
      confirmTransactionInitialTimeout: 10000
    });

    try {
      const recipientPubkey = new PublicKey(walletAddress);
      const senderKeypair = Keypair.fromSecretKey(bs58.decode(pkey));

      const transaction = new Transaction();

      // Add priority fee instruction
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 50000
        })
      );

      if (tokenAddress) {
        const mint = new PublicKey(tokenAddress);
        const senderATA = await getAssociatedTokenAddress(mint, senderKeypair.publicKey);
        const recipientATA = await getAssociatedTokenAddress(mint, recipientPubkey);

        // Get token decimals
        const mintInfo = await getMint(connection, mint);
        console.log('Token decimals:', mintInfo.decimals);
        console.log('Original amount:', amount.toString());
        
        // Don't multiply by decimals since amount is already raw
        transaction.add(
          createTransferInstruction(
            senderATA,
            recipientATA,
            senderKeypair.publicKey,
            Number(amount)  // Use raw amount directly
          )
        );
      } else {
        // SOL transfer
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: senderKeypair.publicKey,
            toPubkey: recipientPubkey,
            lamports: Number(amount)
          })
        );
      }

      return await this.sendWithRetry(connection, transaction, senderKeypair, !!fastMode);

    } catch (error: unknown) {
      console.error('Detailed error:', error);
      throw new Error(
        `Transaction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

class ApiNow {
  private handlers: { [key: string]: ChainHandler } = {
    eth: new EthereumHandler(),
    sol: new SolanaHandler()
  };

  async info(endpoint: string): Promise<InfoResponse> {
    if (!endpoint.startsWith('https://apinow.fun/api/endpoints/')) {
      throw new Error('Invalid endpoint URL format');
    }

    console.log(`Fetching info from ${endpoint}`);
    const response = await fetch(`${endpoint}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch endpoint info: ${response.status}`);
    }

    return response.json() as Promise<InfoResponse>;
  }

  async buy(
    walletAddress: string,
    amount: bigint,
    pkey: string,
    rpc: string,
    chain: 'eth' | 'sol' = 'eth',
    tokenAddress?: string,
    fastMode?: boolean
  ): Promise<string> {
    const handler = this.handlers[chain];
    if (!handler) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    return handler.buy(walletAddress, amount, pkey, rpc, tokenAddress, fastMode);
  }

  async txResponse(
    endpoint: string,
    txHash: string,
    opts: TxResponseOptions = {}
  ): Promise<any> {
    if (!endpoint.startsWith('https://apinow.fun/api/endpoints/')) {
      throw new Error('Invalid endpoint URL format');
    }

    console.log('txResponse:', { endpoint, txHash, ...opts });

    const options = {
      method: opts.method || 'GET',
      headers: { 
        'x-transaction-hash': txHash,
        ...(opts.data && { 'Content-Type': 'application/json' })
      },
      ...(opts.data && { body: JSON.stringify(opts.data) })
    };

    const response = await fetch(endpoint, options);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    return response.json();
  }

  async infoBuyResponse(
    endpoint: string,
    pkey: string,
    rpc: string,
    opts: TxResponseOptions & { fastMode?: boolean } = {}
  ): Promise<any> {
    const info = await this.info(endpoint);
    const amount = info.chain === 'sol' 
      ? BigInt(Math.round(Number(info.requiredAmount) * LAMPORTS_PER_SOL))
      : ethers.parseEther(info.requiredAmount);
    
    const txHash = await this.buy(
      info.walletAddress,
      amount,
      pkey,
      rpc,
      info.chain,
      info.tokenAddress,
      opts.fastMode
    );

    console.log('infoBuyResponse:', { endpoint, txHash, ...opts });
    const response = await this.txResponse(endpoint, txHash, {
      method: opts.method || info.httpMethod,
      data: opts.data
    });
    console.log('response:', response);
    return response;
  }
}

export default new ApiNow(); 