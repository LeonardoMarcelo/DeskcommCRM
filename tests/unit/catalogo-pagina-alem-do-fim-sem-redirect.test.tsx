import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PÁGINA ALÉM DO FIM: O SERVIDOR MOSTRA A ÚLTIMA, O CLIENTE CORRIGE A URL.
 *
 * A página `/app/products` roda dentro do Suspense do `app/app/loading.tsx`.
 * Um `redirect()` no servidor depois que o streaming começou vira navegação no
 * cliente e deixa a caixa `S:` sem revelar (issue #1374): o e2e
 * `catalogo-busca-no-catalogo-inteiro` passava ou falhava conforme a corrida, e
 * na `main` em c85293f05 falhou. O servidor passa a ler a última página e
 * entregar; a URL acompanha pelo `router.replace`, o mesmo da paginação.
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

  it("o servidor não redireciona por página além do fim (é o que deixava a caixa do stream órfã)", () => {
    const fonte = readFileSync(join(process.cwd(), "app/app/products/page.tsx"), "utf8");
    const bloco = fonte.slice(fonte.indexOf("const alemDoFim"), fonte.indexOf("if (error) throw"));
    expect(bloco).toContain("paginaMostrada = ultimaPagina(");
    expect(bloco).not.toMatch(/redirect\(/);
  });
});
