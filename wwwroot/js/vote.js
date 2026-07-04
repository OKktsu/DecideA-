const statusEl=document.querySelector('#status');
const votePanel=document.querySelector('#vote-panel');
const waitingPanel=document.querySelector('#waiting-panel');
const idlePanel=document.querySelector('#idle-panel');
const resultPanel=document.querySelector('#result-panel');
const feedback=document.querySelector('#feedback');
const makeId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const voterId=localStorage.getItem('voter-id')||makeId();
localStorage.setItem('voter-id',voterId);

document.querySelector('#scores').innerHTML=Array.from({length:10},(_,i)=>`<span><input id="score-${i+1}" name="score" type="radio" value="${i+1}" required><label for="score-${i+1}">${i+1}</label></span>`).join('');
let lastActivePresentationId = null;

async function load(){
  const state=await fetch('/api/state?_='+Date.now()).then(r=>r.json());
  const hasActiveVote=state.isOpen&&state.activePresentation;

  if (hasActiveVote && state.activePresentationId !== lastActivePresentationId) {
    document.querySelector('#vote-form').reset();
    feedback.textContent = '';
    lastActivePresentationId = state.activePresentationId;
  }

  const voteKey=hasActiveVote?`voted:${state.roundId}:${state.activePresentationId}`:'';
  const alreadyVoted=hasActiveVote&&localStorage.getItem(voteKey)==='true';
  statusEl.textContent=hasActiveVote?`Votação aberta · ${state.activePresentation.title}`:state.showResults?'Votação encerrada':'Aguardando o organizador';
  statusEl.classList.toggle('open',state.isOpen);
  votePanel.hidden=!hasActiveVote||alreadyVoted;
  waitingPanel.hidden=!hasActiveVote||!alreadyVoted;
  idlePanel.hidden=hasActiveVote||state.showResults;
  resultPanel.hidden=!state.showResults;
  if(hasActiveVote){
    document.querySelector('#active-title').textContent=state.activePresentation.title;
    document.querySelector('#active-presenter').textContent=state.activePresentation.presenter||'';
  } else if(state.showResults) renderRanking(state);
}

document.querySelector('#vote-form').addEventListener('submit',async e=>{
  e.preventDefault(); feedback.textContent='Registrando…';
  const data=new FormData(e.currentTarget);
  const state=await fetch('/api/state?_='+Date.now()).then(r=>r.json());
  if(!state.isOpen||!state.activePresentationId)return load();
  const response=await fetch('/api/votes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({presentationId:state.activePresentationId,score:Number(data.get('score')),voterId})});
  const body=await response.json(); feedback.textContent=body.message;
  if(response.ok){localStorage.setItem(`voted:${state.roundId}:${state.activePresentationId}`,'true');e.currentTarget.reset();setTimeout(load,500)}
});

function renderRanking(state){
  document.querySelector('#total-votes').textContent=`${state.totalVotes} voto${state.totalVotes===1?'':'s'}`;
  
  if (!state.presentations || state.presentations.length === 0) {
    document.querySelector('#ranking').innerHTML = '<p>Nenhuma apresentação cadastrada.</p>';
    return;
  }
  
  let html = '';
  const top3 = state.presentations.slice(0, 3);
  const others = state.presentations.slice(3);
  
  if (top3.length > 0) {
    html += '<div class="podium-container">';
    top3.forEach((p, index) => {
      const rank = index + 1;
      let badgeHtml = '';
      let badgeClass = '';
      if (rank === 1) {
        badgeHtml = `<div class="podium-badge"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M3 20h18"/></svg></div>`;
        badgeClass = 'gold';
      } else if (rank === 2) {
        badgeClass = 'silver';
      } else if (rank === 3) {
        badgeClass = 'bronze';
      }
      
      html += `<div class="podium-col ${badgeClass}">
        <div class="podium-details">
          <h3 class="podium-name">${escapeHtml(p.title)}</h3>
          ${p.presenter ? `<span class="podium-team-presenter">${escapeHtml(p.presenter)}</span>` : ''}
          <div class="podium-score-row">
            <span class="podium-avg-score">${Number(p.average).toFixed(1)}</span>
          </div>
        </div>
        <div class="podium-stand">
          ${badgeHtml}
          <div class="podium-number">${rank}</div>
        </div>
      </div>`;
    });
    html += '</div>';
  }
  
  if (others.length > 0) {
    html += '<ol class="ranking others-list" style="counter-reset: rank 3;">';
    html += others.map(p => `<li><div><b>${escapeHtml(p.title)}</b><small>${p.voteCount} voto${p.voteCount===1?'':'s'}${p.presenter?' · '+escapeHtml(p.presenter):''}</small></div><strong>${Number(p.average).toFixed(1)}</strong></li>`).join('');
    html += '</ol>';
  }
  
  document.querySelector('#ranking').innerHTML = html;
}
function escapeHtml(value){const el=document.createElement('div');el.textContent=value;return el.innerHTML}
new EventSource('/api/events').onmessage=load;
load().catch(()=>statusEl.textContent='Não foi possível carregar a votação');
