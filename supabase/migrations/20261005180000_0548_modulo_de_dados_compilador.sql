-- 0548 — O compilador de módulo de dados: quem escreve o SQL é o BANCO, lendo o artefato admitido.
--
-- Onda 1 da ADR-0005. Um módulo de terceiro declara objetos e campos num artefato JSON; esta função
-- lê esse artefato — a linha de `extension_artifacts`, que é imutável, validada na admissão e
-- auditada — e cria as tabelas correspondentes.
--
-- POR QUE O PARÂMETRO É UM ID, E NÃO DDL. A ADR-0002 D4 sustenta a provisionadora `security definer`
-- em dois pés: ela não tem seletor vindo de quem chama, e o efeito é fixo e conhecido. Passar SQL (ou
-- nome de tabela) por parâmetro derrubaria os dois. Aqui o parâmetro é o id de uma linha JÁ admitida:
-- quem chama não escolhe o efeito, escolhe qual artefato auditado aplicar. Todo identificador que vai
-- para o DDL é construído pela função e escapado com `format(%I)`; nada do JSON entra como texto cru,
-- e o TIPO vem de um vocabulário fechado — tipo desconhecido levanta, nunca vira texto solto.
--
-- O QUE ESTA MIGRATION AINDA NÃO FAZ (a onda 1 não termina aqui, e o PR o declara): a referência
-- composta por organização, o truncamento de nome em 63 bytes, a idempotência da recompilação, a
-- validação completa do artefato no banco, o registro em `modulos_instalados`, a rota e a tela. Cada
-- um entra com o seu próprio teste vermelho antes.

-- ── O alvo da referência precisa de chave composta ──────────────────────────────────────────────
--
-- Uma FK para `contacts(id)` sozinha NÃO isola tenant: a checagem de chave estrangeira não passa por
-- RLS, então o id de um contato de outra organização seria aceito e o módulo viraria ponte entre
-- tenants. A FK composta `(organization_id, <ref>_id) → contacts(organization_id, id)` fecha isso, e
-- exige um índice único sobre essas duas colunas em `contacts`.
--
-- O índice é criado AQUI, no caminho do schema, e NÃO sob demanda na instalação de um módulo:
-- `create unique index` sem `concurrently` toma lock de escrita, e numa VPS com a ingestão de
-- WhatsApp no ar isso pararia o atendimento. O kit já aplica o baseline em janela de atualização.
--
-- A guarda é a mesma do laço da 0418 (alvos `crm_pipelines`, `crm_stages`, `ai_agents`): cria só se
-- NÃO houver índice único sobre exatamente essas duas colunas, senão toda instalação ganharia um
-- segundo índice idêntico, pago em cada escrita de contato.
do $$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class t on t.oid = i.indrelid
     where t.relname = 'contacts'
       and t.relnamespace = 'public'::regnamespace
       and i.indisunique
       and i.indnatts = 2
       and (
         select array_agg(a.attname::text order by k.ord)
           from unnest(i.indkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
       ) = array['organization_id', 'id']
  ) then
    create unique index uq_contacts_org_id on public.contacts (organization_id, id);
  end if;
end $$;

