#!/usr/bin/env node

import { Command } from 'commander';
import { createClient } from './index.js';
import { privateKeyToAccount } from 'viem/accounts';

const API_BASE = 'https://apinow.fun';

const program = new Command();

program
  .name('apinow')
  .description('CLI for APINow.fun — search, inspect, and call pay-per-request APIs')
  .version('0.27.0');

// ─── Helpers ───

function getPrivateKey(opts: { key?: string }): `0x${string}` {
  const raw = opts.key || process.env.APINOW_WALLET_PKEY || process.env.PRIVATE_KEY;
  if (!raw) {
    console.error('Error: Private key required. Set APINOW_WALLET_PKEY or pass --key');
    process.exit(1);
  }
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

function formatUsd(paymentOptions: any[]): string {
  if (!paymentOptions?.length) return 'free';
  const p = paymentOptions[0];
  const usd = p.usdAmount ?? p.amount ?? 0;
  return `$${Number(usd).toFixed(4)}`;
}

function printTable(rows: string[][]): void {
  if (!rows.length) return;
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((r) => (r[col] || '').length))
  );
  for (const row of rows) {
    console.log(row.map((cell, i) => (cell || '').padEnd(widths[i])).join('  '));
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function getWallet(opts: { key?: string }): { privateKey: `0x${string}`; address: string } {
  const privateKey = getPrivateKey(opts);
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

/**
 * Signed headers for mutating calls. The backend verifies the signature
 * recovers to the claimed wallet address before accepting the request.
 */
async function walletHeaders(privateKey: `0x${string}`): Promise<Record<string, string>> {
  const apinow = createClient({ privateKey });
  const auth = await apinow.signAuthHeader();
  return { 'Content-Type': 'application/json', ...auth };
}

// ─── search ───

program
  .command('search <query>')
  .description('Semantic search across all endpoints')
  .option('-l, --limit <n>', 'Max results', '10')
  .action(async (query: string, opts: { limit: string }) => {
    try {
      const data = await fetchJson(`${API_BASE}/api/endpoints/semantic-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: Number(opts.limit) }),
      });

      const endpoints = data.endpoints || data.results || data;
      if (!Array.isArray(endpoints) || !endpoints.length) {
        console.log('No results found.');
        return;
      }

      const rows: string[][] = [['ENDPOINT', 'METHOD', 'COST', 'DESCRIPTION']];
      for (const ep of endpoints) {
        const key = `${ep.namespace}/${ep.endpointName}`;
        rows.push([
          key,
          ep.httpMethod || 'POST',
          formatUsd(ep.paymentOptions),
          truncate(ep.description || '', 60),
        ]);
      }
      printTable(rows);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── list ───

program
  .command('list')
  .description('List available endpoints')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('-s, --sort <sortBy>', 'Sort by: popular | newest', 'popular')
  .option('-n, --namespace <ns>', 'Filter by namespace')
  .option('-q, --search <term>', 'Text search filter')
  .action(async (opts: { limit: string; sort: string; namespace?: string; search?: string }) => {
    try {
      const params = new URLSearchParams({
        limit: opts.limit,
        sortBy: opts.sort,
      });
      if (opts.namespace) params.set('namespace', opts.namespace);
      if (opts.search) params.set('search', opts.search);

      const data = await fetchJson(`${API_BASE}/api/endpoints?${params}`);
      const endpoints = data.endpoints || [];

      if (!endpoints.length) {
        console.log('No endpoints found.');
        return;
      }

      const rows: string[][] = [['ENDPOINT', 'METHOD', 'COST', 'CALLS', 'DESCRIPTION']];
      for (const ep of endpoints) {
        rows.push([
          `${ep.namespace}/${ep.endpointName}`,
          ep.httpMethod || 'POST',
          formatUsd(ep.paymentOptions),
          String(ep.callCount || 0),
          truncate(ep.description || '', 50),
        ]);
      }
      printTable(rows);

      if (data.hasMore) {
        console.log(`\n… more results available (showing ${endpoints.length})`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── info ───

program
  .command('info <endpoint>')
  .description('Get endpoint details (cost, wallet, schemas, examples)')
  .action(async (endpoint: string) => {
    try {
      if (!endpoint.includes('/')) {
        throw new Error('Format: namespace/endpoint-name');
      }
      const [ns, ep] = endpoint.split('/');
      const data = await fetchJson(`${API_BASE}/api/endpoints/${ns}/${ep}/details`);

      const cost = formatUsd(data.paymentOptions);
      const payment = data.paymentOptions?.[0];

      console.log(`\n  ${data.namespace}/${data.endpointName}`);
      console.log(`  ${'─'.repeat(40)}`);
      console.log(`  ${data.description || '(no description)'}\n`);
      console.log(`  Method:  ${data.httpMethod || 'POST'}`);
      console.log(`  Cost:    ${cost}`);
      console.log(`  Chain:   ${data.chain || 'base'}`);
      console.log(`  Wallet:  ${data.walletAddress || '—'}`);
      if (data.model) console.log(`  Model:   ${data.model}`);
      if (data.tags?.length) console.log(`  Tags:    ${data.tags.join(', ')}`);
      if (data.docsUrl) console.log(`  Docs:    ${data.docsUrl}`);

      if (payment) {
        console.log(`\n  Payment:`);
        console.log(`    Network:  ${payment.network || 'base-sepolia'}`);
        console.log(`    Token:    ${payment.resource || payment.token || 'USDC'}`);
        console.log(`    Amount:   ${payment.amount ?? '—'}`);
        if (payment.usdAmount != null) console.log(`    USD:      $${payment.usdAmount}`);
      }

      if (data.querySchema) {
        console.log(`\n  Input Schema:`);
        const schema = data.querySchema;
        if (schema.properties) {
          const required = new Set(schema.required || []);
          for (const [key, val] of Object.entries(schema.properties) as any) {
            const req = required.has(key) ? ' (required)' : '';
            const desc = val.description ? ` — ${val.description}` : '';
            const ex = val.example ? `  e.g. ${JSON.stringify(val.example)}` : '';
            console.log(`    ${key}: ${val.type || 'any'}${req}${desc}${ex}`);
          }
        } else {
          console.log(`    ${JSON.stringify(schema, null, 4).replace(/\n/g, '\n    ')}`);
        }
      }

      if (data.responseSchema) {
        console.log(`\n  Output Schema:`);
        console.log(`    ${JSON.stringify(data.responseSchema, null, 4).replace(/\n/g, '\n    ')}`);
      }

      if (data.exampleQuery) {
        console.log(`\n  Example Input:`);
        console.log(`    ${JSON.stringify(data.exampleQuery, null, 2).replace(/\n/g, '\n    ')}`);
      }

      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── endpoint-create ───

program
  .command('endpoint-create')
  .description('Create an endpoint (raw CRUD)')
  .requiredOption('--namespace <ns>', 'Namespace')
  .requiredOption('--name <name>', 'Endpoint name')
  .requiredOption('--url <url>', 'Upstream URL')
  .requiredOption('--description <desc>', 'Description')
  .option('--method <method>', 'HTTP method', 'POST')
  .option('--price <usdc>', 'USDC price per call', '0.01')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (opts: any) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const body = {
        namespace: opts.namespace,
        endpointName: opts.name,
        url: opts.url,
        description: opts.description,
        httpMethod: opts.method.toUpperCase(),
        paymentOptions: [{ usdAmount: opts.price, amount: opts.price }],
      };
      const data = await fetchJson(`${API_BASE}/api/endpoints`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(body),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── endpoint-update ───

program
  .command('endpoint-update <id>')
  .description('Update an endpoint by ID')
  .option('--description <desc>', 'New description')
  .option('--url <url>', 'New URL')
  .option('--price <usdc>', 'New USDC price')
  .option('--status <status>', 'New status')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: any) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const body: any = {};
      if (opts.description) body.description = opts.description;
      if (opts.url) body.url = opts.url;
      if (opts.status) body.status = opts.status;
      if (opts.price) body.paymentOptions = [{ usdAmount: opts.price, amount: opts.price }];
      const data = await fetchJson(`${API_BASE}/api/endpoints/${id}`, {
        method: 'PUT',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(body),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── endpoint-delete ───

program
  .command('endpoint-delete <id>')
  .description('Delete an endpoint by ID')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/endpoints/${id}`, {
        method: 'DELETE',
        headers: await walletHeaders(privateKey),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── call ───

program
  .command('call <endpoint>')
  .description('Call an endpoint (x402 paid)')
  .option('-d, --data <json>', 'JSON body')
  .option('-m, --method <method>', 'HTTP method')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (endpoint: string, opts: { data?: string; method?: string; key?: string }) => {
    try {
      if (!endpoint.includes('/')) {
        throw new Error('Format: namespace/endpoint-name');
      }

      const privateKey = getPrivateKey(opts);
      const [ns, ep] = endpoint.split('/');

      const details = await fetchJson(`${API_BASE}/api/endpoints/${ns}/${ep}/details`);
      const method = (opts.method || details?.httpMethod || 'POST').toUpperCase();
      const body = opts.data ? JSON.parse(opts.data) : undefined;
      const cost = formatUsd(details?.paymentOptions);

      console.error(`Calling ${ns}/${ep} [${method}] — cost: ${cost}`);

      const apinow = createClient({ privateKey });
      const result = await apinow.call(`/api/endpoints/${ns}/${ep}`, {
        method: method as any,
        ...(body ? { body } : {}),
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── discover (external x402) ───

program
  .command('discover <url>')
  .description('Discover the x402 price of any external endpoint (free)')
  .option('-m, --method <method>', 'HTTP method the target expects', 'POST')
  .action(async (url: string, opts: { method: string }) => {
    try {
      const params = new URLSearchParams({ url, method: opts.method.toUpperCase() });
      const data = await fetchJson(`${API_BASE}/api/x402-proxy?${params}`);

      console.log(`\n  ${data.url}`);
      console.log(`  ${'─'.repeat(50)}`);
      console.log(`  Method:          ${data.method}`);
      console.log(`  x402 endpoint:   ${data.isX402 ? 'YES' : 'NO'}`);
      console.log(`  Upstream price:  ${data.upstreamPrice}`);
      console.log(`  Proxy fee:       ${data.proxyFee}`);
      console.log(`  Total price:     ${data.totalPrice}`);
      console.log(`  Network:         ${data.network}`);
      if (data.upstreamAccepts?.length) {
        console.log(`  Accepts:`);
        for (const a of data.upstreamAccepts) {
          console.log(`    scheme=${a.scheme} payTo=${a.payTo?.substring(0, 16)}…`);
        }
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── call-external (external x402 proxy) ───

program
  .command('call-external <url>')
  .description('Call any external x402 endpoint through the APINow proxy (paid)')
  .option('-d, --data <json>', 'JSON body to send to the target')
  .option('-m, --method <method>', 'HTTP method', 'POST')
  .option('-H, --header <kv...>', 'Extra headers as key:value pairs')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (url: string, opts: { data?: string; method: string; header?: string[]; key?: string }) => {
    try {
      const privateKey = getPrivateKey(opts);
      const body = opts.data ? JSON.parse(opts.data) : undefined;

      const headers: Record<string, string> = {};
      if (opts.header) {
        for (const h of opts.header) {
          const idx = h.indexOf(':');
          if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
        }
      }

      const params = new URLSearchParams({ url, method: opts.method.toUpperCase() });
      const priceData = await fetchJson(`${API_BASE}/api/x402-proxy?${params}`);
      console.error(`Calling ${url} [${opts.method.toUpperCase()}] — total cost: ${priceData.totalPrice} (upstream: ${priceData.upstreamPrice} + fee: ${priceData.proxyFee})`);

      const apinow = createClient({ privateKey });
      const result = await apinow.callExternal(url, {
        method: opts.method.toUpperCase() as any,
        ...(body ? { body } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflows ───

program
  .command('workflows')
  .description('List workflows')
  .option('-l, --limit <n>', 'Max results', '20')
  .option('-c, --creator <address>', 'Filter by creator wallet')
  .option('-s, --status <status>', 'Filter by status: active | draft | all', 'all')
  .action(async (opts: { limit: string; creator?: string; status: string }) => {
    try {
      const params = new URLSearchParams({ limit: opts.limit, status: opts.status });
      if (opts.creator) params.set('creator', opts.creator);

      const data = await fetchJson(`${API_BASE}/api/workflows?${params}`);
      const workflows = data.workflows || [];

      if (!workflows.length) {
        console.log('No workflows found.');
        return;
      }

      const rows: string[][] = [['ID', 'NAME', 'STATUS', 'NODES', 'COST', 'DESCRIPTION']];
      for (const w of workflows) {
        rows.push([
          w.workflowId,
          truncate(w.name || '', 24),
          w.status,
          String(w.graph?.nodes?.length || 0),
          `$${w.totalPrice}`,
          truncate(w.description || '', 40),
        ]);
      }
      printTable(rows);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflow info ───

program
  .command('workflow <id>')
  .description('Get workflow details')
  .action(async (id: string) => {
    try {
      const data = await fetchJson(`${API_BASE}/api/workflows/${id}`);

      console.log(`\n  ${data.name}`);
      console.log(`  ${'─'.repeat(40)}`);
      console.log(`  ${data.description || '(no description)'}\n`);
      console.log(`  ID:      ${data.workflowId}`);
      console.log(`  Status:  ${data.status}`);
      console.log(`  Version: v${data.currentVersion ?? 1}${data.currentVersionId ? ` (${data.currentVersionId.slice(0, 8)}…)` : ''}`);
      console.log(`  Cost:    $${data.totalPrice} USDC`);
      console.log(`  Chain:   ${data.chain || 'base'}`);
      console.log(`  Creator: ${data.creatorWallet}`);
      console.log(`  Nodes:   ${data.graph?.nodes?.length || 0}`);

      if (data.graph?.nodes?.length) {
        console.log(`\n  Pipeline:`);
        for (const node of data.graph.nodes) {
          const deps = node.dependsOn?.length ? ` (depends on: ${node.dependsOn.join(', ')})` : '';
          const isOutput = node.id === data.graph.outputNode ? ' [output]' : '';
          console.log(`    → ${node.id}: ${node.endpoint}${deps}${isOutput}`);
        }
      }

      if (data.splits?.length) {
        console.log(`\n  Payment Split:`);
        for (const s of data.splits) {
          const pct = (s.basisPoints / 100).toFixed(1);
          const usd = (parseFloat(data.totalPrice) * s.basisPoints / 10000).toFixed(4);
          console.log(`    ${s.label}: ${pct}% ($${usd})`);
        }
      }

      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── run workflow ───

program
  .command('run-workflow <id>')
  .description('Run a workflow (x402 paid)')
  .option('-d, --data <json>', 'JSON input', '{"query":"hello world"}')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: { data: string; key?: string }) => {
    try {
      const privateKey = getPrivateKey(opts);
      const body = JSON.parse(opts.data);

      const details = await fetchJson(`${API_BASE}/api/workflows/${id}`);
      console.error(`Running workflow "${details.name}" — cost: $${details.totalPrice} USDC`);

      const apinow = createClient({ privateKey });
      const result = await apinow.runWorkflow(id, body);

      console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflow-create ───

program
  .command('workflow-create')
  .description('Create a workflow (raw CRUD)')
  .requiredOption('--name <name>', 'Workflow name')
  .option('--description <desc>', 'Description')
  .option('--graph <json>', 'Graph JSON (nodes + outputNode)')
  .option('--prompt <prompt>', 'AI prompt to generate workflow')
  .option('--price <usdc>', 'Total price', '0.10')
  .option('--splits <json>', 'Splits JSON array [{address, basisPoints, label?, tokenAddress?}]')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (opts: any) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const body: any = { name: opts.name, totalPrice: opts.price };
      if (opts.description) body.description = opts.description;
      if (opts.graph) body.graph = JSON.parse(opts.graph);
      if (opts.prompt) body.prompt = opts.prompt;
      if (opts.splits) body.splits = JSON.parse(opts.splits);
      const data = await fetchJson(`${API_BASE}/api/workflows`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(body),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflow-update ───

program
  .command('workflow-update <id>')
  .description('Update a workflow by ID')
  .option('--name <name>', 'New name')
  .option('--description <desc>', 'New description')
  .option('--status <status>', 'New status')
  .option('--price <usdc>', 'New total price')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: any) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const body: any = {};
      if (opts.name) body.name = opts.name;
      if (opts.description) body.description = opts.description;
      if (opts.status) body.status = opts.status;
      if (opts.price) body.totalPrice = opts.price;
      const data = await fetchJson(`${API_BASE}/api/workflows/${id}`, {
        method: 'PUT',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(body),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflow-delete ───

program
  .command('workflow-delete <id>')
  .description('Delete a workflow by ID')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/workflows/${id}`, {
        method: 'DELETE',
        headers: await walletHeaders(privateKey),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── my-workflows (creator endpoint view) ───

program
  .command('my-workflows')
  .description('List workflows you created (uses your wallet)')
  .option('-l, --limit <n>', 'Max results', '50')
  .option('-s, --status <status>', 'Filter: active | draft | paused | all', 'all')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (opts: { limit: string; status: string; key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const params = new URLSearchParams({
        limit: opts.limit,
        status: opts.status,
        creator: address,
      });
      const data = await fetchJson(`${API_BASE}/api/workflows?${params}`);
      const workflows = data.workflows || [];
      if (!workflows.length) {
        console.log('No workflows found for this wallet.');
        return;
      }
      const rows: string[][] = [['ID', 'NAME', 'STATUS', 'VER', 'NODES', 'COST']];
      for (const w of workflows) {
        rows.push([
          w.workflowId,
          truncate(w.name || '', 24),
          w.status,
          `v${w.currentVersion ?? 1}`,
          String(w.graph?.nodes?.length || 0),
          `$${w.totalPrice}`,
        ]);
      }
      printTable(rows);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflow-versions ───

program
  .command('workflow-versions <id>')
  .description('List all versions of a workflow')
  .action(async (id: string) => {
    try {
      const data = await fetchJson(`${API_BASE}/api/workflows/${id}/versions`);
      const versions = data.versions || [];
      if (!versions.length) {
        console.log('No versions found.');
        return;
      }
      const rows: string[][] = [['VER', 'DEFAULT', 'VERSION_ID', 'PRICE', 'CREATED', 'CHANGELOG']];
      for (const v of versions) {
        rows.push([
          `v${v.version}`,
          v.isDefault ? '★' : '',
          v.versionId,
          `$${v.totalPrice}`,
          new Date(v.createdAt).toLocaleDateString(),
          truncate(v.changelog || '', 40),
        ]);
      }
      printTable(rows);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflow-version-create ───

program
  .command('workflow-version-create <id>')
  .description('Create a new version of a workflow (graph/price/splits)')
  .option('--graph <json>', 'Graph JSON (inherits current if omitted)')
  .option('--price <usdc>', 'Total price')
  .option('--splits <json>', 'Splits JSON array')
  .option('--changelog <msg>', 'Changelog message')
  .option('--no-default', 'Create as non-default (keeps current version active)')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: any) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const body: any = {};
      if (opts.graph) body.graph = JSON.parse(opts.graph);
      if (opts.price) body.totalPrice = opts.price;
      if (opts.splits) body.splits = JSON.parse(opts.splits);
      if (opts.changelog) body.changelog = opts.changelog;
      if (opts.default === false) body.setDefault = false;
      const data = await fetchJson(`${API_BASE}/api/workflows/${id}/versions`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(body),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflow-version-set-default ───

program
  .command('workflow-version-set-default <id> <versionIdOrNumber>')
  .description('Set a version as the active/default for a workflow (rollback/promote)')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, vid: string, opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/workflows/${id}/versions/${vid}`, {
        method: 'PUT',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify({ setDefault: true }),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── workflow-version-delete ───

program
  .command('workflow-version-delete <id> <versionIdOrNumber>')
  .description('Delete a non-default workflow version')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, vid: string, opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/workflows/${id}/versions/${vid}`, {
        method: 'DELETE',
        headers: await walletHeaders(privateKey),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── ui-generate ───

program
  .command('ui-generate <endpoint>')
  .description('Generate an AI UI for an endpoint (namespace/name). Polls until complete.')
  .option('-p, --prompt <prompt>', 'Custom prompt / instructions for the UI')
  .option('--no-wait', 'Return immediately without polling')
  .option('--timeout <ms>', 'Polling timeout in ms', '120000')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (endpoint: string, opts: { prompt?: string; wait: boolean; timeout: string; key?: string }) => {
    try {
      if (!endpoint.includes('/')) throw new Error('Format: namespace/endpoint-name');
      const [ns, ep] = endpoint.split('/');
      const { privateKey, address } = getWallet(opts);

      const details = await fetchJson(`${API_BASE}/api/endpoints/${ns}/${ep}/details`);

      const body: any = {
        endpointName: ep,
        namespace: ns,
        description: details.description || '',
        querySchema: details.querySchema || {},
        responseSchema: details.responseSchema || {},
        walletAddress: address,
      };
      if (details.exampleQuery || details.exampleOutput) {
        body.examples = [{ input: details.exampleQuery, output: details.exampleOutput }];
      }
      if (opts.prompt) body.customPrompt = opts.prompt;

      console.error(`Generating UI for ${ns}/${ep}…`);
      const { id } = await fetchJson(`${API_BASE}/api/ai/generate-ui`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!opts.wait) {
        console.log(JSON.stringify({ id, status: 'generating' }, null, 2));
        return;
      }

      const timeout = Number(opts.timeout);
      const deadline = Date.now() + timeout;
      process.stderr.write('  Polling');
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        process.stderr.write('.');
        const doc = await fetchJson(`${API_BASE}/api/ai/generate-ui?id=${encodeURIComponent(id)}`);
        if (doc.status === 'complete') {
          console.error(' done!');
          console.log(JSON.stringify({
            id: doc._id,
            status: doc.status,
            endpointKey: doc.endpointKey,
            model: doc.model,
            files: Object.keys(doc.source || {}),
            source: doc.source,
            viewUrl: `https://apinow.fun/try/${ns}/${ep}`,
          }, null, 2));
          return;
        }
        if (doc.status === 'error') {
          console.error(' failed!');
          console.error(`Error: ${doc.errorMessage}`);
          process.exit(1);
        }
      }
      console.error(` timed out after ${timeout / 1000}s`);
      console.log(JSON.stringify({ id, status: 'generating', note: 'Still generating — poll with: apinow ui-get ' + id }));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── ui-list ───

program
  .command('ui-list <endpoint>')
  .description('List generated UIs for an endpoint (namespace/name)')
  .option('-s, --sort <sort>', 'Sort: popular | recent', 'popular')
  .action(async (endpoint: string, opts: { sort: string }) => {
    try {
      if (!endpoint.includes('/')) throw new Error('Format: namespace/endpoint-name');
      const params = new URLSearchParams({ endpointKey: endpoint, sort: opts.sort });
      const data = await fetchJson(`${API_BASE}/api/ai/generate-ui?${params}`);
      const uis = data.uis || [];

      if (!uis.length) {
        console.log('No generated UIs found.');
        return;
      }

      const rows: string[][] = [['ID', 'STATUS', 'MODEL', 'OPENS', 'LIKES', 'PROMPT', 'CREATED']];
      for (const ui of uis) {
        rows.push([
          ui._id,
          ui.status,
          ui.model || '—',
          String(ui.openCount || 0),
          String((ui.likes || []).length),
          truncate(ui.customPrompt || '(default)', 30),
          new Date(ui.createdAt).toLocaleDateString(),
        ]);
      }
      printTable(rows);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── ui-get ───

program
  .command('ui-get <id>')
  .description('Get a generated UI by ID (includes source code)')
  .option('--source-only', 'Print only the source JSON')
  .action(async (id: string, opts: { sourceOnly?: boolean }) => {
    try {
      const doc = await fetchJson(`${API_BASE}/api/ai/generate-ui?id=${encodeURIComponent(id)}`);
      if (opts.sourceOnly) {
        console.log(JSON.stringify(doc.source, null, 2));
        return;
      }
      console.log(JSON.stringify(doc, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── ui-delete ───

program
  .command('ui-delete <id>')
  .description('Delete a generated UI (must be creator)')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/ai/generate-ui`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, wallet: address }),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── ui-like / ui-dislike ───

program
  .command('ui-like <id>')
  .description('Like a generated UI')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/ai/generate-ui`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'like', wallet: address }),
      });
      console.log(`Likes: ${data.likes}  Dislikes: ${data.dislikes}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('ui-dislike <id>')
  .description('Dislike a generated UI')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/ai/generate-ui`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'dislike', wallet: address }),
      });
      console.log(`Likes: ${data.likes}  Dislikes: ${data.dislikes}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── ui-comment ───

program
  .command('ui-comment <id>')
  .description('Comment on a generated UI')
  .requiredOption('-m, --message <text>', 'Comment text')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (id: string, opts: { message: string; key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/ai/generate-ui`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'comment', wallet: address, comment: opts.message }),
      });
      console.log(`Comments: ${(data.comments || []).length}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── ui-free-check ───

program
  .command('ui-free-check')
  .description('Check free-tier UI generation eligibility')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const params = new URLSearchParams({ checkFree: '1', wallet: address });
      const data = await fetchJson(`${API_BASE}/api/ai/generate-ui?${params}`);
      console.log(`\n  Wallet:     ${address}`);
      console.log(`  Free tier:  ${data.free ? 'YES' : 'NO'}`);
      console.log(`  Remaining:  ${data.remaining === Infinity ? '∞' : data.remaining}\n`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── factory-balance ───

program
  .command('factory-balance')
  .description('Check $APINOW token balance and factory access')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/user-factory/check-balance`, {
        headers: await walletHeaders(privateKey),
      });
      console.log(`\n  Wallet:   ${address}`);
      console.log(`  Balance:  ${data.balance} $APINOW`);
      console.log(`  Required: ${data.required}`);
      console.log(`  Access:   ${data.hasAccess ? 'YES' : 'NO'}\n`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── factory-list ───

program
  .command('factory-list')
  .description('List your user-factory endpoints')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const data = await fetchJson(`${API_BASE}/api/user-factory`, {
        headers: await walletHeaders(privateKey),
      });
      const endpoints = data.endpoints || [];
      if (!endpoints.length) {
        console.log('No factory endpoints found.');
        return;
      }
      const rows: string[][] = [['ENDPOINT', 'MODEL', 'COST', 'STATUS']];
      for (const ep of endpoints) {
        rows.push([
          `${ep.namespace}/${ep.endpointName}`,
          ep.model || '—',
          formatUsd(ep.paymentOptions),
          ep.status || '—',
        ]);
      }
      printTable(rows);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── factory-generate ───

program
  .command('factory-generate <idea>')
  .description('Generate endpoint config from a natural-language idea')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (idea: string, opts: { key?: string }) => {
    try {
      const { privateKey, address } = getWallet(opts);
      console.error('Generating endpoint config…');
      const data = await fetchJson(`${API_BASE}/api/user-factory/generate`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify({ idea }),
      });
      console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── factory-create ───

program
  .command('factory-create')
  .description('Create an LLM endpoint via user-factory (flags or --from-json)')
  .option('--name <name>', 'Endpoint name')
  .option('--prompt <prompt>', 'System prompt for the LLM')
  .option('--namespace <ns>', 'Namespace (defaults to u-<wallet>)')
  .option('--description <desc>', 'Endpoint description')
  .option('--model <model>', 'LLM model', 'google/gemini-2.0-flash-001')
  .option('--price <usdc>', 'USDC price per call', '0.01')
  .option('--recipient <wallet>', 'Payment recipient wallet')
  .option('--input-params <json>', 'Input params JSON array')
  .option('--output-params <json>', 'Output params JSON array')
  .option('--from-json <path>', 'JSON file with config (use "-" for stdin). Fields: name, prompt, description, model, suggestedPrice, inputParams, outputParams')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (opts: any) => {
    try {
      const { privateKey, address } = getWallet(opts);
      let body: any;

      if (opts.fromJson) {
        const { readFileSync } = await import('fs');
        let raw: string;
        if (opts.fromJson === '-') {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) chunks.push(chunk);
          raw = Buffer.concat(chunks).toString('utf8');
        } else {
          raw = readFileSync(opts.fromJson, 'utf8');
        }
        const json = JSON.parse(raw);
        body = {
          name: json.name,
          prompt: json.prompt,
          model: json.model || opts.model,
          usdcPrice: json.suggestedPrice || json.usdcPrice || opts.price,
        };
        if (json.namespace) body.namespace = json.namespace;
        if (json.description) body.description = json.description;
        if (json.recipientWallet) body.recipientWallet = json.recipientWallet;
        if (json.inputParams) body.inputParams = json.inputParams;
        if (json.outputParams) body.outputParams = json.outputParams;
      } else {
        body = {
          name: opts.name,
          prompt: opts.prompt,
          model: opts.model,
          usdcPrice: opts.price,
        };
      }

      if (!body.name || !body.prompt) {
        console.error('Error: --name and --prompt are required (or provide --from-json)');
        process.exit(1);
      }

      if (opts.namespace) body.namespace = opts.namespace;
      if (opts.description) body.description = opts.description;
      if (opts.recipient) body.recipientWallet = opts.recipient;
      if (opts.inputParams) body.inputParams = JSON.parse(opts.inputParams);
      if (opts.outputParams) body.outputParams = JSON.parse(opts.outputParams);

      console.error(`Creating endpoint "${body.name}"…`);
      const data = await fetchJson(`${API_BASE}/api/user-factory`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(body),
      });

      const ep = data.endpoint;
      console.log(`\n  Created: ${ep.namespace}/${ep.endpointName}`);
      console.log(`  Model:   ${ep.model}`);
      console.log(`  Price:   $${ep.price} USDC`);
      console.log(`  Try:     https://apinow.fun${ep.tryUrl}`);
      console.log(`  API:     https://apinow.fun${ep.apiUrl}\n`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── factory-markup ───

program
  .command('factory-markup <endpointId>')
  .description('Create a markup workflow that wraps an existing endpoint')
  .option('--markup <percent>', 'Markup percentage', '20')
  .option('--name <name>', 'Workflow name')
  .option('--token-buy-percent <percent>', 'Percent of markup allocated to token buy')
  .option('--token-buy-recipient <wallet>', 'Wallet to receive token buy USDC')
  .option('--token-buy-ca <address>', 'Token contract address (default: $APINOW)')
  .option('--markup-recipient <wallet>', 'Wallet to receive markup USDC')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (endpointId: string, opts: any) => {
    try {
      const { privateKey, address } = getWallet(opts);
      const body: any = { endpointId, markupPercent: Number(opts.markup) };
      if (opts.name) body.workflowName = opts.name;
      if (opts.tokenBuyPercent) body.tokenBuyPercent = Number(opts.tokenBuyPercent);
      if (opts.tokenBuyRecipient) body.tokenBuyRecipient = opts.tokenBuyRecipient;
      if (opts.tokenBuyCa) body.tokenBuyCA = opts.tokenBuyCa;
      if (opts.markupRecipient) body.markupRecipient = opts.markupRecipient;

      const tbLabel = opts.tokenBuyPercent ? ` + ${opts.tokenBuyPercent}% token buy` : '';
      console.error(`Creating markup workflow (${opts.markup}%${tbLabel})…`);
      const data = await fetchJson(`${API_BASE}/api/user-factory/markup`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(body),
      });

      const w = data.workflow;
      console.log(`\n  Created: ${w.name}`);
      console.log(`  ID:      ${w.workflowId}`);
      console.log(`  Base:    $${w.basePrice} USDC`);
      console.log(`  Markup:  ${w.markupPercent}%`);
      if (w.tokenBuyPercent) console.log(`  Token Buy: ${w.tokenBuyPercent}% of markup`);
      console.log(`  Total:   $${w.totalPrice} USDC`);
      console.log(`  View:    https://apinow.fun${w.viewUrl}\n`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── factory-test ───

program
  .command('factory-test <endpoint>')
  .description('Test-call an endpoint without payment')
  .option('-d, --data <json>', 'JSON input')
  .option('--save', 'Save as example')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (endpoint: string, opts: { data?: string; save?: boolean; key?: string }) => {
    try {
      if (!endpoint.includes('/')) throw new Error('Format: namespace/endpoint-name');
      const { privateKey, address } = getWallet(opts);
      const [namespace, endpointName] = endpoint.split('/');
      const body: any = { namespace, endpointName };
      if (opts.data) body.input = JSON.parse(opts.data);
      if (opts.save) body.saveExample = true;

      console.error(`Testing ${endpoint}…`);
      const data = await fetchJson(`${API_BASE}/api/user-factory/test-call`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(body),
      });
      console.log(JSON.stringify(data.output, null, 2));
      if (data.saved) console.error('(saved as example)');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── factory-pipeline ───

program
  .command('factory-pipeline <idea>')
  .description('Full pipeline: generate → create → test → optional markup workflow')
  .option('--markup <percent>', 'Markup percent (creates a markup workflow after endpoint creation)')
  .option('--markup-recipient <wallet>', 'Wallet to receive markup USDC')
  .option('--token-buy-percent <percent>', 'Percent of base price for token buy')
  .option('--token-buy-recipient <wallet>', 'Wallet to receive token buy portion')
  .option('--token-buy-ca <address>', 'Token contract address for buy (default: $APINOW)')
  .option('--recipient <wallet>', 'Endpoint payment recipient wallet')
  .option('--price <usdc>', 'Override suggested USDC price')
  .option('--model <model>', 'Override suggested model')
  .option('--dry-run', 'Generate and print config without creating')
  .option('-k, --key <privateKey>', 'Wallet private key')
  .action(async (idea: string, opts: any) => {
    try {
      const { privateKey, address } = getWallet(opts);

      // Step 1: Generate
      console.error('Step 1/4: Generating endpoint config from idea…');
      const draft = await fetchJson(`${API_BASE}/api/user-factory/generate`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify({ idea }),
      });
      console.error(`  → ${draft.name}: ${draft.description}`);
      console.error(`  → Model: ${draft.model}, Price: $${draft.suggestedPrice}`);
      console.error(`  → Input params: ${(draft.inputParams || []).map((p: any) => p.name).join(', ') || '(none)'}`);
      console.error(`  → Output params: ${(draft.outputParams || []).map((p: any) => p.name).join(', ') || '(none)'}`);

      if (opts.dryRun) {
        console.log(JSON.stringify(draft, null, 2));
        return;
      }

      // Step 2: Create
      console.error('\nStep 2/4: Creating endpoint…');
      const createBody: any = {
        name: draft.name,
        prompt: draft.prompt,
        description: draft.description,
        model: opts.model || draft.model || 'google/gemini-2.0-flash-001',
        usdcPrice: opts.price || draft.suggestedPrice || '0.01',
        inputParams: draft.inputParams,
        outputParams: draft.outputParams,
      };
      if (opts.recipient) createBody.recipientWallet = opts.recipient;

      const createData = await fetchJson(`${API_BASE}/api/user-factory`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify(createBody),
      });
      const ep = createData.endpoint;
      console.error(`  → Created: ${ep.namespace}/${ep.endpointName}`);

      // Step 3: Test
      console.error('\nStep 3/4: Running test call…');
      const testInput = draft.exampleInput || { prompt: 'test' };
      const testData = await fetchJson(`${API_BASE}/api/user-factory/test-call`, {
        method: 'POST',
        headers: await walletHeaders(privateKey),
        body: JSON.stringify({
          namespace: ep.namespace,
          endpointName: ep.endpointName,
          input: testInput,
          saveExample: true,
        }),
      });
      console.error('  → Test passed, example saved');

      // Step 4: Markup (optional)
      let workflow = null;
      if (opts.markup) {
        console.error(`\nStep 4/4: Creating markup workflow (${opts.markup}%)…`);
        const markupBody: any = {
          endpointId: ep.id,
          markupPercent: Number(opts.markup),
        };
        if (opts.markupRecipient) markupBody.markupRecipient = opts.markupRecipient;
        if (opts.tokenBuyPercent) markupBody.tokenBuyPercent = Number(opts.tokenBuyPercent);
        if (opts.tokenBuyRecipient) markupBody.tokenBuyRecipient = opts.tokenBuyRecipient;
        if (opts.tokenBuyCa) markupBody.tokenBuyCA = opts.tokenBuyCa;

        const markupData = await fetchJson(`${API_BASE}/api/user-factory/markup`, {
          method: 'POST',
          headers: await walletHeaders(privateKey),
          body: JSON.stringify(markupBody),
        });
        workflow = markupData.workflow;
        console.error(`  → Workflow: ${workflow.name} ($${workflow.totalPrice} USDC)`);
      } else {
        console.error('\nStep 4/4: Skipped (no --markup flag)');
      }

      // Final output
      const result: any = {
        endpoint: {
          id: ep.id,
          namespace: ep.namespace,
          name: ep.endpointName,
          model: ep.model,
          price: ep.price,
          tryUrl: `https://apinow.fun${ep.tryUrl}`,
          apiUrl: `https://apinow.fun${ep.apiUrl}`,
        },
        testOutput: testData.output,
      };
      if (workflow) {
        result.workflow = {
          id: workflow.workflowId,
          name: workflow.name,
          totalPrice: workflow.totalPrice,
          markupPercent: workflow.markupPercent,
          viewUrl: `https://apinow.fun${workflow.viewUrl}`,
        };
      }
      console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
