import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PÁGINA ALÉM DO FIM: O SERVIDOR MOSTRA A ÚLTIMA, O CLIENTE CORRIGE A URL.
 *
 * No e2e `catalogo-busca-no-catalogo-inteiro` (main c85293f05 e PRs que a
 * incluem), a página 99 de uma busca com 529 produtos pedia ao PostgREST uma
 * faixa além do total — e a consulta, em vez do 416 imediato, estourava o
 * `statement_timeout` de 8 s ("canceling statement due to statement timeout",
 * log do servidor no CI). A página lançava erro e o stream ficava sem revelar.
 * Agora a página > 1 conta antes e só lê uma página que existe; o servidor
 * entrega a última, e a URL acompanha pelo `router.replace` da paginação (sem
 * `redirect()` no meio do streaming do `loading.tsx`, issue #1374).
 */

const replace = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiClient: { post: vi.fn(), patch: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { ProdutosClient } from "@/app/app/products/_client";

const TEXTOS = { titulo: "Produtos", subtitulo: "", vazio: "", vazioDica: "" };

function tela(pagina: number, paginaPedida: number, busca = "Produto paginado") {
  return (
    <ProdutosClient
      inicial={[]}
      total={529}
      pagina={pagina}
      paginaPedida={paginaPedida}
      porPagina={50}
      buscaInicial={busca}
      urlsDasFotos={{}}
      podeEditar={false}
      textos={TEXTOS}
    />
  );
}

beforeEach(() => replace.mockClear());

describe("a URL acompanha a página que o servidor mostrou", () => {
  it("pediu a 99, o servidor mostrou a 11: a URL vira pagina=11, com a mesma busca", () => {
    render(tela(11, 99));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?busca=Produto+paginado&pagina=11", { scroll: false });
  });

  it("voltou para a primeira: a URL perde o parâmetro de página", () => {
    render(tela(1, 2, "Cinquenta"));
    expect(replace).toHaveBeenCalledWith("?busca=Cinquenta", { scroll: false });
  });

  it("página dentro do catálogo: nada é reescrito", () => {
    render(tela(3, 3));
    expect(replace).not.toHaveBeenCalled();
  });

  it("página > 1: conta ANTES de ler, e só lê uma página que existe", () => {
    const fonte = readFileSync(join(process.cwd(), "app/app/products/page.tsx"), "utf8");
    const contagem = fonte.indexOf("if (pagina > 1) {");
    const leitura = fonte.indexOf("await lerPagina(paginaMostrada)");
    expect(contagem).toBeGreaterThan(-1);
    expect(leitura).toBeGreaterThan(contagem);
    const bloco = fonte.slice(contagem, leitura);
    expect(bloco).toContain("consultaDoCatalogo(true)");
    expect(bloco).toContain("Math.min(pagina, ultimaPagina(");
    expect(fonte).not.toContain("await lerPagina(pagina)");
  });

  it("o servidor não redireciona por página além do fim (a URL é corrigida no cliente)", () => {
    const fonte = readFileSync(join(process.cwd(), "app/app/products/page.tsx"), "utf8");
    const bloco = fonte.slice(fonte.indexOf("const alemDoFim"), fonte.indexOf("if (error) throw"));
    expect(bloco).toContain("paginaMostrada = ultimaPagina(");
    expect(bloco).not.toMatch(/redirect\(/);
  });
});