create or replace function public.fn_modulo_dados_compilar(p_artifact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_manifest jsonb;
  v_objeto jsonb;
  v_campo jsonb;
  v_ref jsonb;
  v_tabela text;
  v_nome text;
  v_tipo text;
  v_nulo text;
  v_alvo text;
  v_colunas text;
  v_criadas text[] := '{}';
begin
  select manifest into v_manifest from public.extension_artifacts where id = p_artifact_id;
  if v_manifest is null then
    raise exception using errcode = 'P0001', message = 'modulo_artefato_nao_encontrado';
  end if;

  for v_objeto in select value from jsonb_array_elements(v_manifest -> 'dados' -> 'objetos') loop
    -- O nome é CONSTRUÍDO aqui: prefixo fixo, publicador, módulo e objeto, com `-` virando `_`.
    -- O pacote não escolhe nome de tabela; ele escolhe um slug que entra num molde.
    v_tabela := 'm_'
      || replace(v_manifest ->> 'publisher', '-', '_') || '_'
      || replace(v_manifest ->> 'name', '-', '_') || '_'
      || (v_objeto ->> 'slug');

    v_colunas := '';
    for v_campo in select value from jsonb_array_elements(v_objeto -> 'campos') loop
      v_nome := v_campo ->> 'slug';
      v_tipo := v_campo ->> 'tipo';
      v_nulo := case when coalesce((v_campo ->> 'obrigatorio')::boolean, false) then ' not null' else '' end;

      if v_tipo = 'texto' then
        v_colunas := v_colunas || format(', %I text%s', v_nome, v_nulo);
      elsif v_tipo = 'texto_longo' then
        v_colunas := v_colunas || format(', %I text%s', v_nome, v_nulo);
      elsif v_tipo = 'inteiro' then
        v_colunas := v_colunas || format(', %I integer%s', v_nome, v_nulo);
      elsif v_tipo = 'booleano' then
        v_colunas := v_colunas || format(', %I boolean%s', v_nome, v_nulo);
      elsif v_tipo = 'data' then
        v_colunas := v_colunas || format(', %I date%s', v_nome, v_nulo);
      elsif v_tipo = 'data_hora' then
        v_colunas := v_colunas || format(', %I timestamptz%s', v_nome, v_nulo);
      elsif v_tipo = 'dinheiro' then
        -- A régua de dinheiro do projeto: inteiro de centavos + moeda ISO-4217. `numeric` solto para
        -- dinheiro é o erro que a doutrina já proíbe em toda tabela do núcleo.
        v_colunas := v_colunas || format(
          ', %I bigint%s, %I text not null default ''BRL'' check (char_length(%I) = 3)',
          v_nome || '_cents', v_nulo, v_nome || '_moeda', v_nome || '_moeda');
      else
        -- Vocabulário FECHADO. Um tipo que o host não conhece não vira coluna de palpite: recusa.
        raise exception using errcode = 'P0001', message = 'modulo_tipo_de_campo_desconhecido';
      end if;
    end loop;

    -- As referências a entidades do núcleo. A entidade vem de uma ALLOWLIST: o pacote não aponta
    -- para tabela arbitrária, e entidade que o host não conhece recusa em vez de virar palpite.
    for v_ref in select value from jsonb_array_elements(coalesce(v_objeto -> 'refs', '[]'::jsonb)) loop
      v_nome := (v_ref ->> 'slug') || '_id';
      v_nulo := case when coalesce((v_ref ->> 'obrigatorio')::boolean, false) then ' not null' else '' end;

      if v_ref ->> 'entidade' = 'contato' then
        v_alvo := 'contacts';
      else
        raise exception using errcode = 'P0001', message = 'modulo_entidade_desconhecida';
      end if;

      -- Onda 1a: só `cascata`. `anula` precisa de `on delete set null (coluna)` — anular a FK
      -- composta inteira tentaria anular `organization_id`, que é NOT NULL, e isso explodiria só na
      -- hora de apagar um contato, em produção. Entra com o seu próprio teste.
      if coalesce(v_ref ->> 'ao_apagar', 'cascata') <> 'cascata' then
        raise exception using errcode = 'P0001', message = 'modulo_acao_ao_apagar_nao_suportada';
      end if;

      v_colunas := v_colunas
        || format(', %I uuid%s', v_nome, v_nulo)
        || format(
             ', foreign key (organization_id, %I) references public.%I (organization_id, id) on delete cascade',
             v_nome, v_alvo);
    end loop;

    execute format(
      'create table if not exists public.%I (
         id uuid primary key default gen_random_uuid(),
         organization_id uuid not null references public.organizations(id) on delete cascade%s,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now()
       )', v_tabela, v_colunas);

    -- ⚠️ A ORDEM IMPORTA, e é a da ADR-0005 D3. Toda tabela criada em `public` depois do baseline
    -- nasce com GRANT ALL para `anon` e `authenticated` (o `ALTER DEFAULT PRIVILEGES` do baseline).
    -- A revogação vem ANTES de proteger: a tabela de módulo é server-only, e toda mutação tem de
    -- passar pela rota auditada do host em vez do PostgREST.
    execute format('revoke all on public.%I from anon, authenticated', v_tabela);

    v_criadas := v_criadas || v_tabela;
  end loop;

  -- As proteções que toda tabela de organização precisa ter, na MESMA transação (ADR-0002 D5):
  -- RLS ligada, isolamento por organização e as travas da sessão de suporte.
  perform public.fn_proteger_modulo_provisionado();

  return jsonb_build_object('tabelas', to_jsonb(v_criadas));
end $f$;

-- Função nova em `public` nasce exposta por DUAS origens, e as duas são revogadas: o grant a PUBLIC
-- que o Postgres dá a qualquer função, e o grant a `anon` do `ALTER DEFAULT PRIVILEGES` do baseline.
revoke execute on function public.fn_modulo_dados_compilar(uuid) from public, anon;
revoke execute on function public.fn_modulo_dados_compilar(uuid) from authenticated;
grant execute on function public.fn_modulo_dados_compilar(uuid) to service_role;
