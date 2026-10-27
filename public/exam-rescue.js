'use strict';
(() => {
  const $=id=>document.getElementById(id), study=window.ZunoStudy;
  if(!study) return;
  const initial = new URLSearchParams(location.search);
  const validSections = ['notebooks', 'ask', 'practice', 'rescue'];
  let activeSection = validSections.includes(initial.get('section')) ? initial.get('section') : (initial.has('notebook') ? 'ask' : 'notebooks');
  const initialSection = activeSection;
  let topics=[], plans=[], plan=null, preview=null, busy=false, commitments=[], quiz=[], savedPlans=[];
  let wizardOpen=false, wizardStep=1, loadedNotebook=null, requestedTopic=initial.get('topic'), pendingAction=null, desiredPlan=null, retryAction=null;
  const uploadHome = $('upload-form').parentElement;
  // Planner fields sit beside the upload form, never around it. Associate
  // them explicitly so keyboard submission still targets the planner.
  document.querySelectorAll('#rescue-setup input, #rescue-setup select').forEach(field=>field.setAttribute('form','rescue-form'));
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const btn=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=()=>run(fn);return b;};
  const endpoint=s=>{if(!study.current())throw new Error('Choose a notebook in The material step first.');return '/notebooks/'+encodeURIComponent(study.current())+'/rescue'+s;};
  async function run(fn) {
    if(busy) { $('rescue-status').textContent='Finishing the current step. Your navigation is still available.'; return; }
    busy=true; retryAction=fn; $('rescue-retry').hidden=true;
    const controls=[...document.querySelectorAll('#rescue-panel button, #rescue-panel select, #rescue-panel input')].filter(b=>!b.disabled);
    controls.forEach(b=>b.disabled=true); $('rescue-panel').setAttribute('aria-busy','true');
    try { await fn(); }
    catch(e) { $('rescue-status').textContent=e.message; $('rescue-retry').hidden=false; document.querySelectorAll('#rescue-phases li[data-state=active]').forEach(n=>n.dataset.state='error'); }
    finally { busy=false; controls.forEach(b=>b.disabled=false); $('rescue-panel').removeAttribute('aria-busy'); }
  }
  function section(name,activate=true) {
    if(!validSections.includes(name))name='notebooks';
    activeSection=name; document.body.dataset.studySection=name;
    const url=new URL(location.href);url.searchParams.set('section',name);
    const currNotebook = study.current() || (name !== 'notebooks' ? initial.get('notebook') : null);
    if(currNotebook) url.searchParams.set('notebook', currNotebook); else url.searchParams.delete('notebook');
    history.replaceState(null,'',url);
    document.querySelectorAll('[data-section]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.section===name)));
    $('section-hint').hidden=true; $('rescue-panel').hidden=name!=='rescue'; $('home').hidden=name!=='notebooks';
    $('workspace').hidden=!study.current()||!['ask','practice'].includes(name);
    $('study-picker').hidden=!!study.current()||!['ask','practice'].includes(name);
    if(name==='rescue'&&wizardOpen&&wizardStep===2)$('rescue-upload-host').append($('upload-form'));
    else uploadHome.prepend($('upload-form'));
    if(activate){
      if(name==='notebooks')study.home().catch(showPickerError);
      else if(name==='ask'&&study.current())study.showTab('ask',false);
      else if(name==='practice'&&study.current())study.showTab('quiz',false);
      else if(name==='ask'||name==='practice')refreshPicker();
      if(name==='rescue'&&!study.current())loadSavedHome();
    }
    document.querySelector('.studio-sections').style.setProperty('--active-tab',validSections.indexOf(name));
  }
  function showPickerError(e){$('picker-status').textContent=e.message;}
  async function notebookCards(host, choose) {
    host.replaceChildren(el('p','Finding your notebooks?'));
    const {notebooks}=await study.api('/notebooks');host.replaceChildren();
    if(!notebooks.length)host.append(el('p','Your first notebook starts here. Create one, then add your notes.','notebook-empty'));
    for(const n of notebooks){const card=btn('',()=>choose(n));card.className='notebook-choice';card.setAttribute('aria-pressed',String(study.current()===n.id));card.append(el('span','?','notebook-icon'),el('strong',n.name),el('small',(n.documentCount||0)+' documents'),el('span',study.current()===n.id?'Selected ?':'Use this notebook ?','notebook-choice-action'));host.append(card);}
  }
  async function refreshPicker(){
    const practice=activeSection==='practice';$('picker-title').textContent=practice?'Make it stick.':'Your notes. A clearer answer.';
    $('picker-copy').textContent=practice?'Quizzes, flashcards and exam practice ? choose your material to jump in.':'Pick a notebook for grounded explanations, summaries and revision notes.';
    $('picker-status').textContent=pendingAction==='upload'?'Choose where to upload, or create a new notebook.':pendingAction==='summary'?'Choose the notebook you want to summarize.':'';
    try{await notebookCards($('picker-notebooks'),async n=>{if(study.isWorking())throw new Error('A study operation is still running. Try selecting again when it finishes.');await study.open(n.id);});}catch(e){showPickerError(e);}
  }
  async function refreshLibrary(){try{await notebookCards($('rescue-library'),async n=>{if(study.isWorking())throw new Error('Wait for the current upload to finish before switching notebooks.');await study.open(n.id);});}catch(e){$('rescue-status').textContent=e.message;}}
  function updatePlansDropdown(){
    $('rescue-plans').replaceChildren(new Option('+ New exam plan',''));
    const source=savedPlans.length?savedPlans:plans.map(p=>({id:p.id,name:p.setup?.name||p.name,notebookId:study.current()}));
    for(const p of source){const label=p.notebookName?`${p.name} · ${p.notebookName}`:(p.setup?.name||p.name);const opt=new Option(label,p.id);opt.dataset.notebook=p.notebookId;$('rescue-plans').append(opt);}
    $('rescue-plans').value=plan?.id||'';
    $('rescue-plans-label').hidden=!source.length;
  }
  async function loadSavedHome(){
    try {const data=await study.api('/rescue/plans');savedPlans=data.plans||[];$('rescue-saved-cards').replaceChildren();$('rescue-saved-home').hidden=!savedPlans.length;
      for(const p of savedPlans){const card=btn('',async()=>{desiredPlan=p.id;wizardOpen=false;await study.open(p.notebookId);});card.className='notebook-choice';card.append(el('span','✦','notebook-icon'),el('strong',p.name),el('small',p.notebookName+' · '+p.completed+'/'+p.total+' sessions complete'),el('span','Continue your plan →'));$('rescue-saved-cards').append(card);}
      updatePlansDropdown();
    }catch(e){$('rescue-status').textContent=e.message;$('rescue-retry').hidden=false;retryAction=loadSavedHome;}
  }
  async function notebookOpened(){
    const changed=loadedNotebook!==study.current();loadedNotebook=study.current();
    if(changed){plan=null;preview=null;topics=[];renderTopics();}
    renderSources();await load({preserveDraft:wizardOpen});
    $('rescue-selected-notebook').textContent='Selected: '+$('notebook-name').textContent;
    if(wizardOpen){section('rescue',false);await refreshLibrary();showStep(wizardStep,false);}
    else {section(activeSection==='notebooks'?'ask':activeSection);}
    if(requestedTopic){study.explain(requestedTopic);requestedTopic=null;}
    if(pendingAction==='upload'){pendingAction=null;section('ask');$('document').focus();$('upload-form').scrollIntoView({block:'center'});}
    else if(pendingAction==='summary'){pendingAction=null;section('ask');await study.summarize();}
  }
  function ready(){section(initialSection);if(study.current()&&initialSection==='rescue')render();}
  window.ZunoRescue={section,notebookOpened,ready};
  document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>section(b.dataset.section));
  $('picker-create').onclick=()=>study.createNotebook();
  $('picker-upload').onclick=()=>{pendingAction='upload';refreshPicker();};
  $('picker-summary').onclick=()=>{pendingAction='summary';refreshPicker();};
  const input=(parent,label,type,value)=>{const l=el('label',label),i=document.createElement('input');i.type=type;i.value=value??'';l.append(i);parent.append(l);return i;};
  function localDate(d=new Date()){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}
  function addDay(a={date:localDate(),start:'17:00',end:'20:00',maxHours:3}){
    const row=el('div',null,'rescue-day');input(row,'Date','date',a.date).dataset.key='date';input(row,'From','time',a.start).dataset.key='start';input(row,'Until','time',a.end).dataset.key='end';const max=input(row,'Max study hours','number',a.maxHours);max.dataset.key='maxHours';max.min=0;max.max=8;max.step=.25;row.append(btn('Remove day',()=>row.remove()));$('rescue-days').append(row);
  }
  function renderTopics(){
    $('rescue-topic-count').textContent=topics.length?' ? '+topics.length+' topics':'';
    $('rescue-topics').replaceChildren();
    for(const t of topics){const row=el('div',null,'rescue-topic');const title=input(row,'Topic','text',t.title);title.parentElement.className='topic-title';title.oninput=()=>t.title=title.value;
      const minutes=input(row,'Approx. minutes','number',t.minutes);minutes.min=15;minutes.max=600;minutes.oninput=()=>t.minutes=Number(minutes.value);
      const priority=input(row,'Priority 1–3 / weak = 3','number',t.priority);priority.min=1;priority.max=3;priority.oninput=()=>t.priority=Number(priority.value);
      const confidence=el('label','Confidence'),level=el('select');for(const [value,label]of [['new','New material'],['weak','Weak · 25% more time'],['comfortable','Comfortable · 15% less time']]){const option=el('option',label);option.value=value;option.selected=(t.confidence||'new')===value;level.append(option);}level.onchange=()=>{t.confidence=level.value;if(level.value==='weak'){t.priority=3;priority.value=3;}};confidence.append(level);row.append(confidence);
      const prereq=el('label','Prerequisites'),select=el('select');select.multiple=true;select.setAttribute('aria-label','Prerequisites for '+t.title);
      for(const x of topics.filter(x=>x.id!==t.id)){const o=el('option',x.title);o.value=x.id;o.selected=t.prerequisites.includes(x.id);select.append(o);}select.onchange=()=>t.prerequisites=[...select.selectedOptions].map(o=>o.value);prereq.append(select);row.append(prereq);
      row.append(btn('Remove topic',()=>{topics=topics.filter(x=>x.id!==t.id);topics.forEach(x=>x.prerequisites=x.prerequisites.filter(id=>id!==t.id));renderTopics();}));
      row.append(el('small',t.quote?'Source evidence: “'+t.quote+'”':'Manually entered topic · no inferred source citation.'));
      if(t.sourceId)row.append(btn('Inspect source',()=>study.source(t.sourceId)));$('rescue-topics').append(row);
    }
  }
  function renderSources(selected){
    const before=new Map([...$('rescue-sources').querySelectorAll('input')].map(i=>[i.value,i.checked]));
    $('rescue-sources').replaceChildren();
    for(const source of study.material()){const label=el('label'),i=el('input');i.type='checkbox';i.value=source.id;i.checked=selected?selected.includes(source.id):before.has(source.id)?before.get(source.id):true;label.append(i,el('span',source.title),el('small',source.status));$('rescue-sources').append(label);}
    if(!study.material().length)$('rescue-sources').append(el('p','No material yet. Upload notes above, or add a manual topic below.'));
  }
  function renderCommitments(){ $('rescue-commitments').replaceChildren();for(const c of commitments){const row=el('div',null,'rescue-commitment');row.dataset.id=c.id;row.append(el('strong',c.title+(c.assumed?' · assumed':' · exact')));const start=input(row,'Start (ISO with offset)','text',c.start),end=input(row,'End (ISO with offset)','text',c.end);start.dataset.key='start';end.dataset.key='end';start.disabled=end.disabled=!c.assumed;$('rescue-commitments').append(row);} }
  function setup(){return {name:$('rescue-name').value,examAt:$('rescue-exam').value,timezone:$('rescue-zone').value,strategy:$('rescue-strategy').value,sessionMinutes:Number($('rescue-session').value),breakMinutes:Number($('rescue-break').value),travelMinutes:Number($('rescue-travel').value),style:$('rescue-style').value,goal:$('rescue-goal').value,reminders:$('rescue-reminders').value==='on',topics,availability:[...$('rescue-days').children].map(row=>Object.fromEntries([...row.querySelectorAll('input')].map(i=>[i.dataset.key,i.dataset.key==='maxHours'?Number(i.value):i.value])))};}
  function loadSetup(s){$('rescue-reminders').value=s.reminders?'on':'off';for(const [key,id]of Object.entries({name:'name',examAt:'exam',timezone:'zone',strategy:'strategy',sessionMinutes:'session',breakMinutes:'break',travelMinutes:'travel',style:'style',goal:'goal'}))if(s[key]!=null)$('rescue-'+id).value=s[key];topics=structuredClone(s.topics);$('rescue-days').replaceChildren();s.availability.forEach(addDay);renderTopics();}
  async function load({preserveDraft=false}={}) {
    if(!study.current()){await loadSavedHome();return;}
    const data=await study.api(endpoint(''));plans=data.plans;commitments=data.commitments;quiz=data.quiz;
    try { const all=await study.api('/rescue/plans'); savedPlans=all.plans||[]; } catch { savedPlans=plans.map(p=>({id:p.id,name:p.setup.name,notebookId:study.current()})); }
    if(!preserveDraft){plan=plans.find(p=>p.id===(desiredPlan||plan?.id))||plans[0]||null;desiredPlan=null;if(plan)loadSetup(plan.setup);}
    updatePlansDropdown();renderCommitments();render();
  }
  function dateText(value){return new Date(value).toLocaleString(undefined,{timeZone:(preview?.plan||plan)?.setup.timezone||$('rescue-zone').value,dateStyle:'medium',timeStyle:'short'});}
  function render(){
    document.body.dataset.rescueView=wizardOpen?'wizard':(plan||preview)?'plan':'landing';
    $('rescue-setup').hidden=!wizardOpen;$('rescue-start').hidden=wizardOpen||!!plan||!!preview;
    $('rescue-edit').hidden=!plan||wizardOpen;$('rescue-view').hidden=!plan&&!preview;
    $('rescue-refresh').hidden=!study.current();$('rescue-plans-label').hidden=!(savedPlans.length||plans.length);
    $('rescue-plans').value=plan?.id||'';
    $('rescue-saved-home').hidden=wizardOpen||!!plan||!!preview||!$('rescue-saved-cards').children.length;
    const p=(wizardOpen&&!preview)?null:(preview?.plan||plan);$('rescue-preview').hidden=!preview;$('rescue-replan').hidden=!plan;$('rescue-timeline').replaceChildren();$('rescue-uncovered').replaceChildren();$('rescue-progress').replaceChildren();
    if(!p)return;
    const done=p.blocks.filter(b=>b.status==='completed'),remaining=p.blocks.filter(b=>b.status!=='completed');
    const stats=el('div',null,'rescue-stats');for(const [value,label]of [[done.length+'/'+p.blocks.length,'Study blocks completed'],[remaining.reduce((n,b)=>n+b.minutes,0)+p.uncovered.reduce((n,b)=>n+b.minutes,0)+' min','Remaining work'],[done.filter(b=>b.activity==='revision').length,'Revision blocks completed'],[quiz.length?quiz[0].score+'/'+quiz[0].total:'No quiz yet','Latest quiz · self-reported']]){const cell=el('div',null,'rescue-stat');cell.append(el('strong',String(value)),el('span',label));stats.append(cell);}
    const countdown=el('p');countdown.id='rescue-countdown';countdown.dataset.exam=p.setup.examAt;countdown.dataset.zone=p.setup.timezone;
    const progress=el('progress');progress.max=Math.max(1,p.blocks.length+p.uncovered.length);progress.value=done.length;progress.setAttribute('aria-label','Completed study blocks');
    $('rescue-progress').append(stats,progress,countdown,el('p',p.explanation));
    for(const activity of ['learn','practice','recall']){const completed=new Set(done.filter(b=>b.activity===activity).map(b=>b.topicId));$('rescue-progress').append(el('p',(activity==='learn'?'Viewed':activity==='practice'?'Practised':'Recall session completed')+': '+(p.setup.topics.filter(t=>completed.has(t.id)).map(t=>t.title).join(', ')||'None yet')));}
    $('rescue-progress').append(el('p','Recall session completion is self-reported; quiz scores are separate evidence, not a pass prediction.'));
    const covered=p.setup.topics.filter(t=>!p.uncovered.some(b=>b.topicId===t.id)&&p.blocks.some(b=>b.topicId===t.id)&&p.blocks.filter(b=>b.topicId===t.id).every(b=>b.status==='completed'));
    $('rescue-progress').append(el('p','Topics covered through all planned activities: '+(covered.map(t=>t.title).join(', ')||'None yet')),el('p','Topics not yet fully covered: '+(p.setup.topics.filter(t=>!covered.includes(t)).map(t=>t.title).join(', ')||'All planned activities completed.')));
    const next=remaining.filter(b=>b.status==='scheduled'&&Date.parse(b.end)>Date.now()).sort((a,b)=>a.start.localeCompare(b.start))[0];if(next)$('rescue-progress').append(el('p','Next: '+next.title+' · '+dateText(next.start)));
    let last=null,day='';
    for(const [index,b]of [...p.blocks].sort((a,b)=>a.start.localeCompare(b.start)).entries()){
      const localDay=new Date(b.start).toLocaleDateString(undefined,{timeZone:p.setup.timezone,dateStyle:'full'});if(localDay!==day){$('rescue-timeline').append(el('h3',localDay));day=localDay;last=null;}
      if(last&&Date.parse(b.start)>=Date.parse(last.end)+p.setup.breakMinutes*60000)$('rescue-timeline').append(el('div',p.setup.breakMinutes+' min protected break after previous block · remaining gap is free or committed time','rescue-break'));
      const card=el('article',null,'rescue-block');card.dataset.status=b.status;card.style.setProperty('--entrance',Math.min(index,8)*25+'ms');card.classList.toggle('current',Date.parse(b.start)<=Date.now()&&Date.parse(b.end)>Date.now());
      card.append(el('time',dateText(b.start)+' – '+new Date(b.end).toLocaleTimeString(undefined,{timeZone:p.setup.timezone,hour:'2-digit',minute:'2-digit'})),el('h4',b.title),el('p',`${b.module} · ${b.activity} · ${b.minutes} min · priority ${b.priority} · ${b.status}`));
      if(!preview){const actions=el('div',null,'rescue-actions');actions.append(btn('Start studying',()=>study.explain(b.title,p.setup.style)),btn('Explain topic',()=>study.explain(b.title,'Explain simply')),btn('Revision notes',()=>study.explain(b.title,'Create revision notes')),btn('Quiz me',()=>study.quiz(b.title)));if(b.sourceId)actions.append(btn('Open source',()=>study.source(b.sourceId)));
        actions.append(btn(b.status==='completed'?'Reopen':'Mark complete',async()=>{await update(b,{status:b.status==='completed'?'scheduled':'completed'});$('rescue-progress').classList.add('rescue-celebrate');const mascot=document.querySelector('.rescue-mascot');mascot.dataset.mascotState='task-completed';setTimeout(()=>mascot.dataset.mascotState='idle',1500);setTimeout(()=>$('rescue-progress').classList.remove('rescue-celebrate'),600);}));
        if(b.status!=='completed'){actions.append(btn('Skip',()=>update(b,{status:'skipped'})),btn('Move / shorten / extend',()=>editBlock(b)),btn('Postpone · preview remaining plan',()=>makePreview(true)));}const more=el('details',null,'session-more');more.append(el('summary','Study tools & reschedule'));const extras=el('div',null,'rescue-actions');[...actions.children].forEach((button,i)=>{if(i!==0&&!['Mark complete','Reopen'].includes(button.textContent))extras.append(button);});more.append(extras);card.append(actions,more);
      }$('rescue-timeline').append(card);last=b;
    }
    if(p.uncovered.length){$('rescue-uncovered').append(el('h3','Time is tight. This work is not scheduled.'),el('p',p.uncovered.map(b=>`${b.title} — ${b.activity}, ${b.minutes} min`).join(' · ')),el('p','Add availability, adjust estimates or choose Exam Sprint. No full-coverage promise.'));}
    if(preview){$('rescue-change').textContent=p.reason+' '+p.blocks.filter(b=>b.status!=='completed').length+' future sessions; '+p.uncovered.length+' work blocks remain uncovered. Existing linked unfinished missions for uncovered blocks will leave the calendar; their work stays here.';for(const c of p.changes||[])$('rescue-change').append(el('span',c.title+' · '+c.activity+': '+(c.before?dateText(c.before):'Unscheduled')+' → '+dateText(c.after),'rescue-change-line'));}
    tick();
  }
  function tick(){const c=$('rescue-countdown');if(!c)return;const p=preview?.plan||plan;if(!p)return;const actual=p.examTimestamp-Date.now();c.textContent=actual<=0?'Exam time has arrived. Take a breath.':Math.floor(actual/86400000)+' days '+Math.floor(actual%86400000/3600000)+' hours '+Math.floor(actual%3600000/60000)+' minutes until exam. On exam day: review definitions, formulas and weak concepts calmly.';}
  async function update(b,body){const data=await study.api(endpoint('/'+plan.id+'/blocks/'+encodeURIComponent(b.id)),'PATCH',body);plan=data.plan;preview=null;render();}
  function editBlock(b){const dialog=el('dialog'),form=el('form');form.append(el('h3','Move or resize session'));const start=input(form,'Start · ISO with timezone offset','text',b.start),minutes=input(form,'Duration in minutes','number',b.minutes);minutes.min=5;minutes.max=plan.setup.sessionMinutes;const error=el('p');error.setAttribute('role','alert');const save=el('button','Save session');save.type='submit';form.append(error,save,btn('Cancel',()=>{dialog.close();dialog.remove();}));form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await update(b,{start:start.value,minutes:Number(minutes.value)});dialog.close();dialog.remove();}catch(e){error.textContent=e.message;}finally{save.disabled=false;}};dialog.append(form);document.body.append(dialog);dialog.showModal();}
  async function makePreview(reschedule=false){const overrides=[...$('rescue-commitments').children].filter(row=>!row.querySelector('input').disabled).map(row=>({id:row.dataset.id,start:row.querySelector('[data-key=start]').value,end:row.querySelector('[data-key=end]').value}));phase('availability');await study.api(endpoint(''));phase('schedule');preview=await study.api(endpoint('/preview'),'POST',{planId:plan?.id,setup:reschedule?{...plan.setup,availability:setup().availability}:setup(),commitmentOverrides:overrides});render();$('rescue-preview').scrollIntoView({block:'start'});}
  function phase(name,state='active') {
    $('rescue-phases').hidden=false;
    const order=['reading','topics','availability','schedule','ready'],at=order.indexOf(name);
    document.querySelectorAll('#rescue-phases li').forEach((n,i)=>n.dataset.state=i<at?'done':i===at?state:'pending');
    $('rescue-status').textContent=$('rescue-phases').querySelector('[data-phase='+name+']').textContent+(state==='done'?' ?':'?');
  }
  function showStep(step,focus=true) {
    wizardStep=step;$('rescue-setup').hidden=false;$('rescue-setup').open=true;
    document.querySelectorAll('[data-wizard-pane]').forEach(n=>n.hidden=Number(n.dataset.wizardPane)!==step);
    document.querySelectorAll('[data-wizard-step]').forEach(n=>{if(Number(n.dataset.wizardStep)===step)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');});
    $('rescue-prev').hidden=step===1;$('rescue-next').hidden=step===3;$('rescue-generate').hidden=step!==3;
    $('rescue-next').textContent=step===1?'Next: the material ?':'Next: your time ?';
    if(step===2){
      $('rescue-upload-host').append($('upload-form'));
      refreshLibrary();
    } else {
      uploadHome.prepend($('upload-form'));
    }
    if(focus){const heading=document.querySelector('[data-wizard-pane="'+step+'"] h3');heading.tabIndex=-1;heading.focus({preventScroll:true});$('rescue-setup').scrollIntoView({block:'start'});}
  }
  function validExam(){for(const id of ['rescue-name','rescue-exam'])if(!$(id).value.trim()||!$(id).checkValidity()){showStep(1);$(id).reportValidity();return false;}return true;}
  function quickDate(days){const d=new Date();d.setDate(d.getDate()+days);d.setHours(9,0,0,0);$('rescue-exam').value=localDate(d)+'T09:00';document.querySelectorAll('[data-exam-days]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.examDays)===days)));}
  function suggestDays(hours=2.5){
    const end=$('rescue-exam').value.slice(0,10);if(!end)return;
    $('rescue-days').replaceChildren();let d=new Date();d.setHours(12,0,0,0);
    for(let i=0;i<366&&localDate(d)<=end;i++,d.setDate(d.getDate()+1)){
      const date=localDate(d);if(date===end)continue;
      addDay({date,start:hours<=3?'17:00':hours<=6?'10:00':'08:00',end:hours<=3?'21:00':hours<=6?'17:00':'18:00',maxHours:hours});
    }
    if(!$('rescue-days').children.length)addDay({date:end,start:'07:00',end:'09:00',maxHours:1});
    document.querySelectorAll('[data-study-hours]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.studyHours)===hours)));
  }
  function startNew(){
    plan=null;preview=null;topics=[];wizardOpen=true;wizardStep=1;$('rescue-name').value='';$('rescue-plans').value='';$('rescue-status').textContent='';$('rescue-phases').hidden=true;$('rescue-topic-review').open=false;
    quickDate(3);suggestDays();renderTopics();section('rescue',false);render();showStep(1);
  }
  async function analyze(){
    if(!study.current()){showStep(2);throw new Error('Pick or create a notebook to use its material.');}
    if(plan&&topics.length)return;
    const chosen=[...$('rescue-sources').querySelectorAll('input:checked')].map(i=>i.value);
    phase('reading');await study.refresh();renderSources(chosen);phase('topics');
    const data=await study.api(endpoint('/analyze'),'POST',{sourceIds:chosen});topics=data.topics;
    for(const t of topics){const result=quiz.find(q=>q.topic.toLowerCase().includes(t.title.toLowerCase())&&q.score/q.total<.6);if(result){t.confidence='weak';t.priority=3;}}
    renderTopics();$('rescue-topic-review').open=true;$('rescue-analysis-status').textContent=data.warning;
    if(!topics.length)throw new Error('No supported topics were found. Try another source or enter topics manually.');
    phase('topics','done');$('rescue-status').textContent=topics.length+' grounded topics found. Review them or keep going.';
  }
  async function nextStep(){
    if(wizardStep===1){if(!validExam())return;showStep(2);}
    else if(wizardStep===2){if(!study.current())throw new Error('Choose a notebook, or create one here.');if(!topics.length)await analyze();if(!$('rescue-days').children.length)suggestDays();showStep(3);}
  }
  $('rescue-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!validExam())return;if(!study.current()){showStep(2);throw new Error('Choose your notebook first.');}if(!topics.length){showStep(2);await analyze();showStep(3);}phase('availability');await makePreview();phase('ready','done');wizardOpen=false;render();document.querySelector('.rescue-mascot').dataset.mascotState='happy';});};
  $('rescue-start').onclick=startNew;$('rescue-new').onclick=startNew;
  $('rescue-next').onclick=()=>run(nextStep);$('rescue-prev').onclick=()=>showStep(Math.max(1,wizardStep-1));
  document.querySelectorAll('[data-wizard-step]').forEach(b=>b.onclick=()=>run(async()=>{const step=Number(b.dataset.wizardStep);if(step>wizardStep){if(!validExam())return;if(step===3&&!study.current()){showStep(2);throw new Error('Select your material first.');}}showStep(step);}));
  document.querySelectorAll('[data-exam-days]').forEach(b=>b.onclick=()=>{quickDate(Number(b.dataset.examDays));suggestDays();});
  $('rescue-pick-date').onclick=()=>{$('rescue-exam').focus();try{$('rescue-exam').showPicker();}catch{}};
  document.querySelectorAll('[data-study-hours]').forEach(b=>b.onclick=()=>suggestDays(Number(b.dataset.studyHours)));
  $('rescue-custom-time').onclick=()=>{$('rescue-days').scrollIntoView({block:'center'});$('rescue-days').querySelector('input')?.focus();};
  $('rescue-add-day').onclick=()=>addDay();$('rescue-manual').onclick=()=>{topics.push({id:crypto.randomUUID(),title:'New topic',minutes:60,priority:2,prerequisites:[]});renderTopics();};
  $('rescue-create-notebook').onclick=()=>study.createNotebook($('rescue-name').value);
  $('rescue-analyze').onclick=()=>run(analyze);
  $('rescue-apply').onclick=()=>run(async()=>{const data=await study.api(endpoint('/apply'),'POST',{previewId:preview.previewId,confirm:true});plan=data.plan;preview=null;wizardOpen=false;await load();$('rescue-status').textContent='You have a plan. One session at a time. Saved to Missions ?';});
  $('rescue-discard').onclick=()=>{preview=null;wizardOpen=true;render();showStep(3);};
  $('rescue-edit').onclick=()=>{wizardOpen=true;render();showStep(1);};
  $('rescue-cancel-setup').onclick=()=>{wizardOpen=false;render();};
  $('rescue-replan').onclick=()=>run(async()=>{phase('availability');await makePreview(true);phase('ready','done');});
  $('rescue-refresh').onclick=()=>run(async()=>{await load();$('rescue-status').textContent='Progress refreshed.';});
  $('rescue-retry').onclick=()=>{if(retryAction)run(retryAction);};
  $('rescue-view').onclick=()=>{const checklist=$('rescue-timeline').classList.toggle('rescue-checklist');$('rescue-view').setAttribute('aria-pressed',String(checklist));$('rescue-view').textContent=checklist?'Timeline view':'Daily checklist view';};
  $('rescue-plans').onchange=async()=>{
    const chosen=$('rescue-plans').value;
    if(!chosen){startNew();return;}
    const local=plans.find(p=>p.id===chosen);
    if(local){plan=local;preview=null;wizardOpen=false;loadSetup(plan.setup);render();}
    else{const target=savedPlans.find(p=>p.id===chosen);if(target){desiredPlan=target.id;wizardOpen=false;await study.open(target.notebookId);}}
  };
  window.addEventListener('study:material',e=>{if(e.detail.id===study.current())renderSources();});
  $('short-answer-form').onsubmit=e=>{e.preventDefault();study.review($('short-question').value,$('short-answer').value);};
  $('rescue-zone').value=Intl.DateTimeFormat().resolvedOptions().timeZone;$('rescue-zone-label').textContent=$('rescue-zone').value;
  $('rescue-zone').onchange=()=>{$('rescue-zone-label').textContent=$('rescue-zone').value;};
  const timer=setInterval(tick,30000);window.addEventListener('pagehide',()=>clearInterval(timer));
  section(activeSection,false);render();
})();
