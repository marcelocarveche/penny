#!/usr/bin/env tsx
// scripts/import-fatura.ts
// Importa um JSON de lançamentos (gerado pelo extract-fatura.ts ou manualmente) para o banco.
//
// Uso:
//   tsx scripts/import-fatura.ts scripts/import/fatura-2026-02.json
//   make import-fatura FILE=scripts/import/fatura-2026-02.json
//
// Variáveis de ambiente necessárias (.env):
//   SEED_USER_ID    — ID do usuário no banco
//   SEED_CARTAO_ID  — UUID do cartão Ourocard
//   SEED_PAGADOR_ID — UUID do pagador admin

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { lancamentos } from "../db/schema";

config();

const USER_ID = process.env.SEED_USER_ID;
const CARTAO_ID = process.env.SEED_CARTAO_ID;
const PAGADOR_ID = process.env.SEED_PAGADOR_ID;

if (!USER_ID || !CARTAO_ID || !PAGADOR_ID) {
  console.error("Erro: defina SEED_USER_ID, SEED_CARTAO_ID e SEED_PAGADOR_ID no .env");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Uso: tsx scripts/import-fatura.ts <caminho-do-json>");
  process.exit(1);
}

type Lancamento = {
  name: string;
  amount: number;
  purchaseDate: string;
  period: string;
  condition: "À vista" | "Parcelado";
  currentInstallment: number | null;
  installmentCount: number | null;
  paymentMethod: string;
  transactionType: string;
  isSettled: boolean;
  categoriaSugerida?: string;
};

const raw = JSON.parse(readFileSync(filePath, "utf-8")) as {
  fatura: { period: string; vencimento: string; total: number; nomeCartao: string };
  lancamentos: Lancamento[];
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  const itens = raw.lancamentos;
  console.log(`Fatura:      ${raw.fatura.nomeCartao} — período ${raw.fatura.period}`);
  console.log(`Lançamentos: ${itens.length}`);

  const registros = itens.map((item) => ({
    userId: USER_ID!,
    cartaoId: CARTAO_ID!,
    pagadorId: PAGADOR_ID!,
    name: item.name,
    amount: String(item.amount.toFixed(2)),
    purchaseDate: new Date(item.purchaseDate + "T12:00:00"),
    period: item.period,
    condition: item.condition,
    currentInstallment: item.currentInstallment,
    installmentCount: item.installmentCount,
    paymentMethod: item.paymentMethod,
    transactionType: item.transactionType,
    isSettled: item.isSettled,
    seriesId: item.condition === "Parcelado" ? randomUUID() : null,
    note: item.categoriaSugerida ? `[IA] ${item.categoriaSugerida}` : null,
  }));

  // Preview
  for (const r of registros) {
    const parcInfo = r.condition === "Parcelado"
      ? ` [${r.currentInstallment}/${r.installmentCount}]`
      : "";
    console.log(
      `  [${r.transactionType}] ${r.purchaseDate.toISOString().slice(0, 10)}` +
      `  R$ ${r.amount.padStart(9)}${parcInfo}  ${r.name}`,
    );
  }

  console.log(`\nInserindo ${registros.length} lançamento(s)...`);
  await db.insert(lancamentos).values(registros);

  const despesas = registros.filter((r) => r.transactionType === "despesa").length;
  const receitas = registros.filter((r) => r.transactionType === "receita").length;
  console.log(`OK — ${registros.length} inserido(s) (${despesas} despesas, ${receitas} receitas).`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
