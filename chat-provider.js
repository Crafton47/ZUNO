const { GoogleGenAI } = require('@google/genai');
const TIMEOUT = 30000;
function provider() { return process.env.CHAT_PROVIDER || (process.env.NVIDIA_API_KEY ? 'nvidia' : 'gemini'); }
function configured() { return provider() === 'nvidia' ? Boolean(process.env.NVIDIA_API_KEY) : provider() === 'gemini' && Boolean(process.env.GEMINI_API_KEY); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Provider hiccups (timeouts, dropped connections, 429/5xx) used to surface to the
// user as a failed reply, which the client showed as a random crash. Retry those
// transient failures, but never retry a bad key, a bad model or a bad request.
async function transient(fn) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fn(); }
    catch (error) {
      last = error;
      const status = Number(error?.status);
      if (status >= 400 && status < 500 && status !== 429) throw error;
      if (attempt < 2) await pause(400 * 2 ** attempt);
    }
  }
  throw last;
}
async function nvidia(body) {
  return transient(async () => {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT),
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      throw Object.assign(new Error(`NVIDIA request failed (${response.status})`), { status: response.status, detail: detail.slice(0, 400) });
    }
    const data = await response.json();
    if (!Array.isArray(data?.choices) || !data.choices[0]?.message) throw new Error('Malformed provider response.');
    return data.choices[0].message;
  });
}
async function gemini(ai, body) {
  const response = await transient(() => ai.models.generateContent(body));
  if (!response) throw new Error('Malformed provider response.');
  return response;
}
async function reply(system, history, text, actions) {
  const messages = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })), { role: 'user', content: text }];
  const contents = [...history.map(m => ({ role: m.role, parts: [{ text: m.text }] })), { role: 'user', parts: [{ text }] }];
  const ai = provider() === 'gemini' ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
  for (let round = 0; round < 5; round++) {
    const force = actions?.force && round === 0 ? actions.force : null;
    if (provider() === 'nvidia') {
      const message = await nvidia({ model: process.env.NVIDIA_CHAT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b', messages,
        ...(actions ? { tools: actions.tools.map(tool => ({ type: 'function', function: tool })), tool_choice: force ? { type: 'function', function: { name: force } } : 'auto' } : {}),
        max_tokens: 1200, temperature: 0.7, stream: false, chat_template_kwargs: { enable_thinking: false } });
      if (actions && message.tool_calls?.length) {
        if (message.tool_calls.length > 10) throw new Error('Too many planner actions.');
        messages.push(message);
        for (const call of message.tool_calls) {
          let result;
          try { result = actions.run(call.function.name, JSON.parse(call.function.arguments || '{}'), call.id || `${round}-${messages.length}`); }
          catch { result = { error: 'Invalid planner arguments. Ask the user to clarify.' }; }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue;
      }
      if (typeof message.content === 'string' && message.content.trim()) return message.content;
      if (force) continue;
      throw new Error('Empty provider response');
    }
    const response = await gemini(ai, { model: process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash', contents,
      config: { systemInstruction: system, maxOutputTokens: 1200, httpOptions: { timeout: TIMEOUT },
        ...(actions ? { tools: [{ functionDeclarations: actions.tools }], ...(force ? { toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [force] } } } : {}) } : {}) }
    });
    if (actions && response.functionCalls?.length) {
      if (response.functionCalls.length > 10) throw new Error('Too many planner actions.');
      contents.push(response.candidates[0].content);
      contents.push({ role: 'user', parts: response.functionCalls.map((call, i) => ({ functionResponse: { name: call.name, response: actions.run(call.name, call.args || {}, call.id || `${round}-${i}`) } })) });
      continue;
    }
    if (response.text) return response.text;
    if (force) continue;
    throw new Error('Empty provider response');
  }
  return 'Please check your planner for the actions already saved. We reached the action limit for this message; tell me what you would like to do next.';
}
module.exports = { provider, configured, reply };
