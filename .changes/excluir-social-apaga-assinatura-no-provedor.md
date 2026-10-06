---
impacto: nada_mudou
secao: corrigido
titulo: Excluir um canal social pela Central de Conexões agora apaga a assinatura de webhook no provedor
---

Quem excluía um canal de Instagram ou Facebook pela Central de Conexões (em vez da aba Redes sociais) deixava a assinatura de webhook viva no Zernio: como a assinatura é por chave e não por conta, o provedor continuava entregando eventos numa URL que virou 404, sem erro do nosso lado — e se o perfil fosse desvinculado depois, essa assinatura ficava inalcançável. Agora a exclusão apaga a assinatura antes de arquivar ou excluir a linha (pelo id gravado, ou reconciliada pela URL quando o id faltar) e registra o desfecho na auditoria; se o provedor estiver fora do ar, a exclusão segue em best-effort e a falha fica registrada. Nenhuma ação é necessária. Contribuição de @paulolimajr77 (issue #2419).
