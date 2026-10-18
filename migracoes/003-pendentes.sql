-- Pedidos que atravessam o dia.
--
-- O trabalho da rodada vem da planilha que o cliente sobe, e ele manda só os
-- pedidos pagos DAQUELE dia. Um pedido do dia 18 que não recebeu rastreio não
-- aparece na planilha do dia 19 — e sem esta tabela ele simplesmente some.
-- Não é caso raro: "a Shopee ainda não despachou" é o motivo mais comum, e
-- ele SEMPRE atravessa pelo menos um dia.
--
-- Guarda a linha da planilha junto, porque a conciliação precisa de nome e
-- valor, e eles não existem em nenhum outro lugar depois que a planilha sai.

CREATE TABLE pendentes (
  pedido_shopify  TEXT PRIMARY KEY,
  conta           INTEGER,
  nome            TEXT,
  valor           REAL,
  produto         TEXT,
  unidades        INTEGER,
  motivo          TEXT,                  -- o último motivo conhecido
  grupo           TEXT,                  -- 'precisa' | 'sozinho'
  visto_em        TEXT NOT NULL,         -- primeira vez que penou
  ultima_em       TEXT NOT NULL,         -- última rodada em que apareceu
  dias            INTEGER NOT NULL DEFAULT 1,
  adiado_ate      TEXT,                  -- "deixar para amanhã" explícito
  baixado_em      TEXT                   -- resolvido: sai da carteira
);

-- "o que entra na rodada de hoje além da planilha"
CREATE INDEX idx_pendentes_abertos ON pendentes (baixado_em, adiado_ate);
-- "o que está penando há tempo demais"
CREATE INDEX idx_pendentes_dias ON pendentes (dias DESC) WHERE baixado_em IS NULL;
