---
impacto: capacidade_nova
secao: adicionado
titulo: Admin › Sistema mostra se as entregas do WhatsApp já chegam assinadas
---

Ao lado do interruptor **"Exigir assinatura nas entregas do canal"**, em **Admin › Sistema**, a tela passa a dizer se as últimas entregas do WhatsApp chegaram assinadas (sim ou não), com a data da última assinada e da última sem assinatura, olhando os últimos 7 dias. Quando a resposta é sim e o interruptor está desligado, ela sugere: _"Pode ligar: o WhatsApp já assina."_

O "sim" só aparece quando **nenhuma** entrega chegou sem assinatura desde a primeira assinada: se algum número chegou sem assinatura depois disso, a resposta é não e a tela não sugere ligar. Um número que não entregou nada nesse intervalo não entra na conta — com o WAHA do compose do Deskcomm todas as sessões assinam juntas, mas se você usa mais de um servidor de WhatsApp, confira cada número antes de ligar.

**O padrão não muda:** o interruptor continua desligado, e nada é ligado sozinho. O conserto do nome da variável do segredo no compose saiu na v1.73.0, e com ele o WAHA do compose deve passar a assinar as entregas (ainda não medido numa VPS atualizada); a tela é justamente o jeito de conferir isso na sua instalação antes de ligar a exigência. Só quem administra a plataforma vê esta informação.
