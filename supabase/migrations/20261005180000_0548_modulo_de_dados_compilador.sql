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

  for v_objeto in select value from jsonb_array_elements(v_manifest -> 'data' -> 'objetos') loop
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


-- ── A PORTA: o perfil `data` instala pelo caminho das extensões ─────────────────────────────────
--
-- A instalação de um módulo de dados NÃO ganha rota nova. Ela usa a das extensões, que já traz
-- catálogo admitido, download com guarda de SSRF, autoridade de administrador da instalação (escopo
-- `full`, fora de sessão de suporte, com verificação em duas etapas quando a política exige), recibo
-- durável idempotente, precondição por revisão e tela em `/admin/extensoes`. O que muda é o EFEITO da
-- conclusão: quando o perfil é `data`, as tabelas declaradas nascem na MESMA transação do recibo.
--
-- Mesma transação é a decisão, não detalhe: um recibo `completed` com as tabelas faltando deixaria a
-- tela anunciando um módulo que não guarda nada, e a repetição idempotente não reaplicaria.
--
-- Duas mudanças de vocabulário, as duas no mesmo espírito de lista fechada:
--
-- 1. A concessão `dados.proprios`. O pacote de dados não pede porta de navegação, e a validação exigia
--    de 1 a 7 permissões — array vazio era recusado. Em vez de dar ao módulo uma porta que ele não
--    usa, ele declara a concessão que de fato exerce, e ela aparece na tela de consentimento como as
--    outras. O teto sobe para 8 porque o vocabulário tem 8 valores.
-- 2. Os objetos declarados moram na chave `data`, que o manifesto JÁ reservava para o modo de dados
--    (`{"mode":"none"}` no perfil declarativo). Nenhuma 14ª chave: `data` passa a aceitar
--    `{"mode":"declarado", "objetos":[…]}`, e o perfil declarativo continua exigindo exatamente
--    `{"mode":"none"}` — quem não declara dados não ganha nenhuma folga nova.

create or replace function public.fn_extensions_permissoes_validas(p_permissions jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_permissions is not null
    and jsonb_typeof(p_permissions) = 'array'
    and jsonb_array_length(p_permissions) between 1 and 8
    and not exists (
      select 1 from jsonb_array_elements(p_permissions) e
      where jsonb_typeof(e.value) <> 'string'
         or e.value #>> '{}' not in (
              'navigation.tasks', 'navigation.inbox', 'navigation.kanban',
              'navigation.contacts', 'navigation.agenda', 'navigation.radar',
              'theme.apply', 'dados.proprios')
    )
    and (select count(distinct e.value) from jsonb_array_elements(p_permissions) e)
        = jsonb_array_length(p_permissions);
$$;

revoke execute on function public.fn_extensions_permissoes_validas(jsonb) from public, anon;
revoke execute on function public.fn_extensions_permissoes_validas(jsonb) from authenticated;
grant execute on function public.fn_extensions_permissoes_validas(jsonb) to service_role;


