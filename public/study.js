/* ZUNO Study Studio — Interactive Learning Frontend
   Markdown renderer, answer toolbar, Exam Mode, Quiz Me, Flashcards, XP system.
   All rendering is sanitized; no raw AI HTML is ever injected directly. */
'use strict';
(() => {
  // ── Auth & helpers ────────────────────────────────────────────────────────────
  const token = localStorage.getItem('vibe_token');
  if (!token) { location.replace('/login.html'); return; }
  const $ = id => document.getElementById(id);

  let current = null, material = [], polling, working = false, editMode, taskRequest = crypto.randomUUID();
  const controllers = new Set();
  const status = text => { $('error').textContent = text; $('error').hidden = !text; };

  async function api(path, method = 'GET', body) {
    const ctrl = new AbortController(); controllers.add(ctrl);
    const timeout = setTimeout(() => ctrl.abort(), 150000);
    try {
      const r = await fetch('/api/companion/study' + path, {
        method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await r.json();
      if (r.status === 401) location.replace('/login.html');
      if (!r.ok) throw new Error(data.error || 'Could not complete the study operation.');
      return data;
    } finally { clearTimeout(timeout); controllers.delete(ctrl); }
  }

  function path(suffix = '') { return '/notebooks/' + encodeURIComponent(current) + suffix; }

  function button(label, action, className = '') {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = label; el.className = className; el.onclick = action;
    return el;
  }

  async function action(fn) {
    if (working) return;
    working = true; clearTimeout(polling); status('');
    const controls = [...document.querySelectorAll('#workspace button, dialog button, #upload-form button')];
    controls.forEach(b => b.disabled = true);
    try { await fn(); } catch (e) { status(e.message); }
    finally { working = false; controls.forEach(b => b.disabled = false); schedulePoll(); }
  }

  // ── Lightweight safe Markdown renderer ────────────────────────────────────────
  // No external dependency. Renders headings, bold, italic, code, lists, tables,
  // blockquotes, links, HR. Guaranteed O(N) linear time, never freezes.
  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function inlineFormat(str) {
    str = escapeHtml(str);
    str = str.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    str = str.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    str = str.replace(/_([^_]+)_/g, '<em>$1</em>');
    str = str.replace(/`([^`]+)`/g, '<code>$1</code>');
    str = str.replace(/~~(.+?)~~/g, '<del>$1</del>');
    str = str.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, text, url) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`);
    return str;
  }

  function renderTable(tableLines) {
    const rows = tableLines.map(l => l.split('|').slice(1, -1).map(c => c.trim()));
    if (rows.length < 2) return '<p>' + tableLines.map(escapeHtml).join('<br>') + '</p>';
    const header = rows[0], isDiv = rows[1].every(c => /^[-: ]+$/.test(c));
    const body = isDiv ? rows.slice(2) : rows.slice(1);
    return '<table><thead><tr>' + header.map(c => '<th>' + inlineFormat(c) + '</th>').join('') + '</tr></thead><tbody>' +
      body.map(r => '<tr>' + r.map(c => '<td>' + inlineFormat(c) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';
  }

  function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';
    const codeBlocks = [];
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push('<pre><code>' + escapeHtml(code.trim()) + '</code></pre>');
      return '\n\x00CODE' + (codeBlocks.length - 1) + '\x00\n';
    });

    const lines = text.split('\n');
    const out = [];
    let inList = null, inBlockquote = false, bqLines = [];

    function flushList() {
      if (inList) {
        out.push(inList === 'ul' ? '</ul>' : '</ol>');
        inList = null;
      }
    }
    function flushBlockquote() {
      if (inBlockquote) {
        out.push('<blockquote>' + bqLines.map(inlineFormat).join('<br>') + '</blockquote>');
        inBlockquote = false;
        bqLines = [];
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        flushList();
        flushBlockquote();
        continue;
      }

      const cbMatch = trimmed.match(/^\x00CODE(\d+)\x00$/);
      if (cbMatch) {
        flushList();
        flushBlockquote();
        out.push(codeBlocks[Number(cbMatch[1])]);
        continue;
      }

      if (line.startsWith('>')) {
        flushList();
        inBlockquote = true;
        bqLines.push(line.replace(/^>\s?/, ''));
        continue;
      } else {
        flushBlockquote();
      }

      const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        flushList();
        out.push(`<h${hMatch[1].length}>${inlineFormat(hMatch[2])}</h${hMatch[1].length}>`);
        continue;
      }

      if (/^[-*_]{3,}$/.test(trimmed)) {
        flushList();
        out.push('<hr>');
        continue;
      }

      if (/^\|.*\|$/.test(trimmed)) {
        flushList();
        const tableLines = [trimmed];
        while (i + 1 < lines.length && /^\|.*\|$/.test(lines[i + 1].trim())) {
          i++;
          tableLines.push(lines[i].trim());
        }
        out.push(renderTable(tableLines));
        continue;
      }

      const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
      if (ulMatch) {
        if (inList !== 'ul') {
          flushList();
          inList = 'ul';
          out.push('<ul>');
        }
        out.push('<li>' + inlineFormat(ulMatch[1]) + '</li>');
        continue;
      }

      const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
      if (olMatch) {
        if (inList !== 'ol') {
          flushList();
          inList = 'ol';
          out.push('<ol>');
        }
        out.push('<li>' + inlineFormat(olMatch[1]) + '</li>');
        continue;
      }

      flushList();
      out.push('<p>' + inlineFormat(trimmed) + '</p>');
    }

    flushList();
    flushBlockquote();
    return out.join('\n');
  }

  // ── Mode Toggle ───────────────────────────────────────────────────────────────
  function setMode(focus) {
    document.documentElement.dataset.mode = focus ? 'focus' : 'play';
    $('mode-toggle').textContent = focus ? 'Play mode' : 'Focus mode';
    $('mode-toggle').setAttribute('aria-pressed', String(focus));
    localStorage.setItem('zuno-mode', focus ? 'focus' : 'play');
  }
  setMode(localStorage.getItem('zuno-mode') === 'focus');
  $('mode-toggle').onclick = () => setMode(document.documentElement.dataset.mode !== 'focus');

  // ── Active tab ────────────────────────────────────────────────────────────────
  let activeTab = 'ask'; // 'ask' | 'exam' | 'quiz' | 'flashcard'
  // Tab keys match HTML panel IDs: ask-panel, exam-panel, quiz-panel, flashcard-panel
  function showTab(tab, syncSection = true) {
    if (syncSection && window.ZunoRescue) window.ZunoRescue.section(tab === 'ask' ? 'ask' : 'practice', false);
    activeTab = tab;
    ['ask', 'exam', 'quiz', 'flashcard'].forEach(t => {
      const panel = $(t + '-panel');
      const btn = t === 'flashcard' ? $('tab-flashcards') : $('tab-' + t);
      if (panel) panel.hidden = t !== tab;
      if (btn) {
        btn.classList.toggle('active', t === tab);
        btn.setAttribute('aria-selected', String(t === tab));
      }
    });
  }
  // Tab button click listeners
  ['ask', 'exam', 'quiz'].forEach(t => {
    const btn = $('tab-' + t);
    if (btn) btn.onclick = () => showTab(t);
  });
  const fcTabBtn = $('tab-flashcards');
  if (fcTabBtn) fcTabBtn.onclick = () => {
    showTab('flashcard');
    if (!cards.length && current) loadFlashcards();
  };

  // ── XP System ─────────────────────────────────────────────────────────────────
  async function loadXP() {
    try {
      const data = await api('/xp');
      const wrap = $('xp-bar-wrap');
      if (!wrap) return;
      $('xp-level').textContent = 'Level ' + data.level;
      $('xp-total').textContent = data.total + ' XP';
      const pct = Math.min(100, ((data.total % 100) / 100) * 100);
      $('xp-fill').style.width = pct + '%';
    } catch {}
  }

  function showXPToast(msg) {
    const t = document.createElement('div');
    t.className = 'xp-toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2300);
  }

  async function earnXP(event, score) {
    try {
      const data = await api(path('/xp'), 'POST', { event, score });
      if (data.earned > 0) { showXPToast(data.message); await loadXP(); }
    } catch {}
  }

  // ── Notebooks home ────────────────────────────────────────────────────────────
  async function home() {
    window.ZunoRescue?.section('notebooks', false);
    clearTimeout(polling);
    $('workspace').hidden = true; $('home').hidden = false;
    const { notebooks } = await api('/notebooks');
    $('notebooks').replaceChildren();
    if (!notebooks.length) {
      const empty = document.createElement('p');
      empty.className = 'muted'; empty.textContent = 'A fresh page. Create your first notebook to start.';
      $('notebooks').appendChild(empty);
    }
    for (const n of notebooks) {
      const card = document.createElement('button');
      card.className = 'notebook-card'; card.type = 'button'; card.onclick = () => action(() => open(n.id));
      const title = document.createElement('strong'); title.textContent = n.name;
      const date = document.createElement('small'); date.textContent = 'Opened ' + new Date(n.opened_at).toLocaleString();
      const count = document.createElement('span'); count.textContent = '▤ ' + n.documentCount + ' documents · Open notebook ↗';
      card.append(title, count, date);
      const entry = document.createElement('article'); entry.className = 'notebook-entry';
      const menu = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Notebook options';
      menu.append(summary, button('Rename', () => action(async () => { await open(n.id); edit('rename', n.name); })), button('Delete', () => action(async () => { await open(n.id); $('delete-dialog').showModal(); })));
      entry.append(card, menu); $('notebooks').append(entry);
    }
    await loadXP();
  }

  // ── Source viewer ─────────────────────────────────────────────────────────────
  function showSource(id) {
    const source = material.find(s => s.id === id);
    if (!source) return status('This reference is no longer available.');
    $('source-title').textContent = source.title;
    $('source-text').textContent = source.text || 'No extracted text yet. Processing may still be running.';
    $('source-dialog').showModal();
  }

  // ── Sources sidebar ───────────────────────────────────────────────────────────
  function renderSources() {
    $('sources').replaceChildren();
    const query = $('source-filter').value.toLowerCase();
    const filtered = material.filter(s => (s.title + ' ' + s.text).toLowerCase().includes(query));
    if (!filtered.length) {
      const p = document.createElement('p'); p.className = 'muted';
      p.textContent = material.length ? 'No matching material.' : 'No sources yet. Upload your first document.';
      $('sources').appendChild(p); return;
    }
    for (const s of filtered) {
      const row = document.createElement('div'); row.className = 'source-row';
      const state = document.createElement('small');
      state.textContent = `${s.kind} · ${s.status}${s.status === 'completed' && !s.text ? ' · no text extracted' : ''}`;
      row.append(button(s.title, () => showSource(s.id)), state);
      $('sources').append(row);
    }
  }

  // ── Answer rendering ──────────────────────────────────────────────────────────
  function renderAnswers(messages) {
    $('answers').replaceChildren();
    for (const m of messages) renderOneAnswer(m);
  }

  function renderOneAnswer(m) {
    const row = document.createElement('section'); row.className = 'answer';
    if (m.id) row.dataset.msgId = m.id;

    // Question label
    const q = document.createElement('div'); q.className = 'answer-q';
    if (m.examType) q.classList.add('exam-mode');
    if (m.simple) q.classList.add('simple-mode');
    q.appendChild(document.createTextNode(m.question));
    row.append(q);

    // Markdown-rendered answer body
    const body = document.createElement('div'); body.className = 'answer-body';
    body.innerHTML = renderMarkdown(m.answer);
    row.append(body);

    // Citations
    if (m.citations && m.citations.length) {
      const chips = document.createElement('div'); chips.className = 'citation-chips';
      m.citations.forEach((c, i) => {
        const chip = button(`[${i + 1}] ${c.title}`, () => showSource(c.id), 'citation-chip');
        chips.append(chip);
      });
      row.append(chips);
    }

    // Grounding notice
    const g = document.createElement('p'); g.className = 'answer-grounding';
    g.textContent = m.citations && m.citations.length
      ? 'References supplied by the model; inspect the source below. References identify sources, not independently verified claims.'
      : 'No verified source references were supplied in this answer.';
    row.append(g);

    // Toolbar
    const toolbar = document.createElement('div'); toolbar.className = 'answer-toolbar';

    // Copy
    const copyBtn = button('📋 Copy', async () => {
      await navigator.clipboard.writeText(m.answer).catch(() => {});
      copyBtn.textContent = '✓ Copied'; setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
    }, 'toolbar-btn');
    toolbar.append(copyBtn);

    // Save as note
    toolbar.append(button('💾 Save note', () => edit('note', m.question.slice(0, 150), m.answer), 'toolbar-btn'));

    // Explain simply (only on regular answers)
    if (!m.simple && !m.examType) {
      toolbar.append(button('💡 Explain simply', () => action(() => explainSimply(m.question)), 'toolbar-btn'));
    }

    // Exam mode quick-trigger (only on regular answers)
    if (!m.examType) {
      toolbar.append(button('📝 Exam answer', () => { showTab('exam'); $('exam-question').value = m.question; }, 'toolbar-btn'));
    }

    // Quiz me
    toolbar.append(button('🎯 Quiz me', () => {
      showTab('quiz');
      $('quiz-topic').value = m.question.slice(0, 150);
      action(() => generateQuiz(m.question));
    }, 'toolbar-btn'));

    // Flashcards
    toolbar.append(button('🃏 Flashcards', () => {
      showTab('flashcard');
      $('fc-topic').value = m.question.slice(0, 150);
      action(() => generateFlashcards(m.question));
    }, 'toolbar-btn'));

    // Feedback (only if message has an ID)
    if (m.id) {
      const helpBtn = button('👍', () => sendFeedback(m.id, true, helpBtn, nothelpBtn), 'toolbar-btn');
      const nothelpBtn = button('👎', () => sendFeedback(m.id, false, helpBtn, nothelpBtn), 'toolbar-btn');
      toolbar.append(helpBtn, nothelpBtn);
    }

    row.append(toolbar);
    $('answers').append(row);
  }

  async function sendFeedback(msgId, helpful, btn1, btn2) {
    try {
      await api(path('/feedback'), 'POST', { messageId: msgId, helpful });
      btn1.disabled = true; btn2.disabled = true;
      if (helpful) btn1.textContent = '👍 Thanks!'; else btn2.textContent = '👎 Noted';
    } catch {}
  }

  // ── Explain Simply ────────────────────────────────────────────────────────────
  async function explainSimply(question) {
    $('question-status').textContent = '💡 Simplifying…';
    try {
      const data = await api(path('/explain'), 'POST', { question });
      const msg = { id: data.id, question: 'Explain simply: ' + question, answer: data.text, citations: data.citations || [], simple: true };
      renderOneAnswer(msg);
      $('answers').scrollTop = $('answers').scrollHeight;
    } finally { $('question-status').textContent = ''; }
  }

  // ── Exam Mode ─────────────────────────────────────────────────────────────────
  let selectedExamType = '5mark';
  document.querySelectorAll('.exam-chip').forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll('.exam-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedExamType = chip.dataset.exam;
    };
  });

  $('exam-form').onsubmit = e => {
    e.preventDefault();
    action(async () => {
      const q = $('exam-question').value.trim();
      $('exam-status').textContent = '📝 Generating ' + selectedExamType + ' answer…';
      try {
        const data = await api(path('/exam'), 'POST', { question: q, examType: selectedExamType });
        showTab('ask');
        const msg = { question: q + ' (' + selectedExamType + ')', answer: data.text, citations: data.citations || [], examType: selectedExamType };
        renderOneAnswer(msg);
        $('answers').scrollTop = $('answers').scrollHeight;
        await earnXP('exam_viewed', 0);
      } finally { $('exam-status').textContent = ''; }
    });
  };

  // ── Quiz Me ───────────────────────────────────────────────────────────────────
  let quiz = { questions: [], current: 0, score: 0, answered: false };

  async function generateQuiz(topic) {
    $('quiz-status').textContent = '🎯 Generating quiz from notebook…';
    if ($('quiz-empty-state')) $('quiz-empty-state').hidden = true;
    try {
      const data = await api(path('/quiz'), 'POST', { topic: topic || '' });
      quiz = { questions: data.questions, current: 0, score: 0, answered: false };
      renderQuizQuestion();
    } catch (e) {
      if ($('quiz-empty-state') && !quiz.questions.length) $('quiz-empty-state').hidden = false;
      throw e;
    } finally { $('quiz-status').textContent = ''; }
  }

  $('quiz-generate').onclick = () => action(() => generateQuiz($('quiz-topic').value));
  $('quiz-empty-generate')?.addEventListener('click', () => action(() => generateQuiz($('quiz-topic').value)));

  document.querySelectorAll('.quiz-preset-chip').forEach(btn => {
    btn.onclick = () => {
      $('quiz-topic').value = btn.dataset.topic || '';
      action(() => generateQuiz(btn.dataset.topic || ''));
    };
  });

  function renderQuizQuestion() {
    const q = quiz.questions[quiz.current];
    if (!q) { renderQuizResults(); return; }
    quiz.answered = false;
    if ($('quiz-empty-state')) $('quiz-empty-state').hidden = true;
    $('quiz-progress').textContent = `Question ${quiz.current + 1} of ${quiz.questions.length}`;
    $('quiz-bar-fill').style.width = ((quiz.current / quiz.questions.length) * 100) + '%';
    $('quiz-question-text').textContent = q.question;
    const opts = $('quiz-options');
    opts.replaceChildren();
    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'quiz-option';
      const letter = document.createElement('span'); letter.className = 'opt-letter';
      letter.textContent = 'ABCD'[idx];
      const text = document.createElement('span'); text.textContent = opt;
      btn.append(letter, text);
      btn.onclick = () => { if (!quiz.answered) answerQuiz(idx); };
      opts.append(btn);
    });
    $('quiz-explanation').hidden = true;
    $('quiz-next').hidden = false;
    $('quiz-header').hidden = false;
    $('quiz-results-wrap').hidden = true;
    $('quiz-card').hidden = false;
  }

  function answerQuiz(chosen) {
    if (quiz.answered) return;
    quiz.answered = true;
    const q = quiz.questions[quiz.current];
    const opts = $('quiz-options').querySelectorAll('.quiz-option');
    opts.forEach(o => o.classList.add('answered'));
    opts[q.correct].classList.add('correct');
    if (chosen !== q.correct) opts[chosen].classList.add('wrong');
    else quiz.score++;
    // Show explanation
    const exp = $('quiz-explanation');
    exp.innerHTML = '<strong>' + (chosen === q.correct ? '✓ Correct!' : '✗ Not quite.') + '</strong> ' + escapeHtml(q.explanation);
    exp.hidden = false;
  }

  $('quiz-next').onclick = () => {
    quiz.current++;
    if (quiz.current >= quiz.questions.length) { renderQuizResults(); return; }
    renderQuizQuestion();
  };

  async function renderQuizResults() {
    $('quiz-card').hidden = true;
    $('quiz-header').hidden = true;
    $('quiz-results-wrap').hidden = false;
    const pct = quiz.questions.length ? Math.round((quiz.score / quiz.questions.length) * 100) : 0;
    $('quiz-score-display').textContent = pct + '%';
    $('quiz-score-msg').textContent = pct >= 80 ? '🔥 Excellent work!' : pct >= 50 ? '👍 Good effort! Keep going.' : '📚 Keep studying — you\'ll get there!';
    $('quiz-score-detail').textContent = `${quiz.score} of ${quiz.questions.length} correct`;
    $('quiz-bar-fill').style.width = '100%';
    await earnXP('quiz_complete', quiz.questions.length ? quiz.score / quiz.questions.length : 0);
    await api(path('/rescue/quiz-result'), 'POST', { score: quiz.score, total: quiz.questions.length, topic: $('quiz-topic').value }).catch(() => {});
  }

  $('quiz-retry').onclick = () => {
    if (quiz.questions.length) { quiz.current = 0; quiz.score = 0; renderQuizQuestion(); }
  };

  // ── Flashcards ────────────────────────────────────────────────────────────────
  let cards = [], cardIndex = 0, cardFlipped = false;

  async function generateFlashcards(topic) {
    $('fc-status').textContent = '🃏 Generating flashcards from notebook…';
    if ($('fc-empty-state')) $('fc-empty-state').hidden = true;
    try {
      const data = await api(path('/flashcards/generate'), 'POST', { topic: topic || $('fc-topic').value });
      cards = data.flashcards; cardIndex = 0;
      renderFlashcard();
      await earnXP('flashcard_session', 0);
    } catch (e) {
      if ($('fc-empty-state') && !cards.length) $('fc-empty-state').hidden = false;
      throw e;
    } finally { $('fc-status').textContent = ''; }
  }

  async function loadFlashcards() {
    $('fc-status').textContent = 'Loading saved cards…';
    try {
      const data = await api(path('/flashcards'));
      if (data.flashcards && data.flashcards.length) {
        cards = data.flashcards; cardIndex = 0; renderFlashcard();
      } else {
        renderFlashcard();
      }
    } finally { $('fc-status').textContent = ''; }
  }

  $('fc-generate').onclick = () => action(() => generateFlashcards($('fc-topic').value));
  $('fc-load').onclick = () => action(loadFlashcards);
  $('fc-empty-generate')?.addEventListener('click', () => action(() => generateFlashcards($('fc-topic').value)));
  $('fc-empty-load')?.addEventListener('click', () => action(loadFlashcards));

  document.querySelectorAll('.fc-preset-chip').forEach(btn => {
    btn.onclick = () => {
      $('fc-topic').value = btn.dataset.topic || '';
      action(() => generateFlashcards(btn.dataset.topic || ''));
    };
  });

  function renderFlashcard() {
    if (!cards.length) {
      if ($('fc-empty-state')) $('fc-empty-state').hidden = false;
      $('fc-scene').style.display = 'none';
      $('fc-actions').hidden = true;
      $('fc-count').textContent = '';
      $('fc-diff').style.display = 'none';
      return;
    }
    if ($('fc-empty-state')) $('fc-empty-state').hidden = true;
    $('fc-scene').style.display = '';
    $('fc-actions').hidden = false;
    $('fc-diff').style.display = '';
    cardFlipped = false;
    const c = cards[cardIndex];
    $('fc-front-text').textContent = c.front;
    $('fc-back-text').textContent = c.back;
    $('fc-card-inner').classList.remove('flipped');
    $('fc-count').textContent = `Card ${cardIndex + 1} of ${cards.length}`;
    const diff = c.difficulty || 'new';
    const diffEl = $('fc-diff'); diffEl.textContent = diff; diffEl.className = 'fc-diff ' + diff;
    renderFlashcardList();
  }

  $('fc-scene').onclick = () => {
    cardFlipped = !cardFlipped;
    $('fc-card-inner').classList.toggle('flipped', cardFlipped);
  };
  $('fc-scene').onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('fc-scene').click();
    }
  };
  $('fc-prev').onclick = () => { if (cardIndex > 0) { cardIndex--; renderFlashcard(); } };
  $('fc-next').onclick = () => { if (cardIndex < cards.length - 1) { cardIndex++; renderFlashcard(); } };

  $('fc-easy').onclick = () => action(async () => {
    await api(path('/flashcards/' + cards[cardIndex].id), 'PATCH', { difficulty: 'easy' });
    cards[cardIndex].difficulty = 'easy';
    if (cardIndex < cards.length - 1) { cardIndex++; } else { cardIndex = 0; }
    renderFlashcard();
    await earnXP('flashcard_session', 0);
  });
  $('fc-hard').onclick = () => action(async () => {
    await api(path('/flashcards/' + cards[cardIndex].id), 'PATCH', { difficulty: 'hard' });
    cards[cardIndex].difficulty = 'hard';
    if (cardIndex < cards.length - 1) { cardIndex++; } else { cardIndex = 0; }
    renderFlashcard();
  });

  function renderFlashcardList() {
    const list = $('fc-list');
    if (!list) return;
    list.replaceChildren();
    cards.forEach((c, i) => {
      const item = document.createElement('div'); item.className = 'fc-list-item';
      const info = document.createElement('div');
      const q = document.createElement('div'); q.className = 'fc-q'; q.textContent = c.front;
      const a = document.createElement('div'); a.className = 'fc-a'; a.textContent = c.back;
      info.append(q, a);
      const diff = document.createElement('span'); diff.className = 'fc-diff ' + (c.difficulty || 'new'); diff.textContent = c.difficulty || 'new';
      const del = button('×', () => action(async () => {
        await api(path('/flashcards/' + c.id), 'DELETE');
        cards.splice(i, 1);
        if (cardIndex >= cards.length) cardIndex = Math.max(0, cards.length - 1);
        renderFlashcard();
      }), 'btn-icon'); del.title = 'Remove';
      item.append(info, diff, del);
      list.append(item);
    });
  }

  // ── Polling / refresh ─────────────────────────────────────────────────────────
  function schedulePoll() {
    clearTimeout(polling);
    if (current && !working && material.some(s => !['completed', 'failed', 'error'].includes(s.status)))
      polling = setTimeout(() => action(refresh), 5000);
  }

  async function refresh() {
    if (!current) return;
    const data = await api(path());
    material = data.items;
    window.dispatchEvent(new CustomEvent('study:material', { detail: { id: current, material } }));
    $('notebook-name').textContent = data.notebook.name;
    renderSources();
    renderAnswers(data.messages);
    // Tasks
    $('linked-tasks').replaceChildren();
    for (const task of data.tasks) {
      const line = document.createElement('div'); line.className = 'linked-task';
      const icon = document.createElement('span'); icon.className = 'task-check' + (task.completed ? '' : ' pending'); icon.textContent = task.completed ? '✓' : '○';
      const info = document.createElement('div'); info.className = 'task-info';
      const title = document.createElement('strong'); title.textContent = task.title;
      const due = document.createElement('small'); due.textContent = new Date(task.due_at).toLocaleString();
      info.append(title, due); line.append(icon, info); $('linked-tasks').append(line);
    }
  }

  async function open(id) {
    const previous = current;
    current = id; $('source-filter').value = '';
    try { await refresh(); } catch (error) { current = previous; throw error; }
    showTab('ask', false);
    $('home').hidden = true; $('workspace').hidden = false;
    const url = new URL(location.href); url.searchParams.set('notebook', id); history.replaceState(null, '', url);
    $('notebook-name').focus();
    await loadXP();
    if (window.ZunoRescue) await window.ZunoRescue.notebookOpened();
    window.dispatchEvent(new CustomEvent('study:notebook', { detail: { id: current, material } }));
  }

  // ── Edit dialog ───────────────────────────────────────────────────────────────
  function edit(mode, name = '', content = '') {
    editMode = mode;
    $('edit-heading').textContent = mode === 'create' ? 'A new notebook' : mode === 'rename' ? 'Rename notebook' : 'Save a note';
    $('edit-name').value = name; $('note-content').value = content;
    $('note-body').hidden = mode !== 'note'; $('note-content').required = mode === 'note';
    $('edit-error').textContent = ''; $('edit-dialog').showModal();
  }

  $('new-notebook').onclick = () => edit('create');
  $('rename').onclick = () => edit('rename', $('notebook-name').textContent);
  $('new-note').onclick = () => edit('note');
  $('edit-cancel').onclick = () => $('edit-dialog').close();
  $('source-close').onclick = () => $('source-dialog').close();

  $('edit-form').onsubmit = event => {
    event.preventDefault();
    action(async () => {
      try {
        if (editMode === 'create') { const data = await api('/notebooks', 'POST', { name: $('edit-name').value }); await open(data.notebook.id); }
        else if (editMode === 'rename') { await api(path(), 'PATCH', { name: $('edit-name').value }); await refresh(); }
        else { await api(path('/notes'), 'POST', { title: $('edit-name').value, content: $('note-content').value }); await refresh(); }
        $('edit-dialog').close();
      } catch (e) { $('edit-error').textContent = e.message; }
    });
  };

  // ── Delete dialog ─────────────────────────────────────────────────────────────
  $('back').onclick = () => action(home);
  $('refresh-sources').onclick = () => action(refresh);
  $('source-filter').oninput = renderSources;
  $('delete').onclick = () => { $('delete-error').textContent = ''; $('delete-dialog').showModal(); };
  $('delete-cancel').onclick = () => $('delete-dialog').close();
  $('delete-confirm').onclick = () => action(async () => {
    try { await api(path(), 'DELETE', { confirm: true }); current = null; material = []; $('delete-dialog').close(); await home(); }
    catch (e) { $('delete-error').textContent = e.message; }
  });

  // ── Upload ────────────────────────────────────────────────────────────────────
  let uploadRequest;
  $('upload-form').onsubmit = event => {
    event.preventDefault();
    action(async () => {
      const file = $('document').files[0]; if (!file) return;
      if (file.size > 15 * 1024 * 1024) throw new Error('Please choose a document under 15 MB.');
      $('upload-progress').hidden = false; $('upload-progress').value = 0;
      $('upload-status').textContent = 'Uploading…';
      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest(); uploadRequest = xhr;
          xhr.open('POST', '/api/companion/study' + path('/sources'));
          xhr.setRequestHeader('Authorization', 'Bearer ' + token);
          xhr.timeout = 150000;
          xhr.upload.onprogress = e => {
            if (e.lengthComputable) $('upload-progress').value = e.loaded / e.total * 100;
            if (e.loaded === e.total) $('upload-status').textContent = 'Transfer done. Waiting for processing…';
          };
          xhr.onload = () => {
            try { const d = JSON.parse(xhr.responseText); xhr.status < 300 ? resolve(d) : reject(new Error(d.error || 'Upload failed.')); }
            catch { reject(new Error('Upload failed.')); }
          };
          xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error('Upload interrupted. Check connection and retry.'));
          const body = new FormData(); body.append('file', file); xhr.send(body);
        });
        $('upload-status').textContent = 'Uploaded. Processing status shown below.';
        $('document').value = ''; await refresh();
      } catch (e) { $('upload-status').textContent = 'Upload did not complete.'; throw e; }
      finally { uploadRequest = null; $('upload-progress').hidden = true; }
    });
  };

  // ── Ask Q&A ───────────────────────────────────────────────────────────────────
  async function ask(question) {
    $('question-status').textContent = 'Reading your notebook and preparing an answer…';
    try {
      const data = await api(path('/chat'), 'POST', { question });
      const msg = { id: data.id, question, answer: data.text, citations: data.citations || [] };
      renderOneAnswer(msg);
      $('question').value = '';
      $('answers').scrollTop = $('answers').scrollHeight;
    } finally { $('question-status').textContent = ''; }
  }

  $('question-form').onsubmit = e => { e.preventDefault(); action(() => ask($('answer-style').value + ': ' + $('question').value)); };

  $('summarize').onclick = () => action(() => ask('Summarize the key concepts in this notebook. Include supporting source references and a short revision checklist.'));

  // Suggested prompt chips
  document.querySelectorAll('.prompt-chip[data-prompt]').forEach(chip => {
    chip.onclick = () => { $('question').value = chip.dataset.prompt; $('question').focus(); };
  });

  // ── Task form ─────────────────────────────────────────────────────────────────
  $('task-form').onsubmit = e => {
    e.preventDefault();
    action(async () => {
      await api(path('/tasks'), 'POST', { title: $('task-title').value, dueAt: new Date($('task-due').value).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, requestId: taskRequest });
      taskRequest = crypto.randomUUID();
      $('task-status').textContent = 'Saved in your planner. ✓';
      await refresh();
    });
  };

  // ── Boot ──────────────────────────────────────────────────────────────────────
  async function boot() {
    $('retry').hidden = true;
    const data = await api('/status');
    $('connection').textContent = data.message;
    if (!data.available) { window.ZunoRescue?.ready(); return; }
    const id = new URLSearchParams(location.search).get('notebook');
    await (id ? open(id) : home());
    window.ZunoRescue?.ready();
    schedulePoll();
  }

  window.ZunoStudy = { api, current: () => current, material: () => material, home, showTab, open, refresh, isWorking: () => working,
    createNotebook(name = '') { edit('create', name); },
    summarize() { return action(() => ask('Summarize the key concepts in this notebook. Include supporting source references and a short revision checklist.')); },
    review(question, answer) { showTab('ask'); return action(() => ask('Review my short answer against the notebook. Identify what is correct, missing or mistaken, then suggest an improved answer with source citations. Question: '+question+'\nMy answer: '+answer)); },
    explain(topic, style) { showTab('ask'); $('question').value = (style || 'Explain') + ': ' + topic; $('question').focus(); },
    quiz(topic) { showTab('quiz'); $('quiz-topic').value = topic; },
    source(id) { const item = material.find(s => s.id === id); if (item) { $('source-title').textContent = item.title; $('source-text').textContent = item.text || 'Text is still processing.'; $('source-dialog').showModal(); } }
  };
  $('retry').onclick = () => action(boot);
  boot().catch(e => {
    status(e.message);
    $('connection').textContent = 'Study Studio is unavailable. Your companion and planner are still available.';
    $('retry').hidden = false;
  });

  window.addEventListener('pagehide', () => {
    clearTimeout(polling); controllers.forEach(c => c.abort()); uploadRequest?.abort();
  });
})();
