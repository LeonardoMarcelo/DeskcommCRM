"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// `import type`: `PROVEDORES` só é usado em posição de TIPO logo abaixo
// (`typeof PROVEDORES`), e o import de valor arrastava a lista para o bundle do
// cliente sem necessidade.
import type { PROVEDORES } from "@/lib/ai/pontos/provedores";
import { useT } from "@/hooks/i18n/useT";

/**
 * Derivado de `lib/ai/pontos/provedores.ts` — a mesma lista única da tela de
 * Credenciais e da rota. Como literal aqui, o seletor de modelo do agente não
 * conseguia representar um agente publicado em OpenRouter.
 */
export type Provider = (typeof PROVEDORES)[number]["id"];

export interface ModelOption {
  provider: Provider;
  model_id: string;
  display_name: string;
  context_window: number | null;
  is_default_for_provider: boolean;
}

interface Props {
  provider: Provider;
  value: string;
  onChange: (modelId: string, ctx?: { contextWindow: number | null }) => void;
  disabled?: boolean;
  id?: string;
  /**
   * Texto do estado "nada escolhido". Existe porque nem todo uso deste seletor
   * trata vazio como erro: no papel Operador, vazio SIGNIFICA "usa o mesmo
   * modelo que conversa", e chamar isso de "Selecione um modelo" mentiria.
   */
  placeholder?: string;
  /**
   * A âncora de teste, quando quem chama já tinha uma.
   *
   * A tela de Provedores usava `padrao-modelo` e `modelo-<ponto>`, e
   * `tests/e2e/prova-painel-provedores.spec.ts` CLICA nelas — inclusive no caso
   * "F3 — a OpenRouter é oferecida e seus modelos estão no seletor", que conta
   * as opções. Trocar o seletor sem trazer a âncora junto quebraria a prova que
   * justamente descreve o comportamento que este componente entrega.
   */
  testId?: string;
  /**
   * Esconde o rótulo "Modelo". Para quem já desenha o próprio `<Label>` ao lado
   * do seletor de provedor e não quer dois rótulos empilhados.
   */
  semRotulo?: boolean;
}

interface ApiResponse {
  data: { models: ModelOption[] };
}

export function ModelPicker({
  provider,
  value,
  onChange,
  disabled,
  id,
  placeholder,
  testId,
  semRotulo,
}: Props) {
  const t = useT();
  const query = useQuery({
    queryKey: ["ai", "providers", provider, "models"],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(`/api/v1/ai/providers/${provider}/models`);
      return res.data.models;
    },
    staleTime: 60_000,
  });

  const models = query.data ?? [];

  const vazioDeVerdade = models.length === 0 && !query.isLoading;

  return (
    <div className="space-y-1">
      {semRotulo ? null : <Label htmlFor={id}>{t("Modelo")}</Label>}
      {vazioDeVerdade ? (
        <>
          <Input
            id={id}
            data-testid={testId}
            value={value}
            onChange={(e) => onChange(e.target.value, { contextWindow: null })}
            placeholder={t("Digite o identificador do modelo")}
            disabled={disabled}
          />
          {/*
            O CAMPO LIVRE PRECISA DIZER POR QUE É LIVRE.

            Caindo aqui, uma de duas coisas aconteceu: o provedor não publica
            catálogo (Anthropic, OpenAI e Google não publicam — o nosso é curado
            à mão), ou ele publica e a consulta falhou. Nos dois casos a pessoa
            precisa digitar o identificador, e um campo vazio sem explicação
            parece defeito.
          */}
          <p className="text-xs text-muted-foreground">
            {query.isError
              ? t(
                  "Não consegui falar com o provedor para listar os modelos. Digite o identificador como ele o nomeia.",
                )
              : t(
                  "Este provedor não publica a lista de modelos. Digite o identificador como ele o nomeia.",
                )}
          </p>
        </>
      ) : (
        <Select
          value={value || undefined}
          onValueChange={(v) => {
            const m = models.find((m) => m.model_id === v);
            onChange(v, { contextWindow: m?.context_window ?? null });
          }}
          disabled={disabled || query.isLoading}
        >
          <SelectTrigger id={id} data-testid={testId}>
            <SelectValue
              placeholder={
                query.isLoading ? t("Carregando…") : (placeholder ?? t("Selecione um modelo"))
              }
            />
          </SelectTrigger>
          {/*
            TETO DE ALTURA e rolagem: a OpenRouter devolve ~400 modelos (medido
            nesta instalação: 396). Sem o teto, a lista abre maior que a janela e
            o primeiro item fica fora da tela.
          */}
          <SelectContent className="max-h-72">
            {models.map((m) => (
              <SelectItem key={m.model_id} value={m.model_id}>
                {m.display_name}
                {m.is_default_for_provider ? ` · ${t("default")}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function useModelMeta(provider: Provider, modelId: string): ModelOption | null {
  const query = useQuery({
    queryKey: ["ai", "providers", provider, "models"],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(`/api/v1/ai/providers/${provider}/models`);
      return res.data.models;
    },
    staleTime: 60_000,
  });
  return (query.data ?? []).find((m) => m.model_id === modelId) ?? null;
}
