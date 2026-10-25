const { GoogleGenAI } = require('@google/genai');
function provider() { return process.env.CHAT_PROVIDER || (process.env.NVIDIA_API_KEY ? 'nvidia' : 'gemini'); }
function configured() { return provider() === 'nvidia' ? Boolean(process.env.NVIDIA_API_KEY) : provider() === 'gemini' && Boolean(process.env.GEMINI_API_KEY); }
async function reply(system, history, text, actions) {
  const messages = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })), { role: 'user', content: text }];
  const contents = [...history.map(m => ({ role: m.role, parts: [{ text: m.text }] })), { role: 'user', parts: [{ text }] }];
  const ai = provider() === 'gemini' ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
  for (let round = 0; round < 5; round++) {
    if (provider() === 'nvidia') {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.NVIDIA_CHAT_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b', messages,
          ...(actions ? { tools: actions.tools.map(tool => ({ type: 'function', function: tool })), tool_choice: 'auto' } : {}),
          max_tokens: 1200, temperature: 0.7, stream: false, chat_template_kwargs: { enable_thinking: false } })
      });
      if (!response.ok) { const error = new Error('NVIDIA request failed'); error.status = response.status; throw error; }
      const data = await response.json(), message = data.choices?.[0]?.message;
      if (actions && message?.tool_calls?.length) {
        if (message.tool_calls.length > 10) throw new Error('Too many planner actions.');
        messages.push(message);
        for (const call of message.tool_calls) {
          let result;
          try { result = actions.run(call.function.name, JSON.parse(call.function.arguments), call.id || `${round}-${messages.length}`); }
          catch { result = { error: 'Invalid planner arguments. Ask the user to clarify.' }; }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue;
      }
      if (typeof message?.content !== 'string' || !message.content.trim()) throw new Error('Empty provider response');
      return message.content;
    }
    const response = await ai.models.generateContent({ model: process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash', contents,
      config: { systemInstruction: system, maxOutputTokens: 1200, httpOptions: { timeout: 20000 }, ...(actions ? { tools: [{ functionDeclarations: actions.tools }] } : {}) }
    });
    if (actions && response.functionCalls?.length) {
      if (response.functionCalls.length > 10) throw new Error('Too many planner actions.');
      contents.push(response.candidates[0].content);
      contents.push({ role: 'user', parts: response.functionCalls.map((call, i) => ({ functionResponse: { name: call.name, response: actions.run(call.name, call.args || {}, call.id || `${round}-${i}`) } })) });
      continue;
    }
    if (!response.text) throw new Error('Empty provider response');
    return response.text;
  }
  return 'Please check your planner for the actions already saved. We reached the action limit for this message; tell me what you would like to do next.';
}
module.exports = { provider, configured, reply };
