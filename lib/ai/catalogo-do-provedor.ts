/**
 * O CATÁLOGO DE MODELOS LIDO DO PRÓPRIO PROVEDOR.
 *
 * ═══ Por que isto precisou existir ═══
 *
 * `lib/ai/pontos/provedores.ts` marca `catalogoSincronizavel: true` em OpenRouter,
 * DeepSeek e Requesty desde que a lista nasceu — e **nada lia essa bandeira**
 * (medido em 03/10/2026: zero consumidores fora do próprio arquivo). Evento sem
 * consumidor é o anti-pattern nº 3 do CLAUDE.md, e aqui ele tinha efeito visível:
 *
 * `ai_models` é um catálogo CURADO, semeado à mão no baseline — 32 linhas, todas
 * `source='manual'`, nenhuma de OpenRouter. Quem cadastra a chave da OpenRouter
 * (o caminho que a própria tela de Credenciais recomenda como "o mais simples para
 * experimentar") escolhia o provedor no seletor de modelo do agente e recebia uma
 * lista VAZIA, sem explicação. O catálogo curado não tem como acompanhar centenas
 * de modelos de dezenas de fabricantes; o provedor tem.
 *
 * ═══ A régua das ferramentas é a MESMA da rota ═══
 *
 * `app/api/v1/ai/providers/[provider]/models/route.ts` filtra `supports_tools`
 * porque "um modelo de busca não é um atendente": sem ferramenta, o modelo devolve
 * texto plausível e nada chega ao funil. Quem vem do provedor passa pela mesma
 * régua — senão a lista ao vivo ofereceria o que a lista curada recusa.
 *
 * ═══ Puro ═══
 *
 * A rede fica em quem chama. É o que permite exercitar as formas estranhas que um
 * catálogo grande tem — preço em string, modelo grátis, entrada quebrada no meio —
 * sem falar com ninguém.
 */

/** Quantos segundos esperar o provedor. Acima disso, o seletor abre sem a lista. */
const PRAZO_MS = 8_000;

/** O formato que o seletor consome, igual ao que a rota devolve do catálogo. */
export type ModeloDoProvedor = {
  provider: string;
  model_id: string;
  display_name: string;
  context_window: number | null;
  input_price_per_million_cents: number | null;
  output_price_per_million_cents: number | null;
  supports_tools: true;
  is_default_for_provider: false;
};

/**
 * Preço por TOKEN em dólar (string) → centavos por MILHÃO de tokens.
 *
 * As duas réguas não podem se misturar: errar a conversão erra o custo por um
 * fator de cem milhões. `"0"` é preço VÁLIDO (modelo grátis) e não pode virar
 * nulo — os gratuitos são a razão pela qual a tela recomenda a OpenRouter.
 */
function centavosPorMilhao(bruto: unknown): number | null {
  if (typeof bruto !== "string" && typeof bruto !== "number") return null;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 100);
}

/** `undefined`/ausente vira nulo — "não sei" nunca vira zero. */
function janela(bruto: unknown): number | null {
  const n = typeof bruto === "number" ? bruto : Number(bruto);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * Traduz a resposta do provedor. **Nunca lança**: catálogo ilegível devolve lista
 * vazia, e quem chama decide o que dizer — um seletor vazio com explicação é
 * melhor que uma tela que quebra.
 */
export function normalizarModelosDoProvedor(
  provider: string,
  resposta: unknown,
): ModeloDoProvedor[] {
  const bruto = (resposta as { data?: unknown } | null)?.data;
  if (!Array.isArray(bruto)) return [];

  const vistos = new Set<string>();
  const saida: ModeloDoProvedor[] = [];

  for (const cru of bruto) {
    if (typeof cru !== "object" || cru === null) continue;
    const m = cru as Record<string, unknown>;

    const id = typeof m.id === "string" ? m.id.trim() : "";
    if (id === "" || vistos.has(id)) continue;

    // A MESMA régua da rota: sem ferramenta não é atendente. Ausência da lista
    // conta como "não suporta" — presumir o contrário ofereceria um mudo.
    const params = m.supported_parameters;
    if (!Array.isArray(params) || !params.includes("tools")) continue;

    vistos.add(id);
    const preco = (m.pricing ?? {}) as Record<string, unknown>;
    saida.push({
      provider,
      model_id: id,
      // Sem nome, o id serve: rótulo em branco é pior que rótulo técnico.
      display_name: typeof m.name === "string" && m.name.trim() !== "" ? m.name : id,
      context_window: janela(m.context_length),
      input_price_per_million_cents: centavosPorMilhao(preco.prompt),
      output_price_per_million_cents: centavosPorMilhao(preco.completion),
      supports_tools: true,
      // O "padrão do provedor" é curadoria nossa, e o provedor não a conhece.
      is_default_for_provider: false,
    });
  }

  // Do mais barato ao mais caro, como a rota ordena o catálogo. Sem preço vai
  // para o FIM: desconhecido não pode se passar pelo mais barato.
  return saida.sort((a, b) => {
    const x = a.input_price_per_million_cents;
    const y = b.input_price_per_million_cents;
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  });
}

/**
 * Pede o catálogo ao provedor. **Nunca lança** e **nunca demora para sempre.**
 *
 * O prazo existe porque isto roda no caminho de uma tela: um provedor lento
 * deixaria o seletor girando sem fim, e um seletor vazio COM explicação é melhor
 * que uma tela que não responde. A falha é DITA por `aoFalhar` — catálogo que não
 * veio em silêncio vira "este provedor não tem modelos", que é mentira.
 *
 * A chave vai no `Authorization` mesmo quando o endpoint é público (o `/models` da
 * OpenRouter é — está medido no cabeçalho de `validateOpenRouterKey`): com a chave,
 * o provedor aplica o limite de uso DA CONTA em vez do limite anônimo, que é
 * compartilhado e cai sob carga.
 */
export async function buscarModelosDoProvedor(
  provider: string,
  entrada: { apiKey: string | null; baseUrl: string },
  aoFalhar?: (causa: string) => void,
): Promise<ModeloDoProvedor[]> {
  const base = entrada.baseUrl.trim().replace(/\/+$/, "");
  if (base === "") {
    aoFalhar?.("sem_endereco");
    return [];
  }

  const corte = AbortSignal.timeout(PRAZO_MS);
  try {
    const cabecalhos: Record<string, string> = { Accept: "application/json" };
    if (entrada.apiKey !== null && entrada.apiKey !== "") {
      cabecalhos.Authorization = `Bearer ${entrada.apiKey}`;
    }

    const resposta = await fetch(`${base}/models`, {
      method: "GET",
      headers: cabecalhos,
      signal: corte,
      cache: "no-store",
    });
    if (!resposta.ok) {
      aoFalhar?.(`status_${resposta.status}`);
      return [];
    }
    return normalizarModelosDoProvedor(provider, await resposta.json());
  } catch (erro) {
    // `TimeoutError` quando o prazo venceu; qualquer outra coisa é rede.
    aoFalhar?.(erro instanceof Error ? erro.name : "erro_de_rede");
    return [];
  }
}
