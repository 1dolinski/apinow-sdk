// To run this example:
// 1. npm install apinow-sdk dotenv
// 2. Create a .env file: PRIVATE_KEY="0x..."
// 3. node example.js

import { createClient } from 'apinow-sdk';
import dotenv from 'dotenv';

dotenv.config();

const apinow = createClient({
  privateKey: process.env.PRIVATE_KEY,
});

console.log('Wallet:', apinow.wallet);

// Search for endpoints
const endpoints = await apinow.search('translate text', 3);
console.log('Found endpoints:', JSON.stringify(endpoints, null, 2));

// Call an endpoint (x402 payment handled automatically)
const result = await apinow.call('/api/endpoints/apinowfun/translate-TRANSLATE', {
  method: 'POST',
  body: {
    text: 'Hello world, how are you?',
    selectedLanguage: 'es',
  },
});
console.log('Translation:', JSON.stringify(result, null, 2));

// ─── Workflows ───

// List active workflows
const { workflows } = await apinow.listWorkflows({ status: 'active', limit: 5 });
console.log('Active workflows:', workflows.map(w => `${w.name} ($${w.totalPrice})`));

// Get workflow details
const workflow = await apinow.getWorkflow('90931d9c8fb94df9');
console.log('Workflow:', workflow.name, '—', workflow.description);
console.log('Nodes:', workflow.graph.nodes.map(n => n.endpoint).join(' → '));

// Run a workflow (x402 payment handled automatically)
const wfResult = await apinow.runWorkflow('90931d9c8fb94df9', {
  query: 'birthday gift ideas for a friend who loves cooking',
});
console.log('Workflow result:', JSON.stringify(wfResult, null, 2));
