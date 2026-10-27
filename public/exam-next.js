'use strict';
(() => {
  const entry=document.getElementById('study-entry');if(!entry)return;
  const card=document.createElement('a');card.href='/study?section=rescue';card.className='study-entry';card.style.background='var(--surface)';card.style.color='var(--text)';card.textContent='◷ Exam Rescue · Build a study plan';entry.after(card);
  const token=localStorage.getItem('vibe_token');if(!token)return;
  async function refresh(){try{const r=await fetch('/api/companion/study/rescue/next',{headers:{Authorization:'Bearer '+token}});if(!r.ok)return;const {next}=await r.json();if(next){card.textContent='◷ Next study session: '+next.title+' · '+new Date(next.start).toLocaleString();card.href='/study?notebook='+encodeURIComponent(next.notebookId)+'&section=rescue';}}catch{}}
  refresh();window.addEventListener('focus',refresh);
})();
