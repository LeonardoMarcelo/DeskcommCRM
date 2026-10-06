---
impacto: capacidade_nova
secao: adicionado
titulo: O seletor de modelo do agente passa a carregar os modelos do próprio provedor
---
Quem cadastrava a chave da OpenRouter — o caminho que a tela de Credenciais recomenda como "o mais simples para experimentar", com acesso a centenas de modelos de dezenas de fabricantes — escolhia o provedor no agente e recebia um seletor **vazio**, sem explicação. O catálogo do sistema é curado à mão e tem 32 modelos, nenhum da OpenRouter; ele não tem como acompanhar um provedor que agrega centenas.

Agora, quando o catálogo do sistema não tem modelos para o provedor escolhido, a lista vem **do provedor**, com a chave que a empresa cadastrou. Medido numa conta real: 466 modelos na resposta, **398 oferecidos** — incluindo os **19 gratuitos**, que são boa parte da razão de usar a OpenRouter.

Três cuidados que decidem se a lista presta:

- **Modelo que não chama ferramenta não aparece.** É a mesma régua que o catálogo curado já aplica: sem ferramenta o modelo devolve texto plausível e nada chega ao funil — quem o escolhesse ficaria com um atendente mudo. Dos 466, 68 caíram aqui.
- **O catálogo curado continua mandando** onde ele tem modelos. Ele traz preço conferido, nome revisado e a marcação de padrão; o provedor só preenche o vão.
- **Preço e ordem.** A lista vem do mais barato ao mais caro, e quem não publica preço vai para o fim em vez de se passar pelo mais barato. Modelo gratuito entra com preço zero — zero é preço, não ausência.

Se o provedor não responder em 8 segundos, ou responder erro, o seletor abre sem a lista e o fato fica registrado no log da instalação — em vez de a tela girar sem fim ou dizer que o provedor não tem modelos, que seria mentira.

Vale para OpenRouter, DeepSeek e Requesty, que são os provedores que publicam catálogo. Não é preciso fazer nada na instalação.
