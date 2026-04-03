#!/usr/bin/env tsx
// scripts/import-fatura.ts
// Importa um JSON de lançamentos (gerado pelo parse-fatura-txt.ts ou extract-fatura.ts) para o banco.
// Faz deduplicação automática e reutiliza seriesId de parcelamentos já existentes.
//
// Uso:
//   tsx scripts/import-fatura.ts scripts/import/fatura-2026-04.json
//   tsx scripts/import-fatura.ts scripts/import/fatura-2026-04.json --dry-run
//   make import-fatura FILE=scripts/import/fatura-2026-04.json
//
// Variáveis de ambiente necessárias (.env):
//   SEED_USER_ID    — ID do usuário no banco
//   SEED_CARTAO_ID  — UUID do cartão Ourocard
//   SEED_PAGADOR_ID — UUID do pagador admin

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { lancamentos } from "../db/schema";

config();

// ─────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────

const USER_ID = process.env.SEED_USER_ID;
const CARTAO_ID = process.env.SEED_CARTAO_ID;
const PAGADOR_ID = process.env.SEED_PAGADOR_ID;

if (!USER_ID || !CARTAO_ID || !PAGADOR_ID) {
  console.error(
    "Erro: defina SEED_USER_ID, SEED_CARTAO_ID e SEED_PAGADOR_ID no .env",
  );
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Uso: tsx scripts/import-fatura.ts <caminho-do-json> [--dry-run]");
  process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");

// ─────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────

type LancamentoInput = {
  name: string;
  amount: number;
  purchaseDate: string;   // YYYY-MM-DD
  period: string;         // YYYY-MM
  condition: "À vista" | "Parcelado";
  currentInstallment: number | null;
  installmentCount: number | null;
  paymentMethod: string;
  transactionType: string;
  isSettled: boolean;
  categoriaSugerida?: string;
};

// ─────────────────────────────────────────────────────────
// Deduplicação — snapshot pré-importação
// ─────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

/**
 * Carrega do banco, UMA VEZ, todos os lançamentos do cartão do período
 * (mais parcelados de qualquer período) para usar como referência de dedup.
 *
 * Por que snapshot e não query por item?
 * Se consultarmos o banco a cada item, a primeira de duas transações
 * idênticas legítimas (ex.: mesma loja, mesmo valor, mesmo dia) será
 * inserida e a segunda será INCORRETAMENTE ignorada na próxima checagem.
 * Com snapshot pré-importação isso não acontece: apenas registros que
 * já existiam ANTES desta execução bloqueiam a inserção.
 */
type SeriesMeta = {
  seriesId: string;
  pagadorId: string | null;
  categoriaId: string | null;
  note: string | null;
};

async function buildExistingSnapshot(period: string): Promise<{
  avista: Set<string>;
  parcelado: Set<string>;
  seriesMap: Map<string, SeriesMeta>;
}> {
  const rows = await db
    .select({
      name: lancamentos.name,
      purchaseDate: lancamentos.purchaseDate,
      amount: lancamentos.amount,
      period: lancamentos.period,
      condition: lancamentos.condition,
      currentInstallment: lancamentos.currentInstallment,
      installmentCount: lancamentos.installmentCount,
      seriesId: lancamentos.seriesId,
      pagadorId: lancamentos.pagadorId,
      categoriaId: lancamentos.categoriaId,
      note: lancamentos.note,
    })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.cartaoId, CARTAO_ID!),
        eq(lancamentos.userId, USER_ID!),
      ),
    );

  const avista = new Set<string>();
  const parcelado = new Set<string>();
  const seriesMap = new Map<string, SeriesMeta>();

  for (const row of rows) {
    const dateStr =
      row.purchaseDate instanceof Date
        ? row.purchaseDate.toISOString().slice(0, 10)
        : String(row.purchaseDate).slice(0, 10);

    if (row.condition === "Parcelado" && row.currentInstallment !== null) {
      parcelado.add(
        `${row.name}|${dateStr}|${row.installmentCount}|${row.currentInstallment}`,
      );
      if (row.seriesId) {
        const key = `${row.name}|${dateStr}|${row.installmentCount}`;
        const existing = seriesMap.get(key);
        const hasMeta = row.pagadorId || row.categoriaId || row.note;
        if (!existing || hasMeta) {
          seriesMap.set(key, {
            seriesId: row.seriesId,
            pagadorId: row.pagadorId ?? null,
            categoriaId: row.categoriaId ?? null,
            note: row.note ?? null,
          });
        }
      }
    } else {
      const amt = Number(row.amount).toFixed(2);
      avista.add(`${row.name}|${dateStr}|${amt}|${row.period}`);
    }
  }

  return { avista, parcelado, seriesMap };
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────

