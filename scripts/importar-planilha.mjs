// Converte a planilha de controle do cliente em data/pedidos.json.
//
// A planilha contém dados pessoais de clientes finais (nome, valor, rastreio)
// e por isso NUNCA é versionada — veja o .gitignore.
//
//   node scripts/importar-planilha.mjs "~/caminho/PEDIDOS SHOPEE.xlsx"
//
// Requer: python3 com openpyxl  (pip install openpyxl)

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const entrada = process.argv[2];
if (!entrada) {
  console.error('uso: node scripts/importar-planilha.mjs "<caminho do .xlsx>" [aba]');
  process.exit(1);
}
const aba = process.argv[3] ?? "ESPARTA";
const saida = resolve("data/pedidos.json");

const py = `
import openpyxl, json, datetime, sys
def sc(v):
    if v is None: return None
    if isinstance(v,(int,float)): return v
    if isinstance(v,(datetime.datetime,datetime.date,datetime.time)): return v.isoformat()
    return str(v).strip()
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb[sys.argv[2]]
out=[]
for i,r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    if not any(x is not None and str(x).strip()!="" for x in r[:8]): continue
    out.append({"row":i,"data":sc(r[0]),"pedido":sc(r[1]),"nome":sc(r[2]),
                "produto":sc(r[3]),"unidades":sc(r[4]),"valor":sc(r[5]),
                "rastreioRaw":sc(r[6]),"contaRaw":sc(r[7])})
json.dump(out, open(sys.argv[3],"w"), ensure_ascii=False)
print(len(out))
`;

const n = execFileSync("python3", ["-c", py, entrada, aba, saida], { encoding: "utf8" }).trim();
console.log(`${n} linhas gravadas em ${saida}`);
