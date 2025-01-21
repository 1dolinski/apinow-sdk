import { ethers } from 'ethers';
import fetch from 'node-fetch';

interface TxResponseOptions {
  method?: string;
  data?: any;
}

interface InfoResponse {
  requiredEth: string;
  walletAddress: string;
  httpMethod: string;
}

class ApiNow {
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
    rpc: string
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

      const tx = await wallet.sendTransaction({
        to: walletAddress,
        value: amount,
        type: 2,
        maxFeePerGas: ethers.parseUnits('0.1', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('0.1', 'gwei'),
        gasLimit,
        nonce
      });

      console.log('tx:', JSON.stringify(tx));
      console.log('Transaction sent:', tx.hash);
      
      return tx.hash;
      
    } catch (error: unknown) {
      console.error('Detailed error:', error);
      throw new Error(
        `Transaction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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
    opts: TxResponseOptions = {}
  ): Promise<any> {
    const info = await this.info(endpoint);
    const amount = ethers.parseEther(info.requiredEth);
    
    const txHash = await this.buy(
      info.walletAddress,
      amount,
      pkey,
      rpc
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