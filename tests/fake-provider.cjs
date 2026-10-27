// Loaded only by the isolated test child process. Never used by the application.
const sdk = require.resolve('@google/genai');
const calls = new Map();
require.cache[sdk] = { id: sdk, filename: sdk, loaded: true, exports: { GoogleGenAI: class {
  constructor() {
    this.models = { generateContent: async ({ contents }) => {
      const part = contents.at(-1).parts[0];
      if (part.functionResponse) {
        const tasks = part.functionResponse.response.tasks || [];
        if (tasks.some(task => task.title === 'Laundry')) return { text: 'Done! Laundry is set for tomorrow at 10am.' };
        return { text: part.functionResponse.response.saved ? 'Saved to your planner.' : 'The task could not be saved.' };
      }
      if (part.text === 'Add laundry tomorrow at 8pm') {
        const args = { tasks: [{ title: 'Laundry', when: 'tomorrow at 8pm' }] };
        return { functionCalls: [{ id: 'laundry-task', name: 'add_tasks', args }], candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'add_tasks', args } }] } }] };
      }
      if (part.text === 'Add test study task to my planner') return {
        functionCalls: [{ id: 'text-task', name: 'add_tasks', args: { tasks: [{ title: 'Test study task' }] } }],
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'add_tasks', args: { tasks: [{ title: 'Test study task' }] } } }] } }]
      };
      // Claims success without calling the tool, then complies on the forced retry.
      if (part.text === 'Remind me to call the dentist tomorrow at 5pm') {
        const seen = calls.get(part.text) || 0; calls.set(part.text, seen + 1);
        if (seen === 0) return { text: 'Done! I added it to your planner.' };
        const args = { tasks: [{ title: 'Call the dentist', when: 'tomorrow at 5pm' }] };
        return { functionCalls: [{ id: 'dentist-task', name: 'add_tasks', args }], candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'add_tasks', args } }] } }] };
      }
      // Always proposes an invalid task, so nothing can be saved.
      if (part.text === 'Add a task with a broken title') {
        const args = { tasks: [{ title: '' }] };
        return { functionCalls: [{ id: 'broken-task', name: 'add_tasks', args }], candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'add_tasks', args } }] } }] };
      }
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
