/**
 * GET /api/v1/ai/providers/:provider/models
 *
 * Lê do catálogo curado `ai_models` (tabela GLOBAL, RLS read-all).
 * Retorna modelos não-deprecated ordenados por default-first depois preço.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ehProvedorSuportado, temCatalogoSincronizavel } from "@/lib/ai/pontos/provedores";
import { buscarModelosDoProvedor } from "@/lib/ai/catalogo-do-provedor";
import { decryptKey, byteaToBuffer } from "@/lib/crypto/aes_gcm";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// A lista única (`lib/ai/pontos/provedores.ts`) — não uma quarta cópia. Esta
// rota alimenta o seletor de modelos; com a lista velha, pedir os modelos da
// OpenRouter devolvia "provedor desconhecido" para um provedor que a tela ao
// lado oferecia.

const MODEL_COLUMNS =
  "id, provider, model_id, display_name, description, context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools, is_default_for_provider, deprecated_at, released_at";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { provider } = await ctx.params;

  if (!ehProvedorSuportado(provider)) {
    return fail("not_found", "Provider desconhecido.", 404, { requestId });
  }

  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const ativa = await orgAtivaDaApi(authUser, requestId);
  if (!ativa.ok) return ativa.response;
  const activeOrg = ativa.org;
  if (!activeOrg) {
    return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_models")
    .select(MODEL_COLUMNS)
    .eq("provider", provider)
    .is("deprecated_at", null)
    .order("is_default_for_provider", { ascending: false })
    .order("input_price_per_million_cents", { ascending: true });

  if (error) {
    return fail("internal_error", "Erro ao listar modelos.", 500, { requestId });
  }

  // UM MODELO DE BUSCA NÃO É UM ATENDENTE.
  //
  // O catálogo é o mesmo que alimenta os pontos de índice/busca do RAG, então
  // ele traz `text-embedding-3-small` — modelo que só converte texto em
  // vetor. Era oferecido no seletor "Modelo" do agente (IA › Agentes › Modelo),
  // e quem o escolhia ficava com um atendente mudo: embedding não conversa.
  //
  // `supports_tools` é a MESMA régua que `escolherModeloDoProvedor`
  // (`lib/ai/agents/escolher-modelo.ts`) já usa para escolher o modelo do
  // atendente e que `validarBinding` aplica no painel: sem ferramenta o modelo
  // devolve texto plausível e nada chega ao funil. Filtrar aqui é filtrar em
  // todos os seletôres — esta rota é a única fonte do `ModelPicker`.
  //
  // O filtro é em memória de propósito: são no máximo centenas de linhas, e
  // assim o teste da rota enxerga a regra (um `eq` no banco o esconderia do
  // dublê, que devolve a lista inteira).
  const models = (data ?? []).filter((m) => m.supports_tools === true);

  // ─── O CATÁLOGO DO PRÓPRIO PROVEDOR, quando o nosso não tem ────────────────
  //
  // `ai_models` é CURADO e semeado à mão: 32 linhas, nenhuma de OpenRouter. Quem
  // cadastrava a chave de lá — o caminho que a tela de Credenciais recomenda como
  // "o mais simples para experimentar" — escolhia o provedor aqui e recebia lista
  // VAZIA, sem explicação. A bandeira `catalogoSincronizavel` existia para isto e
  // não tinha leitor nenhum (anti-pattern nº 3): este é o leitor.
  //
  // O curado VENCE quando existe: ele tem preço conferido, `is_default_for_provider`
  // e nomes revisados. O provedor entra só no vão.
  if (models.length === 0 && temCatalogoSincronizavel(provider)) {
    const credencial = await credencialDaOrganizacao(activeOrg.orgId, provider, requestId);
    const doProvedor = await buscarModelosDoProvedor(
      provider,
      {
        apiKey: credencial?.apiKey ?? null,
        baseUrl: credencial?.baseUrl ?? baseDoProvedor(provider),
      },
      (causa) => {
        // Falha DITA: catálogo que não veio em silêncio vira "este provedor não
        // tem modelos" na tela, que é mentira.
        logger.warn("[ai/models] o provedor não devolveu o catálogo", {
          provider,
          causa,
          requestId,
        });
      },
    );
    return ok({ models: doProvedor }, { requestId });
  }

  return ok({ models }, { requestId });
}

/** O endereço padrão de cada provedor sincronizável, quando a credencial não traz um. */
function baseDoProvedor(provider: string): string {
  if (provider === "openrouter") {
    return (env.OPENROUTER_BASE_URL ?? "").trim() || "https://openrouter.ai/api/v1";
  }
  if (provider === "deepseek") return "https://api.deepseek.com/v1";
  if (provider === "requesty") return "https://router.requesty.ai/v1";
  return "";
}

/**
 * A chave da ORGANIZAÇÃO para falar com o provedor.
 *
 * Admin client bypassa RLS, então o filtro por organização é PROGRAMÁTICO e
 * obrigatório (CLAUDE.md, anti-pattern 10) — é o mesmo cuidado de
 * `lib/ai/gateway-binding.ts`, de onde este trecho vem.
 *
 * Nulo quando não há credencial: o `/models` da OpenRouter é público (medido no
 * cabeçalho de `validateOpenRouterKey`), então a lista ainda vem — só sem o limite
 * de uso da conta.
 */
async function credencialDaOrganizacao(
  organizationId: string,
  provider: string,
  requestId: string,
): Promise<{ apiKey: string; baseUrl: string } | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ai_provider_credentials")
      .select("api_key_encrypted, api_key_iv, api_key_tag, base_url")
      .eq("organization_id", organizationId)
      .eq("provider", provider)
      .eq("is_active", true)
      .not("validated_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;

    return {
      apiKey: decryptKey({
        ciphertext: byteaToBuffer(data.api_key_encrypted),
        iv: byteaToBuffer(data.api_key_iv),
        tag: byteaToBuffer(data.api_key_tag),
      }),
      baseUrl: (data.base_url as string | null)?.trim() || baseDoProvedor(provider),
    };
  } catch (erro) {
    // Falha ABERTA na informação: sem a chave ainda dá para pedir o catálogo
    // público. O que não pode é derrubar a tela por causa de uma leitura.
    logger.warn("[ai/models] credencial ilegível — segue sem chave", {
      provider,
      requestId,
      causa: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}
