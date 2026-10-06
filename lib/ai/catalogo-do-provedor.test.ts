import { describe, expect, it } from "vitest";

import { normalizarModelosDoProvedor } from "./catalogo-do-provedor";

/**
 * O CATÁLOGO QUE VEM DO PROVEDOR — e por que ele precisou existir.
 *
 * `lib/ai/pontos/provedores.ts` marca `catalogoSincronizavel: true` em OpenRouter,
 * DeepSeek e Requesty desde que a lista nasceu. **Nada lia essa bandeira**
 * (medido: zero consumidores) — evento sem consumidor, o anti-pattern nº 3 do
 * CLAUDE.md.
 *
 * A consequência para quem usa: `ai_models` só tem as 32 linhas semeadas à mão no
 * baseline (`source='manual'`), e nenhuma é de OpenRouter. Quem cadastra a chave
 * da OpenRouter — o caminho que a própria tela recomenda como "o mais simples para
 * experimentar" — escolhe o provedor e recebe um seletor VAZIO, sem explicação.
 *
 * Esta função traduz a resposta do provedor para o formato do seletor. Pura: a
 * rede fica fora, e é o que permite exercitar as formas estranhas que um catálogo
 * de centenas de modelos tem.
 */

/** Uma entrada da OpenRouter, como ela vem. */
function modelo(over: Record<string, unknown> = {}) {
  return {
    id: "anthropic/claude-sonnet-4.5",
    name: "Anthropic: Claude Sonnet 4.5",
    context_length: 200_000,
    pricing: { prompt: "0.000003", completion: "0.000015" },
    supported_parameters: ["tools", "temperature"],
    ...over,
  };
}

const normal = (dados: unknown) => normalizarModelosDoProvedor("openrouter", dados);

describe("o que entra no seletor", () => {
  it("traduz id, nome e janela de contexto", () => {
    const r = normal({ data: [modelo()] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      provider: "openrouter",
      model_id: "anthropic/claude-sonnet-4.5",
      display_name: "Anthropic: Claude Sonnet 4.5",
      context_window: 200_000,
    });
  });

  it("sem nome, o id serve de rótulo — nunca fica em branco", () => {
    const r = normal({ data: [modelo({ name: undefined })] });
    expect(r[0]?.display_name).toBe("anthropic/claude-sonnet-4.5");
  });
});

describe("a régua das FERRAMENTAS — a mesma da rota", () => {
  it("modelo SEM `tools` fica de fora", () => {
    // É a regra que a rota já aplica com `supports_tools`: um modelo que não
    // chama ferramenta devolve texto plausível e nada chega ao funil. Quem o
    // escolhesse ficaria com um atendente mudo.
    const r = normal({ data: [modelo({ supported_parameters: ["temperature"] })] });
    expect(r).toEqual([]);
  });

  it("sem a lista de parâmetros, fica de fora — não se presume ferramenta", () => {
    const r = normal({ data: [modelo({ supported_parameters: undefined })] });
    expect(r).toEqual([]);
  });

  it("modelo de embedding não vira atendente", () => {
    const r = normal({
      data: [modelo({ id: "openai/text-embedding-3-small", supported_parameters: [] })],
    });
    expect(r).toEqual([]);
  });
});

describe("o preço", () => {
  it("converte preço por TOKEN em centavos por MILHÃO", () => {
    // A OpenRouter cobra por token em dólar (string). O catálogo guarda centavos
    // por milhão — é a régua de `ai_models`, e misturar as duas erraria o custo
    // por um fator de cem milhões.
    const r = normal({ data: [modelo({ pricing: { prompt: "0.000003", completion: "0.000015" } })] });
    expect(r[0]?.input_price_per_million_cents).toBe(300);
    expect(r[0]?.output_price_per_million_cents).toBe(1500);
  });

  it("modelo GRÁTIS entra, com preço zero — não é 'sem preço'", () => {
    // Os gratuitos são a razão pela qual a tela recomenda a OpenRouter. Descartá-los
    // por preço zero tiraria justamente o que o cliente foi buscar.
    const r = normal({
      data: [modelo({ id: "meta/llama-free", pricing: { prompt: "0", completion: "0" } })],
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.input_price_per_million_cents).toBe(0);
  });

  it("preço ilegível vira nulo, e o modelo continua na lista", () => {
    // "sem preço conhecido" não é "modelo inexistente". Nulo é o que `ai_models`
    // já usa para desconhecido.
    const r = normal({ data: [modelo({ pricing: { prompt: "auto", completion: null } })] });
    expect(r).toHaveLength(1);
    expect(r[0]?.input_price_per_million_cents).toBeNull();
  });
});

describe("a resposta estranha", () => {
  it("lista vazia devolve vazio", () => {
    expect(normal({ data: [] })).toEqual([]);
  });

  it("resposta sem `data` devolve vazio em vez de lançar", () => {
    expect(normal({})).toEqual([]);
    expect(normal(null)).toEqual([]);
    expect(normal("boom")).toEqual([]);
  });

  it("entrada quebrada no meio não derruba as boas", () => {
    const r = normal({ data: [modelo(), { nao: "é modelo" }, modelo({ id: "outro/modelo" })] });
    expect(r.map((m) => m.model_id)).toEqual(["anthropic/claude-sonnet-4.5", "outro/modelo"]);
  });

  it("id repetido entra uma vez só", () => {
    const r = normal({ data: [modelo(), modelo()] });
    expect(r).toHaveLength(1);
  });

  it("janela de contexto ausente vira nulo", () => {
    expect(normal({ data: [modelo({ context_length: undefined })] })[0]?.context_window).toBeNull();
  });
});

describe("a ordem", () => {
  it("do mais barato ao mais caro — a mesma da rota", () => {
    const r = normal({
      data: [
        modelo({ id: "caro", pricing: { prompt: "0.00001", completion: "0.00002" } }),
        modelo({ id: "gratis", pricing: { prompt: "0", completion: "0" } }),
        modelo({ id: "medio", pricing: { prompt: "0.000003", completion: "0.000005" } }),
      ],
    });
    expect(r.map((m) => m.model_id)).toEqual(["gratis", "medio", "caro"]);
  });

  it("sem preço vai para o fim — não finge ser o mais barato", () => {
    const r = normal({
      data: [
        modelo({ id: "sem-preco", pricing: { prompt: "auto", completion: "auto" } }),
        modelo({ id: "pago", pricing: { prompt: "0.000003", completion: "0.000005" } }),
      ],
    });
    expect(r.map((m) => m.model_id)).toEqual(["pago", "sem-preco"]);
  });
});
