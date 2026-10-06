---
impacto: capacidade_nova
secao: corrigido
titulo: Em Provedores de IA, escolher o provedor passa a listar os modelos dele — inclusive os da OpenRouter
---

Na tela **Provedores de IA**, trocar o provedor no "Modelo padrão" ou em qualquer um dos pontos passa a carregar a lista de modelos daquele provedor. Antes, a lista vinha de um catálogo curado que acompanha a instalação e que não tem modelos da OpenRouter: quem escolhia OpenRouter — o provedor que a própria tela de Credenciais recomenda como o mais simples para experimentar — recebia um campo de texto vazio e precisava adivinhar o identificador do modelo, que é uma string como `meta-llama/llama-3.3-70b-instruct`.

A rota que busca o catálogo do próprio provedor já existia e já era usada pelo seletor de modelo do agente; era esta tela que não a chamava. Medido numa instalação com a chave da OpenRouter cadastrada: **396 modelos** no seletor, contra nenhum antes.

O campo de texto livre continua para os provedores que **não publicam** a lista — Anthropic, OpenAI e Google não publicam, e para eles o catálogo é curado à mão. A diferença é que agora a tela diz por que o campo é livre, e separa "este provedor não publica a lista de modelos" de "não consegui falar com o provedor para listar os modelos" — duas situações que antes apareciam com o mesmo texto.

Quem não usa OpenRouter, DeepSeek ou Requesty não vê diferença: para os provedores de catálogo curado a lista é a mesma de sempre, com o modelo padrão marcado.
