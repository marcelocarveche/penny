#!/usr/bin/env tsx
// scripts/importar-fatura-txt.ts
// Parse + importação do .txt da fatura SISBB em um único comando.
//
// Uso:
//   pnpm tsx scripts/importar-fatura-txt.ts scripts/import/fevereiro.txt
//   pnpm tsx scripts/importar-fatura-txt.ts scripts/import/fevereiro.txt --dry-run
//
// Variáveis de ambiente necessárias (.env):
//   SEED_USER_ID    — ID do usuário no banco
//   SEED_CARTAO_ID  — UUID do cartão Ourocard
//   SEED_PAGADOR_ID — UUID do pagador admin

import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { lancamentos } from "../db/schema";
import { parse } from "./parse-fatura-txt";

config();

const USER_ID = process.env.SEED_USER_ID;
const CARTAO_ID = process.env.SEED_CARTAO_ID;
const PAGADOR_ID = process.env.SEED_PAGADOR_ID;

if (!USER_ID || !CARTAO_ID || !PAGADOR_ID) {
  console.error(
    "Erro: defina SEED_USER_ID, SEED_CARTAO_ID e SEED_PAGADOR_ID no .env",
  );
  process.exit(1);
}

const txtPath = process.argv[2];
if (!txtPath) {
  console.error(
    "Uso: pnpm tsx scripts/importar-fatura-txt.ts <fatura.txt> [--dry-run]",
  );
  process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

type SeriesMeta = {
  seriesId: string;
  pagadorId: string | null;
  categoriaId: string | null;
  note: string | null;
};

async function buildSnapshot(): Promise<{
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
        // Prioriza a entrada que já tem metadados definidos pelo usuário
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
      avista.add(`${row.name}|${dateStr}|${Number(row.amount).toFixed(2)}|${row.period}`);
    }
  }

  return { avista, parcelado, seriesMap };
}

async function main() {
  // ── Parse ──────────────────────────────────────────────────
  const data = parse(txtPath);
  const itens = data.lancamentos;

  const somaDespesas = itens
    .filter((l) => l.transactionType === "Despesa")
    .reduce((acc, l) => acc + l.amount, 0);
  const diff = Math.abs(somaDespesas - data.fatura.total);
  const pct = data.fatura.total > 0 ? (diff / data.fatura.total) * 100 : 0;

  console.log(`\nFatura: ${data.fatura.nomeCartao} — período ${data.fatura.period}`);
  console.log(`Lançamentos extraídos: ${itens.length} (à vista: ${itens.filter((l) => l.condition === "À vista").length}, parcelados: ${itens.filter((l) => l.condition === "Parcelado").length})`);
  console.log(`Validação: R$ ${somaDespesas.toFixed(2)} / R$ ${data.fatura.total.toFixed(2)} — diff ${pct.toFixed(1)}%`);

  if (data.fatura.total > 0 && pct > 1) {
    console.warn("ATENÇÃO: diferença acima de 1% — verifique antes de continuar.");
  }

  if (isDryRun) console.log("(MODO DRY-RUN — nada será inserido)\n");

  // ── Snapshot + Import ──────────────────────────────────────
  console.log("\nCarregando snapshot do banco...");
  const snapshot = await buildSnapshot();
  console.log(`  ${snapshot.avista.size} à vista + ${snapshot.parcelado.size} parcelados existentes\n`);

  // seriesCache agora guarda SeriesMeta (seriesId + metadados herdados da série)
  const seriesCache = new Map<string, SeriesMeta>(snapshot.seriesMap);
  let inseridos = 0;
  let ignorados = 0;
  let totalDespesasInseridas = 0;

  for (const item of itens) {
    const parcInfo =
      item.condition === "Parcelado"
        ? ` [${item.currentInstallment}/${item.installmentCount}]`
        : "";
    const label =
      `[${item.transactionType}] ${item.purchaseDate}` +
      `  R$ ${item.amount.toFixed(2).padStart(9)}${parcInfo}  ${item.name}`;

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

    // Resolve seriesId e herda metadados (pagador, categoria, note) da série existente
    let seriesId: string | null = null;
    let pagadorId: string | null = PAGADOR_ID!;
    let categoriaId: string | null = null;
    let note: string | null = null;

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

      if (meta.pagadorId || meta.categoriaId) {
        console.log(`  INSERT ${label} ← herda série (pagador/categoria)`);
      } else {
        console.log(`  INSERT ${label}`);
      }
    } else {
      console.log(`  INSERT ${label}`);
    }

    if (!isDryRun) {
      await db.insert(lancamentos).values({
        userId: USER_ID!,
        cartaoId: CARTAO_ID!,
        pagadorId,
        categoriaId,
        note,
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
      });
    }

    if (item.transactionType?.toLowerCase() === "despesa") totalDespesasInseridas += item.amount;
    inseridos++;
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Inseridos: ${inseridos}   Ignorados (já existiam): ${ignorados}`);
  if (isDryRun) {
    console.log("(Dry-run: nenhuma linha foi gravada no banco)");
  } else {
    console.log(
      `Total despesas inseridas: R$ ${totalDespesasInseridas.toFixed(2)}  |  Total da fatura: R$ ${data.fatura.total.toFixed(2)}`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
