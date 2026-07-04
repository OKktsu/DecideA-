let currentState;
const pin=document.querySelector('#pin');
const feedback=document.querySelector('#admin-feedback');
const toastSpinner=document.querySelector('#toast-spinner');
const toastText=document.querySelector('#toast-text');
let toastTimeout;

pin.value=sessionStorage.getItem('admin-pin')||pin.value;
pin.addEventListener('input',()=>sessionStorage.setItem('admin-pin',pin.value));
const headers=()=>({'Content-Type':'application/json','X-Admin-Pin':pin.value});

function show(message, isLoading=false){
  clearTimeout(toastTimeout);
  toastText.textContent=message;
  if(isLoading){
    toastSpinner.style.display='inline-block';
    feedback.classList.add('show');
  }else{
    toastSpinner.style.display='none';
    feedback.classList.add('show');
    toastTimeout=setTimeout(()=>feedback.classList.remove('show'),2600);
  }
}

function setGlobalLoading(isLoading, message){
  document.querySelectorAll('button, input').forEach(el=>{
    if(el.id!=='pin') el.disabled=isLoading;
  });
  if(isLoading) show(message, true);
}
async function handleResponse(response, successMsg) {
  if (response.ok) {
    show(successMsg);
  } else {
    if (response.status === 401) {
      show('PIN incorreto.');
    } else {
      const body = await response.json().catch(() => ({}));
      show(body.message || 'Erro no servidor. Tente novamente.');
    }
  }
  await load();
}

async function load(){
  try {
    currentState=await fetch('/api/state?_='+Date.now()).then(r=>r.json());
    const active=currentState.activePresentation;
    document.querySelector('#session-title').textContent=currentState.isOpen&&active?active.title:currentState.showResults?'Evento finalizado':'Nenhuma equipe em votação';
    document.querySelector('#session-copy').textContent=currentState.isOpen&&active?'Esta equipe está aparecendo agora para todos os participantes.':currentState.showResults?'O ranking final está visível para o público.':'Escolha abaixo qual apresentação o público deve avaliar.';
    document.querySelector('#stop-session').disabled=!currentState.isOpen;
    document.querySelector('#finish-event').disabled=currentState.totalVotes===0;
    document.querySelector('#presentation-form').querySelectorAll('input,button').forEach(el=>el.disabled=currentState.isOpen);
    document.querySelector('#presentation-list').innerHTML=currentState.presentations.map(p=>`<div class="presentation-row ${currentState.isOpen&&currentState.activePresentationId===p.id?'is-active':''}"><div><b>${escapeHtml(p.title)}</b><small>${escapeHtml(p.presenter||'Sem apresentador')} · ${p.voteCount} voto${p.voteCount===1?'':'s'}</small></div><div class="row-actions"><button class="vote-team" data-activate="${p.id}" ${currentState.isOpen&&currentState.activePresentationId===p.id?'disabled':''}>${currentState.isOpen&&currentState.activePresentationId===p.id?'Em votação':'Colocar em votação'}</button><button class="icon-button" data-remove="${p.id}" ${currentState.isOpen||p.voteCount?'disabled':''}>Excluir</button></div></div>`).join('')||'<p>Nenhuma apresentação cadastrada.</p>';
    document.querySelector('#admin-total').textContent=`${currentState.totalVotes} voto${currentState.totalVotes===1?'':'s'}`;
    
    // Render Admin Ranking with Podium
    let html = '';
    const presentations = currentState.presentations;
    if (!presentations || presentations.length === 0) {
      html = '<p>Nenhuma apresentação cadastrada.</p>';
    } else {
      const top3 = presentations.slice(0, 3);
      const others = presentations.slice(3);
      
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
    }
    document.querySelector('#admin-ranking').innerHTML = html;
  } catch (err) {
    show('Erro ao conectar com o servidor.');
  }
}

document.querySelector('#presentation-form').addEventListener('submit',async e=>{
  e.preventDefault();
  setGlobalLoading(true, 'Adicionando apresentação...');
  try{
    const response=await fetch('/api/admin/presentations',{method:'POST',headers:headers(),body:JSON.stringify({title:document.querySelector('#title').value,presenter:document.querySelector('#presenter').value})});
    if(response.ok) e.currentTarget.reset();
    await handleResponse(response, 'Apresentação adicionada.');
  }catch{
    show('Erro de rede.');
    await load();
  }
});

document.querySelector('#presentation-list').addEventListener('click',async e=>{
  const activateId=e.target.dataset.activate;
  if(activateId){
    setGlobalLoading(true, 'Iniciando votação...');
    try{
      const response=await fetch('/api/admin/session',{method:'PUT',headers:headers(),body:JSON.stringify({isOpen:true,presentationId:activateId})});
      await handleResponse(response, 'Apresentação liberada para votação!');
    }catch{
      show('Erro de rede.');
      await load();
    }
    return;
  }
  const removeId=e.target.dataset.remove;
  if(!removeId)return;
  setGlobalLoading(true, 'Excluindo apresentação...');
  try{
    const response=await fetch(`/api/admin/presentations/${removeId}`,{method:'DELETE',headers:headers()});
    await handleResponse(response, 'Apresentação excluída.');
  }catch{
    show('Erro de rede.');
    await load();
  }
});

document.querySelector('#stop-session').addEventListener('click',async()=>{
  if(!currentState.isOpen)return;
  setGlobalLoading(true, 'Pausando votação...');
  try{
    const response=await fetch('/api/admin/session',{method:'PUT',headers:headers(),body:JSON.stringify({isOpen:false,showResults:false})});
    await handleResponse(response, 'Apresentação retirada da votação.');
  }catch{
    show('Erro de rede.');
    await load();
  }
});

document.querySelector('#finish-event').addEventListener('click',async()=>{
  if(currentState.totalVotes===0)return show('Ainda não há votos para mostrar.');
  setGlobalLoading(true, 'Finalizando e gerando ranking...');
  try{
    const response=await fetch('/api/admin/session',{method:'PUT',headers:headers(),body:JSON.stringify({isOpen:false,showResults:true})});
    await handleResponse(response, 'Evento finalizado e ranking liberado.');
  }catch{
    show('Erro de rede.');
    await load();
  }
});

document.querySelector('#clear-votes').addEventListener('click',async()=>{
  if(!confirm('Apagar todos os votos e encerrar a votação?'))return;
  setGlobalLoading(true, 'Limpando votos do banco...');
  try{
    const response=await fetch('/api/admin/votes',{method:'DELETE',headers:headers()});
    await handleResponse(response, 'Votos apagados.');
  }catch{
    show('Erro de rede.');
    await load();
  }
});

function escapeHtml(value){const el=document.createElement('div');el.textContent=value;return el.innerHTML}
const publicUrl=new URL('/',location.href).href;
document.querySelector('#public-link').href=publicUrl;
document.querySelector('#public-link').textContent=publicUrl.replace(/^https?:\/\//, '');
document.querySelector('#qr-code').src=`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(publicUrl)}`;
new EventSource('/api/events').onmessage=load;
load();
