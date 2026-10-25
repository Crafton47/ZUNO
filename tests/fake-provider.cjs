// Loaded only by the isolated test child process. Never used by the application.
const sdk = require.resolve('@google/genai');
require.cache[sdk] = { id: sdk, filename: sdk, loaded: true, exports: { GoogleGenAI: class {
  constructor() {
    this.models = { generateContent: async ({ contents }) => {
      const part = contents.at(-1).parts[0];
      if (part.functionResponse) return { text: part.functionResponse.response.saved ? 'Saved to your planner.' : 'The task could not be saved.' };
      if (part.text === 'Add test study task to my planner') return {
        functionCalls: [{ id: 'text-task', name: 'add_tasks', args: { tasks: [{ title: 'Test study task' }] } }],
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'add_tasks', args: { tasks: [{ title: 'Test study task' }] } } }] } }]
      };
      return { text: 'Let us take one small step. ' + part.text };
    } };
    this.live = { connect: async ({ callbacks }) => {
      let closed = false, called = false;
      return {
        sendClientContent({ turnComplete }) {
          if (!turnComplete) return;
          setTimeout(() => { if (!closed) callbacks.onmessage({ serverContent: {
            outputTranscription: { text: 'Hello, how was your day?' },
            modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(4800).toString('base64') } }] }, turnComplete: true
          } }); }, 40);
        },
        sendRealtimeInput(data) {
          if (data.audio) callbacks.onmessage({ serverContent: { interrupted: true } });
          if (data.audio && !called) { called = true; callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'voice-task', name: 'add_tasks', args: { tasks: [{ title: 'Voice test task' }] } }] } }); }
        },
        sendToolResponse() {},
        close() { closed = true; }
      };
    } };
  }
} } };
