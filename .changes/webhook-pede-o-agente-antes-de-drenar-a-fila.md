---
impacto: nada_mudou
secao: alterado
titulo: A resposta do agente começa mais cedo — a mensagem que chega não espera mais a fila de eventos de todas as empresas
---

Cada mensagem recebida pedia o turno do agente só depois de processar, dentro do próprio recebimento, até 50 eventos pendentes da fila interna — de qualquer empresa da instalação, inclusive a preparação de PDFs, a mídia e as notificações. Agora o pedido do turno sai logo depois de o follow-up do contato reagir à mensagem, e a fila vem depois.

Numa instalação com o `worker` de pé (o padrão do `docker-compose.prod.yml`), o recebimento passa a processar só o que é da mesma empresa e só os gatilhos que inscrevem o contato num fluxo — o "cliente voltou depois de um tempo" e o "lead novo". Sentimento, notificações, mídia, automações e a contagem de resposta de campanha seguem para o `worker`, que já drena essa fila em poucos segundos (a cada 2 s quando há fila, até 10 s quando está parado). Por isso a notificação de nova mensagem ao atendente e as automações de mensagem recebida podem chegar alguns segundos depois do que chegavam. A ordem que importa para o cliente não muda: quem responde a um fluxo de follow-up avança o fluxo antes de o agente ser chamado, e a primeira mensagem de um fluxo de lead novo continua saindo na hora.

A atualização não pede nada. O compose novo declara `EVENT_LOG_WORKER_DRAINS=true` para o app sozinho. Quem quiser o comportamento antigo grava `EVENT_LOG_WORKER_DRAINS=false` no `.env` e reinicia o app. Sem o `worker` (desenvolvimento com `npm run dev`, por exemplo), a variável fica vazia e nada muda.
