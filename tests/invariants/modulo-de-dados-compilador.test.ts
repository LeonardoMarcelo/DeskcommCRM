import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

// O compilador da onda 1 da ADR-0005: um módulo de TERCEIRO declara objetos e campos, e quem
// escreve o SQL é o banco, lendo o artefato JÁ ADMITIDO (imutável, validado, auditado). Nenhum SQL
// vem de quem chama — o parâmetro é o id de uma linha de `extension_artifacts`, não DDL. É o que
// mantém de pé o argumento D4 da ADR-0002 (provisionadora de efeito fixo, não escolhido pelo
// chamador) enquanto abre o marco 4 que a D9 deixou aberto.
if (!process.env.TEST_DB_PORT) throw new Error("TEST_DB_PORT ausente — execute pnpm test:db");
const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
  max: 4,
});
const query = (text: string, values: unknown[] = []) => pool.query(text, values);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

const orgA = "d1a50000-0000-4000-8000-000000000001";
const orgB = "d1a50000-0000-4000-8000-000000000002";

/** Um manifesto `data` mínimo: um objeto, campos de tipos distintos, uma referência ao contato. */
function manifesto(overrides: Record<string, unknown> = {}) {
  const base = {
    format_version: 1,
    profile: "data",
    publisher: "clinica",
    name: "odontograma",
    version: "1.0.0",
    license: "MIT",
    host_api: { min: 1, max: 1 },
    permissions: [],
    dependencies: [],
    display: { title: { "pt-BR": "Odontograma" }, summary: { "pt-BR": "Dente a dente" }, category: "productivity", icon: "ListChecks" },
    configuration: {},
    contributions: {},
    dados: {
      objetos: [
        {
          slug: "marcacao",
          rotulo: { "pt-BR": "Marcação" },
          campos: [
            { slug: "dente", tipo: "inteiro", obrigatorio: true },
            { slug: "condicao", tipo: "texto", obrigatorio: true },
            { slug: "valor", tipo: "dinheiro" },
            { slug: "feito_em", tipo: "data" },
          ],
          refs: [{ slug: "paciente", entidade: "contato", obrigatorio: true, ao_apagar: "cascata" }],
        },
      ],
    },
  };
  return { ...base, ...overrides };
}

/** Grava o artefato como se a admissão já o tivesse publicado. O caminho de admissão tem provas próprias. */
async function artefato(m: Record<string, unknown> = manifesto()) {
  const doc = JSON.stringify(m);
  const r = await query(
    `insert into public.extension_artifacts(sha256, byte_length, manifest, document)
     values ($1, $2, $3::jsonb, $3) returning id`,
    [hash(m), Buffer.byteLength(doc), doc],
  );
  return r.rows[0].id as string;
}

const compilar = async (artifactId: string) => {
  const r = await query("select public.fn_modulo_dados_compilar($1) resultado", [artifactId]);
  return r.rows[0].resultado;
};

/** `relname` da tabela que o compilador deve ter criado para o objeto dado. */
const tabela = "m_clinica_odontograma_marcacao";

async function limpar() {
  await query(`do $$ declare t record; begin
    for t in select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'm\\_clinica\\_%'
    loop execute format('drop table if exists public.%I cascade', t.relname); end loop; end $$;`);
  await query("delete from public.extension_artifacts where manifest->>'publisher' = 'clinica'");
}

beforeAll(async () => {
  for (const [id, slug] of [[orgA, "modulo-dados-a"], [orgB, "modulo-dados-b"]]) {
    await query(
      `insert into organizations(id, slug, legal_name, display_name)
       values ($1, $2, 'Módulo de dados', 'Módulo de dados') on conflict(id) do nothing`,
      [id, slug],
    );
  }
});
beforeEach(limpar);
afterAll(async () => {
  await limpar();
  await pool.end();
});

describe("módulo de dados: o banco compila o que o artefato declara", () => {
  it("cria a tabela do objeto com o nome prefixado, isolada por organização e fechada ao navegador", async () => {
    await compilar(await artefato());

    const existe = (await query("select to_regclass($1) reg", [`public.${tabela}`])).rows[0].reg;
    expect(existe).toBe(tabela);

    // Tabela de organização: a coluna existe, é obrigatória e aponta para organizations.
    const org = (await query(
      `select a.attnotnull, exists(
         select 1 from pg_constraint k where k.conrelid = a.attrelid and k.contype = 'f'
           and a.attnum = any(k.conkey) and k.confrelid = 'public.organizations'::regclass
       ) tem_fk
       from pg_attribute a where a.attrelid = $1::regclass and a.attname = 'organization_id'`,
      [`public.${tabela}`],
    )).rows[0];
    expect(org).toMatchObject({ attnotnull: true, tem_fk: true });

    // RLS ligada e nenhum GRANT para os papéis do navegador: toda mutação passa pela rota auditada.
    const rls = (await query("select relrowsecurity from pg_class where oid = $1::regclass", [`public.${tabela}`])).rows[0];
    expect(rls.relrowsecurity).toBe(true);

    const grants = await query(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated')`,
      [tabela],
    );
    expect(grants.rows).toEqual([]);
  });

  it("cada campo declarado vira coluna com o tipo do vocabulário, e `obrigatorio` vira not null", async () => {
    await compilar(await artefato());

    const colunas = await query(
      `select a.attname, format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull
         from pg_attribute a
        where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
        order by a.attnum`,
      [`public.${tabela}`],
    );
    const porNome = Object.fromEntries(colunas.rows.map((c) => [c.attname, c]));

    expect(porNome.dente).toMatchObject({ tipo: "integer", attnotnull: true });
    expect(porNome.condicao).toMatchObject({ tipo: "text", attnotnull: true });
    expect(porNome.feito_em).toMatchObject({ tipo: "date", attnotnull: false });

    // Dinheiro segue a régua do projeto: inteiro de centavos + moeda ISO-4217, nunca `numeric` solto.
    expect(porNome.valor_cents).toMatchObject({ tipo: "bigint", attnotnull: false });
    expect(porNome.valor_moeda).toMatchObject({ tipo: "text" });

    // E o campo não declarado não aparece: o vocabulário é fechado, não um passe livre.
    expect(porNome.laudo).toBeUndefined();
  });

  it("a referência ao contato é COMPOSTA por organização: contato de outro tenant é recusado", async () => {
    // Por que composta: a checagem de chave estrangeira NÃO passa por RLS. Uma FK simples para
    // `contacts(id)` aceitaria o id de um contato de outra organização, e o módulo viraria uma ponte
    // entre tenants — vazamento sem nenhuma consulta maliciosa, só apontando para o id certo.
    await compilar(await artefato());

    const contatoA = (await query(
      "insert into public.contacts(organization_id, name) values ($1, 'Paciente A') returning id",
      [orgA],
    )).rows[0].id;

    // Mesma organização: passa.
    await query(
      `insert into public.${tabela}(organization_id, paciente_id, dente, condicao) values ($1, $2, 11, 'higido')`,
      [orgA, contatoA],
    );

    // Organização diferente, apontando para o contato da primeira: a chave composta recusa.
    await expect(
      query(
        `insert into public.${tabela}(organization_id, paciente_id, dente, condicao) values ($1, $2, 11, 'higido')`,
        [orgB, contatoA],
      ),
    ).rejects.toThrow(/violates foreign key constraint/);
  });
});
