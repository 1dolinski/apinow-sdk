import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const APINOW_BASE = 'https://apinow.fun';

// ─── Public Types ───

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, any>;
  headers?: Record<string, string>;
}

export interface ExternalCallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, any>;
  headers?: Record<string, string>;
}

export interface PriceDiscovery {
  url: string;
  method: string;
  isX402: boolean;
  upstreamPrice: string;
  proxyFee: string;
  totalPrice: string;
  network: string;
  upstreamAccepts: any[];
}

export interface ApinowConfig {
  privateKey: `0x${string}`;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface GenerateUIOptions {
  endpointName: string;
  namespace: string;
  description?: string;
  querySchema?: any;
  responseSchema?: any;
  examples?: any[];
  customPrompt?: string;
}

export interface GeneratedUI {
  _id: string;
  endpointKey: string;
  endpointName: string;
  namespace: string;
  source: Record<string, string> | null;
  status: 'generating' | 'complete' | 'error';
  errorMessage?: string;
  customPrompt: string;
  model: string;
  generatedBy: string | null;
  openCount: number;
  likes: string[];
  dislikes: string[];
  comments: Array<{ wallet: string; text: string; createdAt: string }>;
  createdAt: string;
}

// ─── SDK ───

// Prevent undici (Node 20+ / Vercel) from crashing when @x402/fetch retries
// a POST with a cloned Request body stream and the server returns a 3xx redirect.
function makeSafeFetch(baseFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  const safeFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request) {
      return baseFetch(new Request(input, { redirect: 'manual' }), init);
    }
    return baseFetch(input, { ...init, redirect: 'manual' });
  }) as typeof globalThis.fetch;
  return safeFetch;
}

async function followRedirects(res: Response): Promise<Response> {
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (location) return fetch(location, { redirect: 'manual' });
  }
  return res;
}