-- A conclusão da instalação passa a compilar quando o perfil é `data`. `create or replace` da função
-- inteira, mesma assinatura e o mesmo par `revoke`/`grant` (repetidos abaixo porque a doutrina pede as
-- duas origens em toda função de `public`).
--
-- ⚠️ CONFLITO ESPERADO com o PR #2116, que conserta OUTRO trecho desta mesma função (a conferência do
-- pacote contra a entrada do catálogo, que hoje recusa toda entrada do catálogo oficial). Os dois
-- mexem em `fn_extensions_finish_install`, e o git não tem como juntar duas reescritas da mesma
-- função. Quando um dos dois entrar, o outro resolve o conflito mantendo AS DUAS mudanças: a
-- projeção das sete chaves (do #2116) e o perfil `data` (deste PR). Elas são independentes e tocam
-- pontos distintos do corpo.

create or replace function public.fn_extensions_finish_install(p_actor uuid, p_operation uuid, p_manifest jsonb, p_sha256 text, p_byte_length integer, p_document text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_op public.extension_operations; v_catalog public.extension_catalogs;
  v_artifact public.extension_artifacts; v_install public.extension_installations; v_current public.extension_artifacts;
  v_previous public.extension_artifacts; v_document_json jsonb; v_active integer := 0;
begin
  perform public.fn_extensions_assert_actor(p_actor);
  perform pg_advisory_xact_lock(255,1);
  perform public.fn_extensions_assert_actor(p_actor);
  select * into v_op from public.extension_operations where id=p_operation for update;
  if not found then raise exception using errcode='P0001',message='extension_operation_not_found'; end if;
  if v_op.kind not in ('install','update') or v_op.actor_id is distinct from p_actor then
    raise exception using errcode='P0001',message='extension_operation_conflict';
  end if;
  -- Sem autoridade após cancel/fail. Resposta perdida de completed segue verificando payload.
  if v_op.status in ('cancelled','failed') then return to_jsonb(v_op) || jsonb_build_object('applied_now', false); end if;
  if p_document is null or octet_length(p_document) not between 1 and 65536
    or octet_length(p_document) is distinct from p_byte_length
    or encode(sha256(convert_to(p_document,'UTF8')),'hex') is distinct from p_sha256 then
    raise exception using errcode='P0001',message='extension_artifact_mismatch';
  end if;
  begin
    v_document_json := p_document::jsonb;
  exception when invalid_text_representation or untranslatable_character or program_limit_exceeded then
    raise exception using errcode='P0001',message='extension_artifact_mismatch';
  end;
  if v_document_json is distinct from p_manifest then
    raise exception using errcode='P0001',message='extension_artifact_mismatch';
  end if;
  if p_sha256 is distinct from v_op.entry->>'sha256' or p_byte_length is distinct from (v_op.entry->>'byte_length')::integer
    or p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
    or not (p_manifest ?& array['format_version','profile','publisher','name','version','license','host_api','permissions','dependencies','data','display','configuration','contributions'])
    or p_manifest - array['format_version','profile','publisher','name','version','license','host_api','permissions','dependencies','data','display','configuration','contributions'] <> '{}'::jsonb
    or exists (select 1 from jsonb_each(p_manifest) e where e.value='null'::jsonb)
    or p_manifest->'format_version' is distinct from '1'::jsonb
    -- 0548: dois perfis. `declarative` segue exatamente como era; `data` declara objetos na chave
    -- `data`, que o manifesto já reservava para o modo de dados.
    or p_manifest->>'profile' not in ('declarative','data')
    or jsonb_typeof(p_manifest->'configuration') is distinct from 'object'
    or jsonb_typeof(p_manifest->'contributions') is distinct from 'object'
    or p_manifest->>'publisher' is distinct from v_op.publisher or p_manifest->>'name' is distinct from v_op.name
    or p_manifest->>'version' is distinct from v_op.version
    or p_manifest->'dependencies' <> '[]'::jsonb
    -- Quem NÃO declara dados não ganha folga nenhuma: continua exigido `{"mode":"none"}` exato.
    or (p_manifest->>'profile' = 'declarative' and p_manifest->'data' <> '{"mode":"none"}'::jsonb)
    -- Quem declara: `mode` fixo e uma lista de objetos não vazia. O conteúdo de cada objeto é
    -- conferido pelo compilador, que é quem sabe o vocabulário de tipos.
    or (p_manifest->>'profile' = 'data' and (
         p_manifest->'data'->>'mode' is distinct from 'declarado'
         or jsonb_typeof(p_manifest->'data'->'objetos') is distinct from 'array'
         or jsonb_array_length(p_manifest->'data'->'objetos') < 1))
    or (p_manifest - array['format_version','profile','dependencies','data','configuration','contributions'])
      is distinct from (v_op.entry - array['sha256','byte_length']) then
    raise exception using errcode='P0001',message='extension_artifact_mismatch';
  end if;
  if v_op.status='completed' then
    -- Compara com o artefato que ESTA conclusão publicou, não com o ponteiro de agora: um
    -- "desfazer" posterior não pode fazer a repetição acusar pacote adulterado.
    select * into v_artifact from public.extension_artifacts
      where id=coalesce(v_op.result->>'to_artifact_id', v_op.result->'installation'->>'artifact_id')::uuid;
    if not found or v_artifact.manifest is distinct from p_manifest or v_artifact.document is distinct from p_document then
      raise exception using errcode='P0001',message='extension_artifact_mismatch';
    end if;
    return to_jsonb(v_op) || jsonb_build_object('applied_now', false);
  end if;
  if public.fn_extensions_core_update_in_progress() then
    raise exception using errcode='P0001',message='extension_core_update_in_progress';
  end if;
  select * into v_catalog from public.extension_catalogs where id=v_op.catalog_id;
  if v_catalog.revision is distinct from v_op.admission_revision or v_catalog.digest is distinct from v_op.admission_digest then
    raise exception using errcode='P0001',message='extension_catalog_stale';
  end if;
  select * into v_install from public.extension_installations
    where catalog_id=v_op.catalog_id and publisher=v_op.publisher and name=v_op.name for update;
  -- Defesa estrutural: a linha tem de estar na revisão que a preparação viu.
  if v_install.revision is distinct from (v_op.result->>'from_revision')::integer
    or (v_op.kind='update' and v_install.removed_at is not null)
    or (v_op.kind='install' and v_install.id is not null and v_install.removed_at is null) then
    raise exception using errcode='P0001',message='extension_version_changed';
  end if;
  if v_install.id is not null then
    select * into v_current from public.extension_artifacts where id=v_install.artifact_id;
    -- A recusa que a spec v1 prometeu para "quando o contrato admitir outra permissão".
    -- Sem ela, 1.0 -> 1.1 acrescentaria uma porta sem ninguém na organização rever a lista
    -- que a tela existe para mostrar: o furo entra pela porta lateral da própria propriedade
    -- que a lista de permissões garante. Mudar o conjunto de portas é outra extensão.
    if v_op.kind='update' and v_current.id is not null
      and v_current.manifest->'permissions' is distinct from p_manifest->'permissions' then
      raise exception using errcode='P0001',message='extension_permissions_changed';
    end if;
    select * into v_previous from public.extension_artifacts where id=v_install.previous_artifact_id;
    if (v_install.version = v_op.version and v_current.sha256 <> p_sha256)
      or (v_previous.id is not null and v_previous.manifest->>'version' = v_op.version and v_previous.sha256 <> p_sha256) then
      raise exception using errcode='P0001',message='extension_version_conflict';
    end if;
  end if;
  select * into v_artifact from public.extension_artifacts where sha256=p_sha256;
  if found then
    if v_artifact.manifest is distinct from p_manifest or v_artifact.document is distinct from p_document or v_artifact.byte_length <> p_byte_length then
      raise exception using errcode='P0001',message='extension_artifact_mismatch';
    end if;
  else
    insert into public.extension_artifacts(sha256,byte_length,manifest,document) values(p_sha256,p_byte_length,p_manifest,p_document) returning * into v_artifact;
  end if;
  if v_install.id is null then
    insert into public.extension_installations(catalog_id,artifact_id,publisher,name,version,installed_by)
      values(v_op.catalog_id,v_artifact.id,v_op.publisher,v_op.name,v_op.version,p_actor) returning * into v_install;
  elsif v_op.kind='install' then
    -- Reinstalação de uma linha removida: os vínculos NÃO voltam ativos; cada organização decide.
    update public.extension_installations set artifact_id=v_artifact.id, version=v_op.version, previous_artifact_id=null,
      removed_at=null, removed_by=null, installed_by=p_actor, installed_at=now(), revision=revision+1
      where id=v_install.id returning * into v_install;
  else
    update public.extension_installations set previous_artifact_id=artifact_id, artifact_id=v_artifact.id,
      version=v_op.version, revision=revision+1 where id=v_install.id returning * into v_install;
    select count(*)::integer into v_active from public.organization_extensions where installation_id=v_install.id and enabled;
  end if;
  -- 0548 — O EFEITO do perfil `data`, na MESMA transação do recibo: as tabelas declaradas nascem
  -- aqui. Um recibo `completed` com as tabelas faltando deixaria a tela anunciando um módulo que não
  -- guarda nada, e a repetição idempotente não reaplicaria. O compilador recebe o id do artefato que
  -- ESTA conclusão publicou — nunca DDL, nunca nome de tabela de quem chama.
  if p_manifest->>'profile' = 'data' then
    perform public.fn_modulo_dados_compilar(v_artifact.id);
  end if;
  update public.extension_operations set status='completed',installation_id=v_install.id,
    result=coalesce(v_op.result,'{}'::jsonb) || jsonb_build_object('installation',to_jsonb(v_install),
      'to_artifact_id',v_artifact.id,'to_version',v_op.version,'organizations_active',v_active),
    updated_at=now() where id=p_operation returning * into v_op;
  return to_jsonb(v_op) || jsonb_build_object('applied_now', true);
end $$;

revoke execute on function public.fn_extensions_finish_install(uuid, uuid, jsonb, text, integer, text) from public, anon;
revoke execute on function public.fn_extensions_finish_install(uuid, uuid, jsonb, text, integer, text) from authenticated;
grant execute on function public.fn_extensions_finish_install(uuid, uuid, jsonb, text, integer, text) to service_role;
