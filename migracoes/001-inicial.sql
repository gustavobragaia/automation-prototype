-- Estado da operação. Substitui estado/pedidos.json e estado/rodadas.json.

CREATE TABLE pedidos (
  order_id           TEXT PRIMARY KEY,   -- id do pedido na Shopee
  conta              INTEGER,            -- número da conta Shopee (shopee NNN)
  nome               TEXT,               -- nome do ENDEREÇO DE ENTREGA
  cep                TEXT,
  endereco           TEXT,
  valor              REAL,
  produto            TEXT,
  loja               TEXT,
  transportadora     TEXT,
  codigos            TEXT NOT NULL DEFAULT '[]',  -- JSON: pode haver 1 por pacote
  despachado         INTEGER NOT NULL DEFAULT 0,
  unidades           INTEGER,
  pedido_shopify     TEXT,
  enviado_shopify    INTEGER NOT NULL DEFAULT 0,
  escrita_simulada   INTEGER NOT NULL DEFAULT 0,
  revisao_motivo     TEXT,               -- NULL = sem pendência
  revisao_em         TEXT,
  dispensado_em      TEXT,
  primeiro_visto_em  TEXT,
  visto_em           TEXT
);

-- A fila pergunta "o que falta escrever?" a cada rodada.
CREATE INDEX idx_pedidos_pendentes ON pedidos (enviado_shopify, despachado);
CREATE INDEX idx_pedidos_revisao   ON pedidos (revisao_motivo) WHERE revisao_motivo IS NOT NULL;
CREATE INDEX idx_pedidos_conta     ON pedidos (conta);

-- Qual conta Shopee pagou qual pedido da Shopify. Nasce da escolha de quem
-- paga; hoje vem da planilha, na v2 virá do app. Existe separado de `pedidos`
-- porque é conhecido ANTES de o pedido ser encontrado na Shopee.
CREATE TABLE mapeamento (
  pedido_shopify  TEXT PRIMARY KEY,
  conta           INTEGER NOT NULL,
  origem          TEXT NOT NULL,         -- 'planilha' | 'app' | 'coleta'
  criado_em       TEXT NOT NULL
);
CREATE INDEX idx_mapeamento_conta ON mapeamento (conta);

-- Registro dos perfis e a saúde de cada conta. É o que transforma 700 contas
-- de uma lista num painel operável.
CREATE TABLE contas (
  conta             INTEGER PRIMARY KEY,
  user_id           TEXT,                -- id do perfil no AdsPower
  serial            INTEGER,
  nome_perfil       TEXT,
  email             TEXT,
  ultima_coleta_ok  TEXT,
  ultima_falha      TEXT,
  ultimo_erro       TEXT,
  falhas_seguidas   INTEGER NOT NULL DEFAULT 0,
  precisa_humano    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rodadas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  inicio          TEXT NOT NULL,
  duracao_ms      INTEGER,
  contas          INTEGER,
  coletadas       INTEGER,
  pedidos_vistos  INTEGER,
  novos           INTEGER,
  escritos        INTEGER,
  revisao         INTEGER,
  falhas          TEXT NOT NULL DEFAULT '[]',   -- JSON
  planilha        TEXT
);
CREATE INDEX idx_rodadas_inicio ON rodadas (inicio DESC);
