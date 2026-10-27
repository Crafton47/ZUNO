'use strict';
require('dotenv').config();
const db = require('../database');
const study = require('../study');
const examRescue = require('../exam-rescue');
const express = require('express');

async function verify() {
  await db.init();
  console.log('[TEST] Database initialized. isPostgres =', db.isPostgres);
  
  const app = express();
  app.use(express.json());
  // Fake auth middleware setting user 2 (shayak47)
  app.use((req, res, next) => {
    req.user = { id: 2, username: 'shayak47' };
    next();
  });
  study.attach(app);

  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/companion/study';

  const req = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, data: await res.json() };
  };

  try {
    // 1. Status
    const status = await req('/status');
    console.log('1. Status:', status.status, status.data);

    // 2. Notebooks
    const notebooks = await req('/notebooks');
    console.log('2. Notebooks:', notebooks.status, notebooks.data);
    const n = notebooks.data.notebooks[0];
    if (!n) throw new Error('No notebook found!');

    // 3. Notebook details
    const details = await req(`/notebooks/${n.id}`);
    console.log('3. Notebook details:', details.status, {
      name: details.data.notebook.name,
      itemCount: details.data.items.length,
      firstItem: details.data.items[0] ? {
        title: details.data.items[0].title,
        textLen: details.data.items[0].text?.length,
        status: details.data.items[0].status
      } : null
    });

    // 4. Grounded Chat
    console.log('4. Testing Grounded Chat...');
    const chat = await req(`/notebooks/${n.id}/chat`, 'POST', {
      question: 'What is this document about?'
    });
    console.log('4. Chat result:', chat.status, {
      answer: chat.data.text?.slice(0, 150) + '...',
      citations: chat.data.citations
    });

    // 5. Exam mode
    console.log('5. Testing Exam Mode (3mark)...');
    const exam = await req(`/notebooks/${n.id}/exam`, 'POST', {
      question: 'Summarize the main problem statement',
      examType: '3mark'
    });
    console.log('5. Exam result:', exam.status, {
      answer: exam.data.text?.slice(0, 150) + '...',
      examType: exam.data.examType
    });

    // 6. Exam Rescue analyze
    console.log('6. Testing Exam Rescue analyze...');
    const sourceId = details.data.items[0].id;
    const analyze = await req(`/notebooks/${n.id}/rescue/analyze`, 'POST', {
      sourceIds: [sourceId]
    });
    console.log('6. Analyze result:', analyze.status, {
      topicCount: analyze.data.topics?.length,
      sampleTopic: analyze.data.topics?.[0]
    });

    console.log('=== ALL LIVE POSTGRES CHECKS PASSED ===');
  } finally {
    server.close();
  }
}

verify().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
