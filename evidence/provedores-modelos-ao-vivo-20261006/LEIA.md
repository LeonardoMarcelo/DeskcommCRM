# Provedores de IA — o seletor de modelo passa a listar o provedor escolhido

Prova pela tela (DoD 12) da mudança que fez a tela **Provedores de IA**
(`/app/ai/providers`) consultar os modelos do provedor selecionado, em vez de
filtrar um catálogo pré-carregado.

## O defeito

A tela montava a lista a partir de `dados.modelos` — o catálogo CURADO que
`/api/v1/ai/providers` devolve inteiro, semeado à mão pelo `baseline.sql`.
Medido nesta instalação, esse catálogo tem **32 modelos em cinco provedores e
nenhum da OpenRouter**:

```
anthropic 6 · deepseek 2 · google 6 · openai 13 · requesty 5
```

Quem escolhia OpenRouter — e esta instalação tem **duas credenciais OpenRouter
ativas e validadas** — caía num campo de texto livre e precisava adivinhar o
identificador do modelo.

## O que já existia e ninguém chamava desta tela

`GET /api/v1/ai/providers/:provider/models` já resolvia o caso: quando o catálogo
curado não tem o provedor, ela busca o catálogo do **próprio provedor**, com a
credencial da organização. O cabeçalho dela diz que é "a única fonte do
`ModelPicker`" — e a tela de Provedores era justamente quem não usava o
`ModelPicker`.

Medido pela rota, autenticado, nesta instalação:

```
openrouter   HTTP 200   396 modelos
anthropic    HTTP 200     6 modelos
deepseek     HTTP 200     2 modelos
```

## Depois, medido na tela

Trocando o provedor no cartão **Modelo padrão** e abrindo o seletor:

| provedor   | opções no seletor | primeira                    |
| ---------- | ----------------- | --------------------------- |
| OpenRouter | **396**           | inclusionAI: Ling 3.1 Flash |
| Anthropic  | 6                 | Claude Sonnet 5 · default   |
| DeepSeek   | 2                 | DeepSeek Flash              |

![O seletor de modelo do cartão "Modelo padrão" com OpenRouter escolhido, listando os modelos vindos do provedor, com teto de altura e rolagem](evidence/provedores-modelos-ao-vivo-20261006/padrao-openrouter.png)

## Duas medições que valem registrar

**O painel é opaco; a primeira captura mentiu.** A captura inicial saiu
translúcida, com o texto de trás aparecendo — parecia defeito de fundo. Medindo
o estado ESTÁVEL (depois dos 200ms da animação de entrada que este mesmo ciclo
acrescentou aos sobrepostos): `opacity: 1`, `background: rgb(255, 255, 255)`.
Era quadro intermediário de animação, não defeito. É a mesma armadilha que
`agenda-painel-cabe-na-tela.spec.ts` registra: medir no meio da transição dá
falso vermelho hoje e falso verde amanhã.

**O teto de altura é necessário.** Com 396 modelos, a lista sem `max-h` abre
maior que a janela e o primeiro item fica fora da tela. Medido: `max-height:
288px`, com rolagem interna.

## O que NÃO mudou

O campo de texto livre continua existindo — mas só quando o provedor de fato não
publica catálogo (Anthropic, OpenAI e Google não publicam; o nosso é curado), e
agora o componente **diz por quê**, separando "este provedor não publica a lista"
de "não consegui falar com o provedor".
