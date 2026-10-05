import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import {
  FAIXA_ALEM_DO_FIM,
  filtroDaBuscaDoCatalogo,
  intervaloDaPagina,
  paginaDaUrl,
  PRODUTOS_POR_PAGINA,
  ultimaPagina,
} from "@/lib/catalogo/busca-da-tela";
import { BUCKET_DAS_FOTOS, fotoPertenceAoProduto } from "@/lib/catalogo/fotos";
import { traduzir } from "@/lib/i18n/dicionario";
import { COLUNAS_DO_PRODUTO, type Produto } from "@/lib/schemas/produtos";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { ProdutosClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Produtos" };

/**
 * O CATÁLOGO DA LOJA — onde o preço que a IA responde é cadastrado.
 *
 * ─── Por que esta tela precisa existir ───────────────────────────────────
 *
 * A ferramenta `crm_search_products` já vinha ligada em todo agente novo, e
 * lia uma tabela que ninguém nunca preencheu. O efeito não era silêncio: era o
 * agente respondendo "não tenho nada com esse nome no catálogo" para uma loja
 * com o estoque cheio. Ferramenta que devolve vazio para 100% das lojas é pior
 * que ferramenta ausente — ela mente com autoridade.
 *
 * ─── Quem pode o quê ─────────────────────────────────────────────────────
 *
 * `viewer` VÊ o catálogo: saber quanto custa é informação de operação, e quem
 * atende precisa dela. Cadastrar e alterar preço é `manager`, e a rota cobra de
 * novo — a tela esconder o botão é cortesia, não autorização.
 */
export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  // Busca e página moram na URL: o servidor traz só a página pedida, de TODO o
  // catálogo. Antes eram os 500 primeiros, filtrados no navegador — o resto não
  // aparecia nem pela busca (ver `lib/catalogo/busca-da-tela.ts`).
  const parametros = await searchParams;
  const busca = (parametros.busca ?? "").trim();
  const pagina = paginaDaUrl(parametros.pagina);
  const filtro = filtroDaBuscaDoCatalogo(busca);

  const supabase = await createClient();
  const consultaDoCatalogo = (soContar: boolean) => {
    const q = supabase
      .from("catalog_products")
      .select(soContar ? "id" : COLUNAS_DO_PRODUTO, { count: "exact", head: soContar })
      .eq("organization_id", activeOrg.orgId);
    return filtro ? q.or(filtro) : q;
  };

  let produtos: Produto[] = [];
  let total = 0;
  let paginaMostrada = pagina;
  // Termo abaixo do piso (uma letra, só pontuação) NÃO vai ao banco e não lista
  // nada — o mesmo desfecho da rota e da busca de contatos. Ignorar o termo
  // mostraria o catálogo inteiro com a palavra na caixa: ruído que parece resposta.
  if (busca === "" || filtro !== null) {
    const lerPagina = (p: number) =>
      consultaDoCatalogo(false)
        .order("ativo", { ascending: false })
        .order("nome")
        .order("id")
        .range(...intervaloDaPagina(p));

    // Página > 1: conta ANTES e nunca pede uma faixa além do fim. Pedir o
    // `range` de uma página que não existe (link antigo, ou apagaram o último
    // produto dela) não devolve o 416 na hora: no e2e
    // `catalogo-busca-no-catalogo-inteiro` a consulta com deslocamento além do
    // total estourou o `statement_timeout` (8 s, "canceling statement due to
    // statement timeout") com 529 produtos — enquanto as páginas que existem
    // respondiam em ~60 ms —, a página lançava erro e a tela ficava presa no
    // carregamento. A contagem `head` é barata e devolve a última página real.
    //
    // Sem `redirect()` aqui. Esta página roda dentro do Suspense do
    // `app/app/loading.tsx`, e um redirect com o streaming já começado vira
    // navegação no cliente (issue #1374). O servidor entrega a última página
    // que existe; a URL é corrigida no cliente (`paginaPedida` em
    // `ProdutosClient`), pelo mesmo `router.replace` da paginação.
    if (pagina > 1) {
      const { count: totalAntes, error: erroDaContagem } = await consultaDoCatalogo(true);
      if (erroDaContagem) throw new Error(`Não consegui ler o catálogo: ${erroDaContagem.message}`);
      paginaMostrada = Math.min(pagina, ultimaPagina(totalAntes ?? 0));
    }

    let { data, count, error } = await lerPagina(paginaMostrada);

    // A corrida que a contagem não fecha: alguém apagou produtos entre ela e a
    // leitura, e a página encolheu por baixo de nós. O PostgREST diz isso de
    // dois jeitos — 416 quando o início passa do total, 206 vazio quando
    // começa EXATAMENTE nele —, e os dois dão na última página que sobrou.
    const alemDoFim =
      error?.code === FAIXA_ALEM_DO_FIM || (!error && paginaMostrada > 1 && (data ?? []).length === 0);
    if (alemDoFim) {
      const agora = error ? (await consultaDoCatalogo(true)).count : count;
      paginaMostrada = ultimaPagina(agora ?? 0);
      ({ data, count, error } = await lerPagina(paginaMostrada));
    }
    // Erro do banco não vira "nenhum produto cadastrado": a tela de erro do app
    // diz que algo falhou, em vez de afirmar que o catálogo está vazio.
    if (error) throw new Error(`Não consegui ler o catálogo: ${error.message}`);
    produtos = (data ?? []) as unknown as Produto[];
    total = count ?? produtos.length;
  }

  // O bucket é privado: a tela recebe URL assinada de 1 h, montada aqui. Só
  // caminho que é DO produto (ver `fotoPertenceAoProduto`) — a assinatura é
  // por service role, e a linha é gravável pelo PostgREST.
  const caminhos = produtos.flatMap((p) =>
    (p.fotos ?? []).filter((c) => fotoPertenceAoProduto(c, activeOrg.orgId, p.id)),
  );
  const urlsDasFotos: Record<string, string> = {};
  if (caminhos.length > 0) {
    const { data: assinadas } = await createAdminClient()
      .storage.from(BUCKET_DAS_FOTOS)
      .createSignedUrls(caminhos, 3600);
    for (const a of assinadas ?? []) {
      if (a.path && a.signedUrl) urlsDasFotos[a.path] = a.signedUrl;
    }
  }

  return (
    <ProdutosClient
      inicial={produtos}
      total={total}
      pagina={paginaMostrada}
      paginaPedida={pagina}
      porPagina={PRODUTOS_POR_PAGINA}
      buscaInicial={busca}
      urlsDasFotos={urlsDasFotos}
      podeEditar={podeEditar}
      textos={{
        titulo: t("Produtos"),
        subtitulo: t(
          "O catálogo da loja. É daqui que o atendente de IA tira o preço quando alguém pergunta.",
        ),
        vazio: t("Nenhum produto cadastrado ainda"),
        vazioDica: t(
          "Enquanto o catálogo estiver vazio, o atendente responde que não encontrou o produto — mesmo que a loja tenha.",
        ),
      }}
    />
  );
}
