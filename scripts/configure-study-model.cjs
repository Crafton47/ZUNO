require('dotenv').config({ quiet: true });
const { upstream } = require('../study');
(async () => {
  const provider = process.env.NVIDIA_API_KEY ? 'openai_compatible' : 'google';
  const name = provider === 'google' ? process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash' : process.env.NVIDIA_CHAT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
  const models = await upstream('/api/models');
  let model = models.find(m => m.name === name && m.provider === provider && m.type === 'language');
  if (!model) model = await upstream('/api/models', { method: 'POST', body: { name, provider, type: 'language' } });
  await upstream('/api/models/defaults', { method: 'PUT', body: { default_chat_model: model.id, default_transformation_model: model.id, large_context_model: model.id } });
  console.log('Study language model configured: ' + name + '. No embedding model needed for full-content notebook chat.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
