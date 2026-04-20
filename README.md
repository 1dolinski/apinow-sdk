# apinow-sdk

> **AI Agents:** Install this skill for full SDK + CLI guidance:
> ```
> npx skills add https://github.com/1dolinski/apinow-sdk --skill apinow-sdk
> ```
> Or read the [SKILL.md](https://github.com/1dolinski/apinow-sdk/blob/main/skills/apinow-sdk/SKILL.md) directly.

Pay-per-call API SDK & CLI for [APINow.fun](https://apinow.fun) — wraps [x402](https://www.x402.org/) so you don't have to.

```bash
npm install apinow-sdk
```

## SDK

```typescript
import { createClient } from 'apinow-sdk';

const apinow = createClient({
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});

// call any endpoint — x402 payment is handled automatically
const data = await apinow.call('/api/endpoints/apinowfun/translate', {
  method: 'POST',
  body: { text: 'Hello world', targetLanguage: 'es' },
});

// semantic search
const results = await apinow.search('weather forecast', 5);

// free endpoint info (cost, schema, wallet)
const info = await apinow.info('gg402', 'horoscope');

// call ANY external x402 endpoint — even ones not listed on APINow
const price = await apinow.discoverPrice('https://stablesocial.dev/api/tiktok/profile');
console.log(price.totalPrice); // upstream + proxy fee

const tiktok = await apinow.callExternal('https://stablesocial.dev/api/tiktok/profile', {
  method: 'POST',
  body: { handle: 'someuser' },
});
```

### `createClient(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `privateKey` | `` `0x${string}` `` | — | EVM private key (required) |
| `baseUrl` | `string` | `https://apinow.fun` | API base URL |

Returns:

| Method | Description |
|--------|-------------|
| `call(endpoint, opts?)` | Call any APINow endpoint with automatic x402 payment |
| `callExternal(url, opts?)` | Proxy any external x402 endpoint (discovery + payment) |
| `discoverPrice(url, method?)` | Discover the x402 price of any URL (free) |
| `search(query, limit?)` | Semantic search across all endpoints |
| `info(ns, name)` | Get endpoint details (free) |
| `listWorkflows(opts?)` | List workflows (filter by `creator`, `status`) |
| `listMyWorkflows(opts?)` | List workflows created by your wallet |
| `getWorkflow(id)` | Get workflow details (incl. `currentVersion`, `creatorWallet`) |
| `createWorkflow(config)` | Create a workflow (seeds v1) |
| `updateWorkflow(id, updates)` | Update a workflow (auto-bumps version on graph/price/splits change) |
| `deleteWorkflow(id)` | Delete a workflow |
| `runWorkflow(id, input)` | Run a workflow with automatic x402 payment |
| `listWorkflowVersions(id)` | List versions (free) |
| `getWorkflowVersion(id, vid)` | Get a specific version |
| `createWorkflowVersion(id, updates)` | Creator — new version, defaults to active |
| `setDefaultWorkflowVersion(id, vid)` | Promote/rollback a version |
| `deleteWorkflowVersion(id, vid)` | Delete a non-default version |
| `generateUI(opts)` | Start AI UI generation for an endpoint (async) |
| `generateUIAndWait(opts)` | Generate UI and poll until complete |
| `getGeneratedUI(id)` | Get a generated UI by ID |
| `listGeneratedUIs(key, sort?)` | List generated UIs for an endpoint |
| `checkFreeUI()` | Check free-tier generation eligibility |
| `reactToUI(id, action, comment?)` | Like/dislike/comment on a generated UI |
| `deleteGeneratedUI(id)` | Delete a generated UI |
| `wallet` | Your wallet address |
| `fetch` | Raw x402-wrapped `fetch` for advanced use |

### Workflows

Workflows chain multiple x402 endpoints into a single paid DAG pipeline with automatic payment splitting. Each workflow is owned by a `creatorWallet` and tracks an immutable version history.

```typescript
// list workflows (optionally filter by creator)
const { workflows } = await apinow.listWorkflows({ creator: '0x...', status: 'active' });

// your own workflows
const mine = await apinow.listMyWorkflows();

// get workflow details (nodes, splits, pricing, currentVersion, creatorWallet)
const workflow = await apinow.getWorkflow('f5d40784593aa972');

// run a workflow — x402 payment covers all nodes + creator split
const result = await apinow.runWorkflow('f5d40784593aa972', {
  query: 'birthday gift ideas for a friend who loves cooking',
});
```

#### Versions & metadata cooldown

- `PUT /api/workflows/{id}` with changes to `graph`, `totalPrice`, or `splits` auto-creates a new version.
- `name` and `description` can only change **once every 7 days** per workflow (server returns `429` with `retryAfterMs`).
- To iterate freely, create a new version — no cooldown.

```typescript
// snapshot history
const { versions } = await apinow.listWorkflowVersions('f5d40784593aa972');

// bump price without renaming
await apinow.createWorkflowVersion('f5d40784593aa972', {
  totalPrice: '0.12',
  changelog: 'Raised price after usage spike',
});

// rollback
await apinow.setDefaultWorkflowVersion('f5d40784593aa972', 1);
```

### AI UI Generation

Generate interactive Arrow JS sandbox UIs for any endpoint — ideal for AI agents that need a visual interface.

```typescript
// generate a UI and wait for it to complete
const ui = await apinow.generateUIAndWait({
  endpointName: 'horoscope',
  namespace: 'gg402',
  description: 'Get daily horoscope for a zodiac sign',
  querySchema: { properties: { sign: { type: 'string' } } },
  responseSchema: { properties: { horoscope: { type: 'string' } } },
  customPrompt: 'Use a starry night theme',
});
console.log(ui.status); // 'complete'
console.log(ui.source); // { "main.ts": "...", "main.css": "..." }

// or fire-and-forget + poll yourself
const { id } = await apinow.generateUI({ endpointName: 'translate', namespace: 'apinowfun' });
const doc = await apinow.getGeneratedUI(id); // poll until doc.status !== 'generating'

// list existing UIs for an endpoint
const { uis } = await apinow.listGeneratedUIs('gg402/horoscope', 'popular');

// social
await apinow.reactToUI(ui._id, 'like');
await apinow.reactToUI(ui._id, 'comment', 'Great UI!');

// check free-tier
const { free, remaining } = await apinow.checkFreeUI();
```

## CLI

```bash
npx apinow <command>
```

### `search` — find endpoints

```bash
npx apinow search "weather api" --limit 5
```

### `list` — browse endpoints

```bash
npx apinow list                          # popular endpoints
npx apinow list --sort newest --limit 10
npx apinow list --namespace gg402
npx apinow list --search translate
```

### `info` — endpoint details

Shows cost, wallet, chain, input/output schemas, and examples.

```bash
npx apinow info gg402/horoscope
```

### `call` — call an endpoint (paid)

```bash
APINOW_WALLET_PKEY=0x... npx apinow call gg402/horoscope -d '{"sign":"aries"}'
npx apinow call ns/endpoint -m GET -k 0xYOUR_KEY
```

| Flag | Description |
|------|-------------|
| `-d, --data <json>` | JSON request body |
| `-m, --method <method>` | HTTP method (default: from endpoint) |
| `-k, --key <privateKey>` | Wallet key (or set `APINOW_WALLET_PKEY`) |

### `workflows` — list workflows

```bash
npx apinow workflows
npx apinow workflows --status active --limit 10
npx apinow workflows --creator 0x32e8...E934
```

### `workflow` — workflow details

```bash
npx apinow workflow 90931d9c8fb94df9
```

### `run-workflow` — run a workflow (paid)

```bash
APINOW_WALLET_PKEY=0x... npx apinow run-workflow 90931d9c8fb94df9 -d '{"query":"birthday gift ideas"}'
```

| Flag | Description |
|------|-------------|
| `-d, --data <json>` | JSON input (default: `{"query":"hello world"}`) |
| `-k, --key <privateKey>` | Wallet key (or set `APINOW_WALLET_PKEY`) |

### `ui-generate` — generate an AI UI for an endpoint

Generates an interactive Arrow JS sandbox UI. Automatically fetches the endpoint's schema and examples, sends the generation request, and polls until complete.

```bash
APINOW_WALLET_PKEY=0x... npx apinow ui-generate gg402/horoscope
APINOW_WALLET_PKEY=0x... npx apinow ui-generate gg402/horoscope --prompt "dark theme with animations"
npx apinow ui-generate ns/endpoint --no-wait -k 0xKEY  # returns immediately with ID
```

| Flag | Description |
|------|-------------|
| `-p, --prompt <text>` | Custom instructions for the UI |
| `--no-wait` | Return immediately without polling |
| `--timeout <ms>` | Polling timeout (default: 120000) |
| `-k, --key <privateKey>` | Wallet key (or set `APINOW_WALLET_PKEY`) |

### `ui-list` — list generated UIs

```bash
npx apinow ui-list gg402/horoscope
npx apinow ui-list gg402/horoscope --sort recent
```

### `ui-get` — get a generated UI by ID

```bash
npx apinow ui-get 665a1b2c3d4e5f6a7b8c9d0e
npx apinow ui-get 665a1b2c3d4e5f6a7b8c9d0e --source-only  # just the Arrow JS source
```

### `ui-like` / `ui-dislike` / `ui-comment` — social actions

```bash
APINOW_WALLET_PKEY=0x... npx apinow ui-like <id>
APINOW_WALLET_PKEY=0x... npx apinow ui-dislike <id>
APINOW_WALLET_PKEY=0x... npx apinow ui-comment <id> -m "Nice UI!"
```

### `ui-delete` — delete a generated UI

```bash
APINOW_WALLET_PKEY=0x... npx apinow ui-delete <id>
```

### `ui-free-check` — check free-tier eligibility

```bash
APINOW_WALLET_PKEY=0x... npx apinow ui-free-check
```

### `discover` — check the x402 price of any URL (free)

```bash
npx apinow discover https://stablesocial.dev/api/tiktok/profile
npx apinow discover https://stablesocial.dev/api/tiktok/posts --method POST
```

### `call-external` — call any external x402 endpoint (paid)

Proxies through APINow — you pay upstream price + a small proxy fee, and the server wallet pays the upstream service.

```bash
APINOW_WALLET_PKEY=0x... npx apinow call-external https://stablesocial.dev/api/tiktok/profile -d '{"handle":"someuser"}'
```

| Flag | Description |
|------|-------------|
| `-d, --data <json>` | JSON body to send to the target |
| `-m, --method <method>` | HTTP method (default: POST) |
| `-H, --header <kv...>` | Extra headers as `key:value` pairs |
| `-k, --key <privateKey>` | Wallet key (or set `APINOW_WALLET_PKEY`) |

## Requirements

- Node.js v18+
- EVM wallet with funds on Base for paid endpoints

## License

MIT