async function main() {
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as {
    fatura: {
      period: string;
      vencimento: string;
      total: number;
      nomeCartao: string;
    };
    lancamentos: LancamentoInput[];
  };

  const itens = raw.lancamentos;
  const period = raw.fatura.period;

  console.log(`\nFatura: ${raw.fatura.nomeCartao} — período ${period}`);
  console.log(`Lançamentos no arquivo: ${itens.length}`);
  if (isDryRun) console.log("(MODO DRY-RUN — nada será inserido)\n");

  // Snapshot pré-importação: evita que a inserção de um item faça o próximo
  // idêntico ser tratado como duplicata (ex.: mesma loja, valor e dia duas vezes)
  console.log("Carregando snapshot do banco...");
  const snapshot = await buildExistingSnapshot(period);
  console.log(
    `  ${snapshot.avista.size} à vista + ${snapshot.parcelado.size} parcelados existentes\n`,
  );

  let inseridos = 0;
  let ignorados = 0;
  let totalDespesasInseridas = 0;

  const seriesCache = new Map<string, SeriesMeta>(snapshot.seriesMap);

  for (const item of itens) {
    const parcInfo =
      item.condition === "Parcelado"
        ? ` [${item.currentInstallment}/${item.installmentCount}]`
        : "";
    const label =
      `[${item.transactionType}] ${item.purchaseDate}` +
      `  R$ ${item.amount.toFixed(2).padStart(9)}${parcInfo}  ${item.name}`;

    // ── Deduplicação via snapshot ─────────────────────────
    let jaExiste: boolean;
    if (item.condition === "Parcelado" && item.currentInstallment !== null) {
      jaExiste = snapshot.parcelado.has(
        `${item.name}|${item.purchaseDate}|${item.installmentCount}|${item.currentInstallment}`,
      );
    } else {
      jaExiste = snapshot.avista.has(
        `${item.name}|${item.purchaseDate}|${item.amount.toFixed(2)}|${item.period}`,
      );
    }

    if (jaExiste) {
      console.log(`  SKIP   ${label}`);
      ignorados++;
      continue;
    }

    // ── seriesId + metadados herdados da série ────────────
    let seriesId: string | null = null;
    let pagadorId: string | null = PAGADOR_ID!;
    let categoriaId: string | null = null;
    let note: string | null = item.categoriaSugerida ? `[IA] ${item.categoriaSugerida}` : null;

    if (item.condition === "Parcelado") {
      const seriesKey = `${item.name}|${item.purchaseDate}|${item.installmentCount}`;
      if (!seriesCache.has(seriesKey)) {
        seriesCache.set(seriesKey, { seriesId: randomUUID(), pagadorId: null, categoriaId: null, note: null });
      }
      const meta = seriesCache.get(seriesKey)!;
      seriesId = meta.seriesId;
      if (meta.pagadorId) pagadorId = meta.pagadorId;
      if (meta.categoriaId) categoriaId = meta.categoriaId;
      if (meta.note) note = meta.note;
    }

    // ── Inserção ──────────────────────────────────────────
    const registro = {
      userId: USER_ID!,
      cartaoId: CARTAO_ID!,
      pagadorId,
      categoriaId,
      name: item.name,
      amount: item.amount.toFixed(2),
      purchaseDate: new Date(item.purchaseDate + "T12:00:00"),
      period: item.period,
      condition: item.condition,
      currentInstallment: item.currentInstallment,
      installmentCount: item.installmentCount,
      paymentMethod: item.paymentMethod,
      transactionType: item.transactionType,
      isSettled: item.isSettled,
      seriesId,
      note,
    };

    console.log(`  INSERT ${label}`);

    if (!isDryRun) {
      await db.insert(lancamentos).values(registro);
    }

    if (item.transactionType?.toLowerCase() === "despesa") {
      totalDespesasInseridas += item.amount;
    }
    inseridos++;
  }

  // ── Resumo ────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Inseridos: ${inseridos}   Ignorados (já existiam): ${ignorados}`);
  if (isDryRun) {
    console.log("(Dry-run: nenhuma linha foi gravada no banco)");
  } else {
    console.log(
      `Total despesas inseridas: R$ ${totalDespesasInseridas.toFixed(2)}  |  Total da fatura: R$ ${raw.fatura.total.toFixed(2)}`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