export function createClient(config: ApinowConfig) {
  const { privateKey, baseUrl = APINOW_BASE, fetch: customFetch } = config;

  const account = privateKeyToAccount(privateKey);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  const safeFetch = makeSafeFetch(customFetch ?? fetch);
  const rawFetchWithPayment = wrapFetchWithPayment(safeFetch, client);
  const fetchWithPayment = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await rawFetchWithPayment(input, init);
    return followRedirects(res);
  }) as typeof globalThis.fetch;

  /**
   * Produce an `Authorization: Bearer <msg>||<sig>||<addr>` header signed by
   * the wallet's private key. Backend verifies with ethers.recoverAddress and
   * rejects messages older than ~10 min.
   *
   * Exposed as a public helper so agents can sign custom write calls too.
   */
  async function signAuthHeader(): Promise<Record<string, string>> {
    const issuedAt = new Date().toISOString();
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const message = `APINow auth\naddress: ${account.address}\nissuedAt: ${issuedAt}\nnonce: ${nonce}`;
    const signature = await account.signMessage({ message });
    return {
      Authorization: `Bearer ${message}||${signature}||${account.address}`,
      'x-wallet-address': account.address,
    };
  }

  /**
   * Fetch wrapper that signs write requests with the wallet private key.
   * Use for any non-paid mutating API (endpoint/workflow/version CRUD).
   */
  async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const authHeaders = await signAuthHeader();
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    return res;
  }

  async function authedJson(url: string, init: RequestInit = {}): Promise<any> {
    const res = await authedFetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`APINow ${res.status}: ${text}`);
    }
    return res.json();
  }

  return {
    wallet: account.address,

    /**
     * Produce a signed `Authorization` header for custom write calls.
     * Pairs with `x-wallet-address`. Backend accepts msg within ~10 min.
     */
    signAuthHeader,

    /**
     * Call any APINow endpoint. Handles x402 payment automatically.
     *
     * @example
     * const data = await apinow.call('/api/endpoints/apinowfun/translate', {
     *   method: 'POST',
     *   body: { text: 'Hello world', targetLanguage: 'es' },
     * });
     */
    async call(endpoint: string, opts: CallOptions = {}): Promise<any> {
      const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
      const method = opts.method || 'POST';

      const fetchOpts: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...opts.headers,
        },
      };

      if (opts.body && method !== 'GET') {
        fetchOpts.body = JSON.stringify(opts.body);
      }

      const res = await fetchWithPayment(url, fetchOpts);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`APINow ${res.status}: ${text}`);
      }

      return res.json();
    },

    /**
     * Semantic search across all APINow endpoints.
     */
    async search(query: string, limit = 10): Promise<any> {
      return this.call(`${baseUrl}/api/endpoints/apinowfun/endpoint-search`, {
        method: 'POST',
        body: { query, limit },
      });
    },

    /**
     * Get public endpoint info (free, no payment).
     */
    async info(namespace: string, endpointName: string): Promise<any> {
      const res = await fetch(`${baseUrl}/api/endpoints/${namespace}/${endpointName}/details`);
      if (!res.ok) throw new Error(`Failed to fetch info: ${res.status}`);
      return res.json();
    },

    // ─── Endpoint CRUD ───

    async createEndpoint(config: {
      namespace: string;
      endpointName: string;
      url: string;
      description: string;
      httpMethod: 'GET' | 'POST';
      paymentOptions: Array<{ amount?: string; usdAmount?: string; tokenAddress?: string; tokenSymbol?: string }>;
      chain?: string;
      querySchema?: any;
      responseSchema?: any;
      exampleQuery?: any;
      exampleOutput?: any;
      docsUrl?: string;
    }): Promise<any> {
      return authedJson(`${baseUrl}/api/endpoints`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
    },

    async getEndpoint(id: string): Promise<any> {
      const res = await fetch(`${baseUrl}/api/endpoints/${id}`);
      if (!res.ok) throw new Error(`Failed to get endpoint: ${res.status}`);
      return res.json();
    },

    async updateEndpoint(id: string, updates: Record<string, any>): Promise<any> {
      return authedJson(`${baseUrl}/api/endpoints/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    },

    async deleteEndpoint(id: string): Promise<any> {
      return authedJson(`${baseUrl}/api/endpoints/${id}`, { method: 'DELETE' });
    },

    async listEndpoints(opts: { limit?: number; sortBy?: string; namespace?: string; search?: string } = {}): Promise<any> {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.sortBy) params.set('sortBy', opts.sortBy);
      if (opts.namespace) params.set('namespace', opts.namespace);
      if (opts.search) params.set('search', opts.search);
      const res = await fetch(`${baseUrl}/api/endpoints?${params}`);
      if (!res.ok) throw new Error(`Failed to list endpoints: ${res.status}`);
      return res.json();
    },

    // ─── Workflows ───

    /**
     * List workflows. Optionally filter by creator or status.
     */
    async listWorkflows(opts: { creator?: string; status?: string; limit?: number } = {}): Promise<any> {
      const params = new URLSearchParams();
      if (opts.limit) params.set('limit', String(opts.limit));
      if (opts.creator) params.set('creator', opts.creator);
      if (opts.status) params.set('status', opts.status);
      const res = await fetch(`${baseUrl}/api/workflows?${params}`);
      if (!res.ok) throw new Error(`Failed to list workflows: ${res.status}`);
      return res.json();
    },

    /**
     * Get workflow details by ID.
     */
    async getWorkflow(workflowId: string): Promise<any> {
      const res = await fetch(`${baseUrl}/api/workflows/${workflowId}`);
      if (!res.ok) throw new Error(`Failed to get workflow: ${res.status}`);
      return res.json();
    },

    async createWorkflow(config: {
      name?: string;
      description?: string;
      graph?: { nodes: Array<{ id: string; endpoint: string; inputMapping: any; dependsOn: string[] }>; outputNode: string; outputMapping?: any };
      prompt?: string;
      totalPrice?: string;
      splits?: Array<{ address: string; basisPoints: number; label?: string; tokenAddress?: string }>;
      chain?: string;
    }): Promise<any> {
      return authedJson(`${baseUrl}/api/workflows`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
    },

    async updateWorkflow(workflowId: string, updates: Record<string, any>): Promise<any> {
      return authedJson(`${baseUrl}/api/workflows/${workflowId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    },

    async deleteWorkflow(workflowId: string): Promise<any> {
      return authedJson(`${baseUrl}/api/workflows/${workflowId}`, { method: 'DELETE' });
    },

    /**
     * List workflows you created (convenience for `listWorkflows({ creator: yourWallet })`).
     */
    async listMyWorkflows(opts: { status?: string; limit?: number } = {}): Promise<any> {
      return this.listWorkflows({ ...opts, creator: account.address });
    },

    // ─── Workflow Versions ───

    /**
     * List all versions of a workflow (public, free).
     */
    async listWorkflowVersions(workflowId: string): Promise<{ versions: any[] }> {
      const res = await fetch(`${baseUrl}/api/workflows/${workflowId}/versions`);
      if (!res.ok) throw new Error(`Failed to list versions: ${res.status}`);
      return res.json();
    },

    /**
     * Get a specific workflow version by versionId or numeric version.
     */
    async getWorkflowVersion(workflowId: string, versionIdOrNumber: string | number): Promise<any> {
      const res = await fetch(
        `${baseUrl}/api/workflows/${workflowId}/versions/${versionIdOrNumber}`,
      );
      if (!res.ok) throw new Error(`Failed to get version: ${res.status}`);
      return res.json();
    },

    /**
     * Create a new workflow version (creator only). Defaults to setting it as default.
     * Omit fields to inherit from current workflow.
     */
    async createWorkflowVersion(
      workflowId: string,
      updates: {
        graph?: { nodes: any[]; outputNode: string; outputMapping?: any };
        totalPrice?: string;
        splits?: Array<{ address: string; basisPoints: number; label?: string; tokenAddress?: string }>;
        mermaidDiagram?: string;
        executionMode?: 'balanced' | 'optimistic' | 'settle_first';
        changelog?: string;
        setDefault?: boolean;
        forkedFrom?: string;
      } = {},
    ): Promise<any> {
      return authedJson(`${baseUrl}/api/workflows/${workflowId}/versions`, {
        method: 'POST',
        body: JSON.stringify(updates),
      });
    },

    /**
     * Set a version as the default (active) for a workflow. Also rolls the
     * workflow's graph/price/splits back to that version's snapshot.
     */
    async setDefaultWorkflowVersion(workflowId: string, versionIdOrNumber: string | number): Promise<any> {
      return authedJson(
        `${baseUrl}/api/workflows/${workflowId}/versions/${versionIdOrNumber}`,
        {
          method: 'PUT',
          body: JSON.stringify({ setDefault: true }),
        },
      );
    },

    async deleteWorkflowVersion(workflowId: string, versionIdOrNumber: string | number): Promise<any> {
      return authedJson(
        `${baseUrl}/api/workflows/${workflowId}/versions/${versionIdOrNumber}`,
        { method: 'DELETE' },
      );
    },

    /**
     * Run a workflow. Handles x402 payment automatically.
     *
     * @example
     * const result = await apinow.runWorkflow('90931d9c8fb94df9', { query: 'hello world' });
     */
    async runWorkflow(workflowId: string, input: Record<string, any>): Promise<any> {
      return this.call(`/api/workflows/${workflowId}/run`, {
        method: 'POST',
        body: input,
      });
    },

    // ─── User Factory ───

    /**
     * Check $APINOW token balance and factory access.
     */
    async factoryBalance(): Promise<any> {
      return authedJson(`${baseUrl}/api/user-factory/check-balance`);
    },

    /**
     * List your user-factory endpoints.
     */
    async factoryList(): Promise<any> {
      return authedJson(`${baseUrl}/api/user-factory`);
    },

    /**
     * Generate endpoint config from a natural-language idea.
     */
    async factoryGenerate(idea: string): Promise<any> {
      return authedJson(`${baseUrl}/api/user-factory/generate`, {
        method: 'POST',
        body: JSON.stringify({ idea }),
      });
    },

    /**
     * Create an LLM endpoint via user-factory.
     */
    async factoryCreate(config: {
      name: string;
      prompt: string;
      namespace?: string;
      description?: string;
      model?: string;
      usdcPrice?: string;
      recipientWallet?: string;
      inputParams?: Array<{ name: string; type: string; description?: string }>;
      outputParams?: Array<{ name: string; type: string; description?: string }>;
    }): Promise<any> {
      return authedJson(`${baseUrl}/api/user-factory`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
    },

    /**
     * Create a markup workflow wrapping an existing endpoint.
     * Optionally allocate a portion of the markup to a token buy split.
     */
    async factoryMarkup(opts: {
      endpointId: string;
      markupPercent?: number;
      workflowName?: string;
      tokenBuyPercent?: number;
      tokenBuyRecipient?: string;
      tokenBuyCA?: string;
      markupRecipient?: string;
    }): Promise<any> {
      return authedJson(`${baseUrl}/api/user-factory/markup`, {
        method: 'POST',
        body: JSON.stringify(opts),
      });
    },

    /**
     * Test-call an endpoint without payment (free, server-side LLM call).
     */
    async factoryTestCall(opts: {
      namespace: string;
      endpointName: string;
      input?: any;
      saveExample?: boolean;
    }): Promise<any> {
      return authedJson(`${baseUrl}/api/user-factory/test-call`, {
        method: 'POST',
        body: JSON.stringify(opts),
      });
    },

    // ─── Factory Pipeline ───

    /**
     * Full pipeline: generate config from idea → create endpoint → test → optional markup workflow.
     * Returns { draft, endpoint, testOutput, workflow? }.
     *
     * @example
     * const result = await apinow.factoryPipeline('Score startup pitches on 8 criteria', {
     *   recipientWallet: '0x...',
     *   markup: { markupPercent: 30, markupRecipient: '0x...' },
     * });
     * console.log(result.endpoint.namespace + '/' + result.endpoint.endpointName);
     * console.log(result.workflow?.viewUrl);
     */
    async factoryPipeline(
      idea: string,
      opts: {
        recipientWallet?: string;
        model?: string;
        usdcPrice?: string;
        markup?: {
          markupPercent?: number;
          markupAmount?: number;
          markupRecipient?: string;
          tokenBuyPercent?: number;
          tokenBuyRecipient?: string;
          tokenBuyCA?: string;
        };
        skipTest?: boolean;
      } = {},
    ): Promise<{
      draft: any;
      endpoint: any;
      testOutput: any;
      workflow: any;
    }> {
      const draft = await this.factoryGenerate(idea);

      const createConfig: any = {
        name: draft.name,
        prompt: draft.prompt,
        description: draft.description,
        model: opts.model || draft.model || 'google/gemini-2.0-flash-001',
        usdcPrice: opts.usdcPrice || draft.suggestedPrice || '0.01',
        inputParams: draft.inputParams,
        outputParams: draft.outputParams,
      };
      if (opts.recipientWallet) createConfig.recipientWallet = opts.recipientWallet;
      const createData = await this.factoryCreate(createConfig);
      const endpoint = createData.endpoint;

      let testOutput = null;
      if (!opts.skipTest) {
        const testInput = draft.exampleInput || { prompt: 'test' };
        const testData = await this.factoryTestCall({
          namespace: endpoint.namespace,
          endpointName: endpoint.endpointName,
          input: testInput,
          saveExample: true,
        });
        testOutput = testData.output;
      }

      let workflow = null;
      if (opts.markup) {
        const markupData = await this.factoryMarkup({
          endpointId: endpoint.id,
          ...opts.markup,
        });
        workflow = markupData.workflow;
      }

      return { draft, endpoint, testOutput, workflow };
    },

    // ─── AI UI Generation ───

    /**
     * Start generating an AI UI for an endpoint. Returns immediately with a doc ID.
     * Poll with getGeneratedUI() or use generateUIAndWait() for convenience.
     */
    async generateUI(opts: GenerateUIOptions): Promise<{ id: string; status: string }> {
      const res = await fetch(`${baseUrl}/api/ai/generate-ui`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...opts, walletAddress: account.address }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to generate UI: ${res.status} ${text}`);
      }
      return res.json();
    },

    /**
     * Get a generated UI by ID (use to poll status after generateUI).
     */
    async getGeneratedUI(id: string): Promise<GeneratedUI> {
      const res = await fetch(`${baseUrl}/api/ai/generate-ui?id=${encodeURIComponent(id)}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to get generated UI: ${res.status} ${text}`);
      }
      return res.json();
    },

    /**
     * List generated UIs for an endpoint.
     */
    async listGeneratedUIs(endpointKey: string, sort: 'popular' | 'recent' = 'popular'): Promise<{ uis: GeneratedUI[] }> {
      const params = new URLSearchParams({ endpointKey, sort });
      const res = await fetch(`${baseUrl}/api/ai/generate-ui?${params}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to list generated UIs: ${res.status} ${text}`);
      }
      return res.json();
    },

    /**
     * Check free-tier UI generation eligibility for a wallet.
     */
    async checkFreeUI(): Promise<{ free: boolean; remaining: number }> {
      const params = new URLSearchParams({ checkFree: '1', wallet: account.address });
      const res = await fetch(`${baseUrl}/api/ai/generate-ui?${params}`);
      if (!res.ok) throw new Error(`Failed to check free tier: ${res.status}`);
      return res.json();
    },

    /**
     * Like, dislike, or comment on a generated UI.
     */
    async reactToUI(id: string, action: 'like' | 'dislike' | 'comment', comment?: string): Promise<any> {
      const body: any = { id, action, wallet: account.address };
      if (comment) body.comment = comment;
      const res = await fetch(`${baseUrl}/api/ai/generate-ui`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to react to UI: ${res.status} ${text}`);
      }
      return res.json();
    },

    /**
     * Delete a generated UI (must be creator or admin).
     */
    async deleteGeneratedUI(id: string): Promise<{ deleted: boolean }> {
      const res = await fetch(`${baseUrl}/api/ai/generate-ui`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, wallet: account.address }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to delete UI: ${res.status} ${text}`);
      }
      return res.json();
    },

    /**
     * Generate a UI and poll until complete or error. Returns the final GeneratedUI doc.
     * @param opts - generation params
     * @param pollIntervalMs - polling interval (default 3000ms)
     * @param timeoutMs - max wait time (default 120000ms)
     */
    async generateUIAndWait(
      opts: GenerateUIOptions,
      pollIntervalMs = 3000,
      timeoutMs = 120000,
    ): Promise<GeneratedUI> {
      const { id } = await this.generateUI(opts);
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const doc = await this.getGeneratedUI(id);
        if (doc.status === 'complete' || doc.status === 'error') return doc;
      }

      throw new Error(`UI generation timed out after ${timeoutMs / 1000}s (id: ${id})`);
    },

    // ─── External x402 Proxy ───

    /**
     * Discover the x402 price for any external URL without executing it.
     * Free — no payment required.
     *
     * @example
     * const price = await apinow.discoverPrice('https://stablesocial.dev/api/tiktok/profile');
     * console.log(price.totalPrice); // "$0.070000"
     */
    async discoverPrice(url: string, method?: string): Promise<PriceDiscovery> {
      const params = new URLSearchParams({ url });
      if (method) params.set('method', method);
      const res = await fetch(`${baseUrl}/api/x402-proxy?${params}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Discovery failed: ${res.status} ${text}`);
      }
      return res.json();
    },

    /**
     * Call any external x402 endpoint through the APINow proxy.
     * Handles payment automatically: you pay APINow (upstream price + proxy fee),
     * and APINow pays the upstream service with its server wallet.
     *
     * @example
     * const data = await apinow.callExternal('https://stablesocial.dev/api/tiktok/profile', {
     *   method: 'POST',
     *   body: { handle: 'someuser' },
     * });
     */
    async callExternal(url: string, opts: ExternalCallOptions = {}): Promise<any> {
      const params = new URLSearchParams({ url });
      if (opts.method) params.set('method', opts.method);
      return this.call(`/api/x402-proxy?${params}`, {
        method: 'POST',
        body: opts.body,
        headers: opts.headers,
      });
    },

    /**
     * The underlying x402-wrapped fetch, for advanced use.
     */
    fetch: fetchWithPayment,
  };
}

export default createClient;
