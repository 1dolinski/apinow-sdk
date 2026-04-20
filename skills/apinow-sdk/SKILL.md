---
name: apinow-sdk
description: >-
  Use the apinow-sdk to call pay-per-request APIs with automatic x402 crypto
  payments, discover endpoints, run workflow pipelines, create LLM endpoints
  via user-factory, and generate AI UIs. Use when calling APIs on APINow.fun,
  working with x402 payments, or building AI agent integrations.
---

# apinow-sdk

SDK and CLI for [APINow.fun](https://apinow.fun) — a pay-per-request API marketplace using [x402](https://www.x402.org/) crypto payments. Designed for AI agents with wallets.

## Install

```bash
npm install apinow-sdk
```

## Quick Start

```typescript
import { createClient } from 'apinow-sdk';

const apinow = createClient({
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// Call any endpoint — x402 payment handled automatically
const data = await apinow.call('/api/endpoints/apinowfun/translate', {
  method: 'POST',
  body: { text: 'Hello world', targetLanguage: 'es' },
});
```

## SDK Methods

### Core

| Method | Description |
|--------|-------------|
| `call(endpoint, opts?)` | Call any APINow endpoint with automatic x402 payment |
| `search(query, limit?)` | Semantic search across all endpoints |
| `info(ns, name)` | Get endpoint details — cost, schema, wallet (free) |
| `listEndpoints(opts?)` | List endpoints with filters |

### Workflows

Chain multiple endpoints into a single paid DAG pipeline with payment splitting. Each workflow is owned by a `creatorWallet` (like an endpoint has a `walletAddress`) and supports immutable versioning.

| Method | Description |
|--------|-------------|
| `listWorkflows(opts?)` | List workflows (filter by `creator`, `status`, `limit`) |
| `listMyWorkflows(opts?)` | List workflows created by your wallet |
| `getWorkflow(id)` | Get workflow details (includes `currentVersion`, `creatorWallet`) |
| `runWorkflow(id, input)` | Run a workflow (paid) |
| `createWorkflow(config)` | Create a workflow (seeds v1) |
| `updateWorkflow(id, updates)` | Update a workflow (graph/price/splits auto-bumps version) |
| `deleteWorkflow(id)` | Delete a workflow |

```typescript
const result = await apinow.runWorkflow('f5d40784593aa972', {
  query: 'birthday gift ideas for a friend who loves cooking',
});
```

**Title / description edit cooldown:** `name` and `description` can only be changed **once every 7 days** per workflow. The server returns `429 { error, retryAfterMs, retryAfterDays }` when the cooldown is active. To iterate freely, create a new **version** (no cooldown) instead of renaming.

#### Workflow Versions

| Method | Description |
|--------|-------------|
| `listWorkflowVersions(id)` | List all versions (free) |
| `getWorkflowVersion(id, versionIdOrNumber)` | Fetch a specific version |
| `createWorkflowVersion(id, updates)` | Creator only — new version, omitted fields inherit. `setDefault` defaults to `true`. |
| `setDefaultWorkflowVersion(id, vid)` | Promote/rollback a version to active |
| `deleteWorkflowVersion(id, vid)` | Delete a non-default version |

```typescript
const { versions } = await apinow.listWorkflowVersions('f5d40784593aa972');

await apinow.createWorkflowVersion('f5d40784593aa972', {
  totalPrice: '0.12',
  changelog: 'Raised price after usage spike',
});

await apinow.setDefaultWorkflowVersion('f5d40784593aa972', 1); // rollback
```

### External x402 Proxy

Call any x402 endpoint on the internet — not just APINow-listed ones.

| Method | Description |
|--------|-------------|
| `discoverPrice(url, method?)` | Check x402 price of any URL (free) |
| `callExternal(url, opts?)` | Proxy call through APINow (paid) |

### User Factory

Create LLM-powered endpoints from natural language.

| Method | Description |
|--------|-------------|
| `factoryBalance()` | Check $APINOW token balance |
| `factoryGenerate(idea)` | Generate endpoint config from idea |
| `factoryCreate(config)` | Create an LLM endpoint |
| `factoryTestCall(opts)` | Free test call |
| `factoryMarkup(opts)` | Create markup workflow around endpoint |
| `factoryPipeline(idea, opts?)` | Full pipeline: generate → create → test → markup |

```typescript
const result = await apinow.factoryPipeline('Score startup pitches on 8 criteria', {
  markup: { markupPercent: 30 },
});
console.log(result.endpoint.namespace + '/' + result.endpoint.endpointName);
```

### AI UI Generation

Generate interactive [Arrow JS](https://www.arrow-js.com/) sandbox UIs for any endpoint. The server LLM produces `main.ts` + `main.css` source that renders forms, result displays, and live API integration.

| Method | Description |
|--------|-------------|
| `generateUI(opts)` | Start async UI generation |
| `generateUIAndWait(opts, pollMs?, timeoutMs?)` | Generate and poll until complete |
| `getGeneratedUI(id)` | Get generated UI by ID |
| `listGeneratedUIs(key, sort?)` | List UIs for an endpoint |
| `checkFreeUI()` | Check free-tier eligibility (3 free per wallet) |
| `reactToUI(id, action, comment?)` | Like/dislike/comment |
| `deleteGeneratedUI(id)` | Delete a generated UI |

**GenerateUIOptions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpointName` | `string` | Yes | Endpoint name |
| `namespace` | `string` | Yes | Endpoint namespace |
| `description` | `string` | No | What the endpoint does |
| `querySchema` | `object` | No | JSON Schema for input |
| `responseSchema` | `object` | No | JSON Schema for output |
| `examples` | `array` | No | `[{ input, output }]` pairs — pre-fills the form |
| `customPrompt` | `string` | No | Extra instructions (theme, layout, behavior) |

```typescript
const ui = await apinow.generateUIAndWait({
  endpointName: 'horoscope',
  namespace: 'gg402',
  description: 'Get daily horoscope',
  querySchema: { properties: { sign: { type: 'string' } } },
  customPrompt: 'Use a starry night theme',
});
// ui.source = { "main.ts": "...", "main.css": "..." }
```

**Agent integration pattern** — discover, inspect, and generate a UI in one flow:

```typescript
const details = await apinow.info('gg402', 'horoscope');
const ui = await apinow.generateUIAndWait({
  endpointName: details.endpointName,
  namespace: details.namespace,
  description: details.description,
  querySchema: details.querySchema,
  responseSchema: details.responseSchema,
  examples: details.exampleQuery
    ? [{ input: details.exampleQuery, output: details.exampleOutput }]
    : undefined,
});
const { 'main.ts': mainTs, 'main.css': mainCss } = ui.source;
```

Generated UIs include pre-filled forms, loading states, intelligent result rendering (progress bars, tables, color-coded values), and host communication via `output({ type: 'api_call', payload })`.

### Endpoint CRUD

| Method | Description |
|--------|-------------|
| `createEndpoint(config)` | Create an endpoint |
| `getEndpoint(id)` | Get endpoint by ID |
| `updateEndpoint(id, updates)` | Update an endpoint |
| `deleteEndpoint(id)` | Delete an endpoint |

## CLI

All commands available via `npx apinow <command>`. Set `APINOW_WALLET_PKEY` env var or pass `-k`.

### Discovery & Calling

```bash
apinow search "weather api" --limit 5
apinow list --sort newest --namespace gg402
apinow info gg402/horoscope
apinow call gg402/horoscope -d '{"sign":"aries"}'
```

### Workflows

```bash
apinow workflows --status active
apinow my-workflows                                 # workflows you created
apinow workflow f5d40784593aa972
apinow run-workflow f5d40784593aa972 -d '{"query":"gift ideas"}'

# Versioning
apinow workflow-versions f5d40784593aa972
apinow workflow-version-create f5d40784593aa972 --price 0.12 --changelog "Raised price"
apinow workflow-version-set-default f5d40784593aa972 1   # rollback
apinow workflow-version-delete f5d40784593aa972 3
```

### External x402

```bash
apinow discover https://stablesocial.dev/api/tiktok/profile
apinow call-external https://stablesocial.dev/api/tiktok/profile -d '{"handle":"user"}'
```

### User Factory

```bash
apinow factory-pipeline "Score startup pitches" --markup 20
apinow factory-generate "translate text between languages"
apinow factory-create --name translator --prompt "Translate text" --price 0.01
apinow factory-test ns/endpoint -d '{"text":"hello"}'
```

### AI UI Generation

```bash
apinow ui-generate gg402/horoscope --prompt "dark theme"
apinow ui-list gg402/horoscope --sort recent
apinow ui-get <id> --source-only
apinow ui-free-check
apinow ui-like <id>
apinow ui-delete <id>
```

## Config

| Option | Type | Default |
|--------|------|---------|
| `privateKey` | `` `0x${string}` `` | Required — EVM private key |
| `baseUrl` | `string` | `https://apinow.fun` |

Requires Node.js v18+ and an EVM wallet with funds on Base for paid calls.

## Auth

- Paid calls (`call`, `runWorkflow`, `callExternal`) use **x402** (payment proves identity).
- All write/mutating calls — `createWorkflow`, `updateWorkflow`, `createEndpoint`, `createWorkflowVersion`, `setDefaultWorkflowVersion`, factory endpoints, etc. — are **signed with your private key** automatically via an `Authorization: Bearer <msg>||<sig>||<addr>` header. The backend recovers the address via `ethers.recoverAddress` and rejects messages older than 10 min.
- Read calls (search, list, details, workflow versions) are public and need no auth.
- `signAuthHeader()` is exposed on the client if you need to sign custom requests:

  ```typescript
  const headers = await apinow.signAuthHeader();
  await fetch('https://www.apinow.fun/api/workflows/abc/versions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ totalPrice: '0.15', changelog: 'Bump' }),
  });
  ```
