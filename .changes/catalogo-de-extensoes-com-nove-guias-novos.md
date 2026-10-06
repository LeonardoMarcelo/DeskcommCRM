---
impacto: capacidade_nova
secao: adicionado
titulo: O catálogo de extensões passa de 3 para 12 guias, cobrindo mais nichos
---

O catálogo que acompanha o projeto (`extensoes/catalogo.json`) tinha **três** guias — carrinho abandonado, primeira semana no atendimento e retorno de paciente. Passa a ter **doze**, equilibrados em quatro por categoria:

- **Vendas** — *Orçamento que volta* (como enviar para ter resposta, como cobrar sem parecer insistência e como encerrar sem queimar a relação), *Imobiliária: da visita à proposta*, *Reativar a base parada*.
- **Atendimento** — *Ótica: da receita ao retorno* (ler a receita, acompanhar a adaptação de lente de contato, o retorno de um ano), *Escritório: o primeiro atendimento* (triagem sem prometer resultado), *Pós-venda e indicação*.
- **Produtividade** — *Agenda que não fura* (confirmação que reduz falta e o que fazer com o horário vago), *O número que não cai* (aquecimento, ritmo de disparo e os sinais que vêm antes do bloqueio), *Um funil que diz a verdade*.

Todos são do perfil **declarativo**: só mostram cartões de orientação e abrem telas que o próprio produto já tem (`data.mode: "none"`). **Nenhum deles recebe dado do CRM nem executa código** — a tela de permissões continua listando exatamente o que cada um pode abrir, antes de a organização aceitar. Os textos vêm em português e espanhol.

**Nada é instalado nem ativado sozinho.** O catálogo é um arquivo do repositório; quem administra a instalação precisa admiti-lo (em **Extensões**, "Admitir catálogo"), e cada organização decide depois o que instala e ativa. Quem já tinha a revisão 1 admitida vê a revisão subir para 2 ao admitir o arquivo novo.

Os pacotes vivem em `extensoes/pacotes/`, e o catálogo continua sendo **derivado** deles por `scripts/gerar-catalogo-de-extensoes.ts` — o `sha256` de cada entrada é o byte exato do pacote, conferido na instalação.
