-- Como uma pendência termina.
--
-- Toda pendência precisa de um estado terminal. Sem isso a carteira só
-- cresce: o operador adia, adia, e em duas semanas o alerta de "pena há 6
-- dias" vira ruído e ele para de abrir a tela.
--
-- São quatro saídas, e três delas são decisão humana:
--   resolvido   o robô achou o rastreio e escreveu            (automático)
--   manual      o operador tinha o código e colou             (humano)
--   conta       era outra conta; volta na próxima com a certa (humano)
--   encerrado   não vai receber rastreio: cancelado, reembolso, não comprado

ALTER TABLE pendentes ADD COLUMN desfecho TEXT;      -- resolvido|manual|conta|encerrado
ALTER TABLE pendentes ADD COLUMN desfecho_nota TEXT; -- o porquê, escrito por quem decidiu

CREATE INDEX idx_pendentes_desfecho ON pendentes (desfecho) WHERE desfecho IS NOT NULL;
