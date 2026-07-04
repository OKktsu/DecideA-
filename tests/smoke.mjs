const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5050";
const adminHeaders = { "Content-Type": "application/json", "X-Admin-Pin": "1234" };

async function request(path, method, body, headers = { "Content-Type": "application/json" }) {
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const p1 = await request("/api/admin/presentations", "POST", { title: "Inovação Sustentável", presenter: "Equipe Aurora" }, adminHeaders);
const p2 = await request("/api/admin/presentations", "POST", { title: "Futuro da Educação", presenter: "Equipe Horizonte" }, adminHeaders);
await request("/api/admin/presentations", "POST", { title: "Cidades Inteligentes", presenter: "Equipe Conexão" }, adminHeaders);
await request("/api/admin/session", "PUT", { isOpen: true, presentationId: p1.id }, adminHeaders);
await request("/api/votes", "POST", { presentationId: p1.id, score: 9, voterId: "teste-1" });
await request("/api/votes", "POST", { presentationId: p1.id, score: 10, voterId: "teste-3" });
await request("/api/admin/session", "PUT", { isOpen: false, showResults: false }, adminHeaders);
let paused = await request("/api/state", "GET");
if (paused.isOpen || paused.showResults || paused.activePresentationId !== null) throw new Error("A apresentação não foi retirada corretamente.");
await request("/api/admin/session", "PUT", { isOpen: true, presentationId: p2.id }, adminHeaders);
await request("/api/votes", "POST", { presentationId: p2.id, score: 8, voterId: "teste-1" });
await request("/api/admin/session", "PUT", { isOpen: false, showResults: true }, adminHeaders);

const state = await request("/api/state", "GET");
if (!state.showResults || state.totalVotes !== 3 || state.presentations[0].title !== "Inovação Sustentável" || state.presentations[0].average !== 9.5) {
  throw new Error(`Ranking inesperado: ${JSON.stringify(state)}`);
}

// Deixa o sistema pronto para o teste manual: apresentações de exemplo, votação aberta e sem votos.
await request("/api/admin/votes", "DELETE", undefined, adminHeaders);
await request("/api/admin/session", "PUT", { isOpen: true, presentationId: p1.id }, adminHeaders);
console.log("TESTE_FUNCIONAL_OK");
