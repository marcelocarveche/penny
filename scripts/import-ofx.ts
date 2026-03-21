#!/usr/bin/env tsx
// scripts/import-ofx.ts
// Lê um arquivo OFX (BB / bancos brasileiros) e importa os lançamentos no banco.
//
// Uso:
//   tsx scripts/import-ofx.ts scripts/import/fatura.ofx
//
// Variáveis de ambiente necessárias (.env):
//   SEED_USER_ID   — ID do usuário no banco
//   SEED_PAGADOR_ID — UUID do pagador admin
//   SEED_CARTAO_ID — UUID do cartão (para OFX de fatura de cartão de crédito)
//   SEED_CONTA_ID  — UUID da conta  (para OFX de extrato bancário)
//
// O script detecta automaticamente se é fatura de cartão (CCSTMTRS)
// ou extrato de conta (STMTRS) e usa o ID correto.
//
// Período de faturamento:
//   O período (YYYY-MM) é detectado automaticamente pelo campo DTEND do OFX.
//   Todas as transações à vista e parcelas atuais são atribuídas a esse período,
//   garantindo que o total importado bata com o total da fatura.
//   Parcelas anteriores são atribuídas retroativamente aos meses corretos.
//
// Filtros automáticos (não importados):
//   - Pagamentos de fatura anterior (PGTO. CASH, etc.)
//   - Encargos

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { lancamentos } from "../db/schema";

config();

// ─── Configuração ─────────────────────────────────────────────────────────────

const USER_ID = process.env.SEED_USER_ID;
const CARTAO_ID = process.env.SEED_CARTAO_ID ?? null;
const CONTA_ID = process.env.SEED_CONTA_ID ?? null;
const PAGADOR_ID = process.env.SEED_PAGADOR_ID ?? null;

if (!USER_ID) {
  console.error("Erro: defina SEED_USER_ID no .env");
  process.exit(1);
}
if (!PAGADOR_ID) {
  console.error("Erro: defina SEED_PAGADOR_ID no .env");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Uso: tsx scripts/import-ofx.ts <arquivo.ofx>");
  process.exit(1);
}

// ─── Parser OFX ───────────────────────────────────────────────────────────────

interface OfxTransaction {
  type: string;   // PAYMENT | CREDIT | DEBIT | CHECK | ...
  date: string;   // YYYYMMDD ou YYYYMMDDHHMMSS
  amount: number;
  fitId: string;
  memo: string;
}

interface OfxDocument {
  accountType: "cartao" | "conta";
  currency: string;
  billingPeriod: string; // YYYY-MM detectado pelo DTEND
  transactions: OfxTransaction[];
}

