# Votação de apresentações

Protótipo em ASP.NET Core para cadastrar apresentações, abrir uma votação, receber uma nota de 1 a 10 por dispositivo e exibir o ranking em tempo real.

## Executar

O SDK do .NET 8 está instalado localmente na pasta `.dotnet`. Para iniciar no Windows, dê dois cliques em `iniciar.cmd` ou execute:

```powershell
.\.dotnet\dotnet.exe run --urls http://0.0.0.0:5050
```

Acesse `http://localhost:5050/admin.html` no computador. Para o QR Code funcionar no celular, abra o painel usando o IP do computador na rede, por exemplo `http://192.168.0.10:5050/admin.html`; o QR será montado com esse mesmo endereço. Talvez seja necessário autorizar o aplicativo no Firewall do Windows.

O PIN inicial do painel é `1234`. Troque-o em `appsettings.json` antes de publicar.

## Estado atual

- Dados guardados em memória: reiniciar o servidor apaga cadastros e votos.
- Atualização ao vivo por Server-Sent Events, sem recarregar a página.
- O administrador escolhe qual apresentação está disponível para votação.
- Cada navegador pode votar uma vez em cada apresentação; ao trocar a equipe, um novo voto é liberado automaticamente.
- O botão de finalização encerra as avaliações e mostra o ranking ao público.
- “Tirar de votação” apenas remove a equipe da tela do público e mantém todos aguardando, sem revelar o ranking.
- QR Code gerado no painel a partir da URL pública.

## Firebase / Firestore

O projeto já inclui um armazenamento Cloud Firestore. Para habilitá-lo, crie o banco Firestore e uma conta de serviço no Firebase, salve a chave como `firebase-service-account.json` na raiz e configure em `appsettings.json`:

```json
"Firebase": {
  "Enabled": true,
  "ProjectId": "decideai-57900",
  "CredentialsPath": "firebase-service-account.json"
}
```

Com `Enabled: false`, o sistema continua usando memória. O arquivo de credenciais está ignorado pelo Git e nunca deve ser publicado.

Antes de uso real, também será necessário decidir como identificar cada participante (login, código individual ou apenas dispositivo). O bloqueio por navegador é adequado para demonstração, mas não impede que alguém limpe os dados do navegador ou use outro aparelho.
