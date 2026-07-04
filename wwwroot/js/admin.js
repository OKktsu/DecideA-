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

async function load(){
  try {
    currentState=await fetch('/api/state').then(r=>r.json());
    const active=currentState.activePresentation;
    document.querySelector('#session-title').textContent=currentState.isOpen&&active?active.title:currentState.showResults?'Evento finalizado':'Nenhuma equipe em votação';
    document.querySelector('#session-copy').textContent=currentState.isOpen&&active?'Esta equipe está aparecendo agora para todos os participantes.':currentState.showResults?'O ranking final está visível para o público.':'Escolha abaixo qual apresentação o público deve avaliar.';
    document.querySelector('#stop-session').disabled=!currentState.isOpen;
    document.querySelector('#finish-event').disabled=currentState.totalVotes===0;
    document.querySelector('#presentation-form').querySelectorAll('input,button').forEach(el=>el.disabled=currentState.isOpen);
    document.querySelector('#presentation-list').innerHTML=currentState.presentations.map(p=>`<div class="presentation-row ${currentState.isOpen&&currentState.activePresentationId===p.id?'is-active':''}"><div><b>${escapeHtml(p.title)}</b><small>${escapeHtml(p.presenter||'Sem apresentador')} · ${p.voteCount} voto${p.voteCount===1?'':'s'}</small></div><div class="row-actions"><button class="vote-team" data-activate="${p.id}" ${currentState.isOpen&&currentState.activePresentationId===p.id?'disabled':''}>${currentState.isOpen&&currentState.activePresentationId===p.id?'Em votação':'Colocar em votação'}</button><button class="icon-button" data-remove="${p.id}" ${currentState.isOpen||p.voteCount?'disabled':''}>Excluir</button></div></div>`).join('')||'<p>Nenhuma apresentação cadastrada.</p>';
    document.querySelector('#admin-total').textContent=`${currentState.totalVotes} voto${currentState.totalVotes===1?'':'s'}`;
    document.querySelector('#admin-ranking').innerHTML=currentState.presentations.map(p=>`<li><div><b>${escapeHtml(p.title)}</b><small>${p.voteCount} voto${p.voteCount===1?'':'s'}</small></div><strong>${Number(p.average).toFixed(1)}</strong></li>`).join('');
  } catch (err) {
    show('Erro ao conectar com o servidor.');
  }
}

document.querySelector('#presentation-form').addEventListener('submit',async e=>{
  e.preventDefault();
  setGlobalLoading(true, 'Adicionando apresentação...');
  try{
    const response=await fetch('/api/admin/presentations',{method:'POST',headers:headers(),body:JSON.stringify({title:document.querySelector('#title').value,presenter:document.querySelector('#presenter').value})});
    if(response.ok){
      e.currentTarget.reset();
      show('Apresentação adicionada.');
      await load();
    }else{
      show(response.status===401?'PIN incorreto.':'Não foi possível adicionar.');
      await load();
    }
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
      const body=await response.json().catch(()=>({}));
      show(response.ok?'Apresentação liberada para votação!':body.message||'PIN incorreto.');
      await load();
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
    show(response.ok?'Apresentação excluída.':response.status===401?'PIN incorreto.':'Não é possível excluir agora.');
    await load();
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
    show(response.ok?'Apresentação retirada da votação.':'PIN incorreto.');
    await load();
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
    show(response.ok?'Evento finalizado e ranking liberado.':'PIN incorreto.');
    await load();
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
    show(response.ok?'Votos apagados.':'PIN incorreto.');
    await load();
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