/** Extrai valor de uma tag OFX: <TAG>valor</TAG> ou <TAG>valor\n */
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([^<\n\r]*)`, "i"));
  return m ? m[1].trim() : "";
}

/** Converte data OFX (YYYYMMDD...) em Date local (meio-dia para evitar virada UTC). */
function parseOfxDate(raw: string): Date {
  const d = raw.replace(/\D/g, "");
  return new Date(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    12,
  );
}

/** Formata Date para "YYYY-MM". */
function toPeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseOfx(raw: string): OfxDocument {
  const isCartao = /<CCSTMTRS/i.test(raw);

  // Detecta o período de faturamento pelo DTEND (data de fechamento da fatura)
  const dtEnd = tag(raw, "DTEND");
  const billingPeriod = dtEnd
    ? toPeriod(parseOfxDate(dtEnd))
    : toPeriod(new Date());

  // Extrai blocos <STMTTRN>...</STMTTRN>
  const blocks = raw.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];

  const transactions: OfxTransaction[] = blocks.map((b) => ({
    type: tag(b, "TRNTYPE").toUpperCase(),
    date: tag(b, "DTPOSTED"),
    amount: parseFloat(tag(b, "TRNAMT") || "0"),
    fitId: tag(b, "FITID"),
    memo: tag(b, "MEMO"),
  }));

  return {
    accountType: isCartao ? "cartao" : "conta",
    currency: tag(raw, "CURDEF") || "BRL",
    billingPeriod,
    transactions,
  };
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

// Apenas pagamentos de fatura anterior e encargos são ignorados.
// IOF e JUROS são cobranças legítimas da fatura e devem ser importados.
const MEMO_FILTER = [
  /^PGTO\./i,     // PGTO. CASH AG. (pagamento de fatura anterior)
  /^ENCARGO/i,    // encargos em geral
];

function shouldSkip(tx: OfxTransaction): boolean {
  return MEMO_FILTER.some((re) => re.test(tx.memo));
}

// ─── Limpeza de nome ──────────────────────────────────────────────────────────

function cleanName(memo: string): string {
  // 1. Remove " PARC XX/YY"
  let name = memo.replace(/\s+PARC\s+\d+\/\d+/i, "").trim();
  // 2. Remove sufixo de cidade/país (2+ espaços consecutivos + restante)
  name = name.split(/\s{2,}/)[0].trim();
  return name || memo.trim();
}

// ─── Parser de parcelamento ───────────────────────────────────────────────────

interface Installment {
  current: number;
  total: number;
}

function parseInstallment(memo: string): Installment | null {
  const m = memo.match(/\bPARC\s+(\d+)\/(\d+)\b/i);
  if (!m) return null;
  return { current: Number(m[1]), total: Number(m[2]) };
}

// ─── Utilitário de data ───────────────────────────────────────────────────────

/** Subtrai N meses de uma Date, respeitando o último dia do mês destino. */
function subtractMonths(date: Date, months: number): Date {
  let m = date.getMonth() - months;
  let y = date.getFullYear();
  while (m < 0) { m += 12; y -= 1; }
  const daysInTarget = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(date.getDate(), daysInTarget), 12);
}

// ─── Mapeamento para o schema ──────────────────────────────────────────────────

/**
 * Retorna um array de registros:
 * - Transações à vista: 1 registro, sempre no billingPeriod
 * - Transações parceladas: parcela atual no billingPeriod + retroativos
 *
 * NOTA: O BB armazena a DATA ORIGINAL DA COMPRA no DTPOSTED de parcelados.
 * Usamos o billingPeriod (DTEND) como período da parcela atual, garantindo
 * que o total importado bata com o total da fatura.
 */
function mapTransaction(
  tx: OfxTransaction,
  userId: string,
  cartaoId: string | null,
  contaId: string | null,
  accountType: "cartao" | "conta",
  billingPeriod: string,
) {
  const purchaseDate = parseOfxDate(tx.date);
  const installment = parseInstallment(tx.memo);

  const isDebit =
    tx.type === "PAYMENT" ||
    tx.type === "DEBIT" ||
    tx.type === "CHECK" ||
    (accountType === "cartao" && tx.amount < 0 && tx.type !== "CREDIT");

  const transactionType: "despesa" | "receita" = isDebit ? "despesa" : "receita";
  const paymentMethod = accountType === "cartao" ? "credito" : "debito";
  const name = cleanName(tx.memo);
  const amount = String(Math.abs(tx.amount).toFixed(2));

  const base = {
    userId,
    pagadorId: PAGADOR_ID,
    cartaoId: accountType === "cartao" ? cartaoId : null,
    contaId: accountType === "conta" ? contaId : null,
    name,
    amount,
    paymentMethod,
    transactionType,
    isSettled: true,
    condition: installment ? ("Parcelado" as const) : ("À vista" as const),
    installmentCount: installment?.total ?? null,
    note: `[OFX] ${tx.fitId}`,
  };

  // À vista: purchaseDate = DTPOSTED, period = billingPeriod
  if (!installment) {
    return [{
      ...base,
      purchaseDate,
      period: billingPeriod,
      currentInstallment: null,
      seriesId: null,
    }];
  }

  // Parcelado: parcela atual no billingPeriod; retroativas nos meses anteriores
  // A data da parcela atual é derivada da data de compra: purchaseDate + (current-1) meses
  const currentBillingDate = (() => {
    const [y, m] = billingPeriod.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, purchaseDate.getDate(), 12);
  })();

  const seriesId = randomUUID();
  const records = [];
  for (let i = 1; i <= installment.current; i++) {
    const monthsBack = installment.current - i;
    const date = subtractMonths(currentBillingDate, monthsBack);
    records.push({
      ...base,
      purchaseDate: date,
      period: toPeriod(date),
      currentInstallment: i,
      seriesId,
    });
  }
  return records;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  // BB exporta em Windows-1252; "latin1" é suficiente para a maioria dos chars
  const raw = readFileSync(filePath, "latin1");
  const doc = parseOfx(raw);

  const tipoLabel = doc.accountType === "cartao"
    ? "Fatura de cartão (CCSTMTRS)"
    : "Extrato bancário (STMTRS)";
  console.log(`Tipo detectado  : ${tipoLabel}`);
  console.log(`Moeda           : ${doc.currency}`);
  console.log(`Período fatura  : ${doc.billingPeriod}`);
  console.log(`Total no OFX    : ${doc.transactions.length} entradas`);

  if (doc.accountType === "cartao" && !CARTAO_ID) {
    console.error("\nErro: OFX é fatura de cartão mas SEED_CARTAO_ID não está definido no .env");
    process.exit(1);
  }
  if (doc.accountType === "conta" && !CONTA_ID) {
    console.error("\nErro: OFX é extrato de conta mas SEED_CONTA_ID não está definido no .env");
    process.exit(1);
  }

  const skipped = doc.transactions.filter(shouldSkip);
  const valid = doc.transactions.filter((tx) => !shouldSkip(tx));

  if (skipped.length > 0) {
    console.log(`\nIgnorados (${skipped.length}):`);
    for (const tx of skipped) {
      console.log(`  [SKIP] ${tx.date.slice(0, 8)}  R$ ${String(Math.abs(tx.amount).toFixed(2)).padStart(10)}  ${tx.memo}`);
    }
  }

  if (valid.length === 0) {
    console.warn("\nNenhuma transação válida encontrada após filtros.");
    process.exit(0);
  }

  const registros = valid.flatMap((tx) =>
    mapTransaction(tx, USER_ID!, CARTAO_ID, CONTA_ID, doc.accountType, doc.billingPeriod),
  );

  // Preview
  console.log(`\nPreview — ${registros.length} lançamentos a importar:`);
  for (const r of registros) {
    const parcInfo = r.condition === "Parcelado"
      ? ` [${r.currentInstallment}/${r.installmentCount}]`
      : "";
    console.log(
      `  [${r.transactionType}] ${r.purchaseDate.toISOString().slice(0, 10)}` +
      `  R$ ${r.amount.padStart(10)}${parcInfo}  ${r.name}`,
    );
  }

  // Totais por período
  const totaisPorPeriodo = new Map<string, number>();
  for (const r of registros) {
    if (r.transactionType === "despesa") {
      totaisPorPeriodo.set(r.period, (totaisPorPeriodo.get(r.period) ?? 0) + parseFloat(r.amount));
    }
  }
  console.log(`\nTotais por período (despesas):`);
  for (const [period, total] of [...totaisPorPeriodo.entries()].sort()) {
    const marker = period === doc.billingPeriod ? " ← fatura atual" : "";
    console.log(`  ${period}  R$ ${total.toFixed(2)}${marker}`);
  }

  console.log(`\nInserindo ${registros.length} lançamentos...`);
  await db.insert(lancamentos).values(registros);

  const despesas = registros.filter((r) => r.transactionType === "despesa").length;
  const receitas = registros.filter((r) => r.transactionType === "receita").length;
  const parcelados = registros.filter((r) => r.condition === "Parcelado").length;
  console.log(
    `OK — ${registros.length} inseridos` +
    ` (${despesas} despesas, ${receitas} receitas, ${parcelados} parceladas — inclui retroativos).`,
  );
  console.log("Lembre-se de revisar e vincular categorias no app.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
