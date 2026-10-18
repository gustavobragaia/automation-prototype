-- Por que cada pedido ficou sem rastreio, dia a dia.
--
-- `pedidos.revisao_motivo` guarda o motivo ATUAL e é sobrescrito a cada
-- rodada. Isso responde "o que está pendente agora", mas não responde
-- "por que o pedido do dia 18 ficou sem rastreio" — e essa é a pergunta
-- que aparece semanas depois, quando o cliente final reclama.
--
-- Então o motivo também vira registro append-only, uma linha por rodada.
-- Um mesmo pedido pode aparecer várias vezes com motivos diferentes:
-- "ainda sem rastreio" na segunda, "não achado na conta" na quarta. A
-- sequência é a história, e é ela que mostra padrão.

CREATE TABLE pedido_motivos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       TEXT,                  -- pedido na Shopee, quando foi achado
  pedido_shopify TEXT NOT NULL,         -- sempre existe: vem da planilha
  conta          INTEGER,
  rodada_id      INTEGER REFERENCES rodadas (id),
  motivo         TEXT NOT NULL,         -- código: 'sem-rastreio-ainda', ...
  grupo          TEXT NOT NULL,         -- 'precisa' | 'sozinho'
  detalhe        TEXT,                  -- JSON: sugestões de conta, candidatos
  em             TEXT NOT NULL
);

-- "o que está pendente hoje, agrupado" — a tela da etapa 3
CREATE INDEX idx_motivos_rodada ON pedido_motivos (rodada_id, grupo);
-- "o que aconteceu com ESTE pedido ao longo dos dias" — a pergunta tardia
CREATE INDEX idx_motivos_pedido ON pedido_motivos (pedido_shopify, em);
-- "essa conta vive dando problema?" — padrão por conta
CREATE INDEX idx_motivos_conta  ON pedido_motivos (conta, motivo);

-- O grupo também no pedido, para a fila não precisar de JOIN só para saber
-- se aquilo exige alguém. Aditivo: coluna nova com default, código antigo
-- no ar continua funcionando (DECISOES.md §1).
ALTER TABLE pedidos ADD COLUMN revisao_grupo TEXT;
