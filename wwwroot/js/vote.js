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

async function load(){
  const state=await fetch('/api/state').then(r=>r.json());
  const hasActiveVote=state.isOpen&&state.activePresentation;
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
  const state=await fetch('/api/state').then(r=>r.json());
  if(!state.isOpen||!state.activePresentationId)return load();
  const response=await fetch('/api/votes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({presentationId:state.activePresentationId,score:Number(data.get('score')),voterId})});
  const body=await response.json(); feedback.textContent=body.message;
  if(response.ok){localStorage.setItem(`voted:${state.roundId}:${state.activePresentationId}`,'true');e.currentTarget.reset();setTimeout(load,500)}
});

function renderRanking(state){
  document.querySelector('#total-votes').textContent=`${state.totalVotes} voto${state.totalVotes===1?'':'s'}`;
  document.querySelector('#ranking').innerHTML=state.presentations.length?state.presentations.map(p=>`<li><div><b>${escapeHtml(p.title)}</b><small>${p.voteCount} voto${p.voteCount===1?'':'s'}${p.presenter?' · '+escapeHtml(p.presenter):''}</small></div><strong>${Number(p.average).toFixed(1)}</strong></li>`).join(''):'<p>Nenhuma apresentação cadastrada.</p>';
}
function escapeHtml(value){const el=document.createElement('div');el.textContent=value;return el.innerHTML}
new EventSource('/api/events').onmessage=load;
load().catch(()=>statusEl.textContent='Não foi possível carregar a votação');
