// Campos que o usuário pode escolher para o cartão (Editar funil → Cartão) e
// para as colunas da visão em lista: do negócio, do contato, da organização
// e os personalizados de cada um.
import { useEffect, useMemo, useState } from "react";
import { call } from "../../rpc/client";
import type { CustomField } from "../../db/customFields";
import type { Pipeline } from "../../db/pipelines";
import { builtinsFor, CUSTOM_PREFIX } from "../../lib/cardFields";

const KIND = { comercial: "deal", operacional: "ticket", projeto: "project" } as const;

export interface FieldOption {
  key: string;
  label: string;
  group: string;
}

export function useCardFieldOptions(pipeline: Pipeline): FieldOption[] {
  const [custom, setCustom] = useState<{ deal: CustomField[]; person: CustomField[]; organization: CustomField[] }>({ deal: [], person: [], organization: [] });

  useEffect(() => {
    void Promise.all([
      call("customFields.list", { entity: KIND[pipeline.type], pipelineId: pipeline.id }),
      call("customFields.list", { entity: "person" }),
      call("customFields.list", { entity: "organization" }),
    ]).then(([deal, person, organization]) => setCustom({ deal, person, organization }));
  }, [pipeline]);

  return useMemo(
    () => [
      ...builtinsFor(pipeline.type).map((f) => ({ key: f.key, label: f.label, group: f.group })),
      ...custom.deal.map((f) => ({ key: `${CUSTOM_PREFIX.deal}${f.id}`, label: f.name, group: "Campos personalizados do cartão" })),
      ...custom.person.map((f) => ({ key: `${CUSTOM_PREFIX.person}${f.id}`, label: f.name, group: "Campos personalizados do contato" })),
      ...custom.organization.map((f) => ({ key: `${CUSTOM_PREFIX.organization}${f.id}`, label: f.name, group: "Campos personalizados da organização" })),
    ],
    [pipeline.type, custom],
  );
}
