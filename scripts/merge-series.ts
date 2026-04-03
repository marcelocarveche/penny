#!/usr/bin/env tsx
// scripts/merge-series.ts
// Unifica series_id de parcelas que representam a mesma compra mas foram importadas
// com series_id diferentes (ex.: nome truncado no .txt vs. nome completo no backup).
//
// A chave de agrupamento é (purchaseDate + installmentCount + amount), que não
// depende do nome e identifica univocamente a compra original.
//
// O script também propaga pagador/categoria/nota da parcela mais enriquecida.
// NUNCA sobrescreve campos já preenchidos.
//
// Uso:
//   pnpm tsx scripts/merge-series.ts            — mostra o que seria alterado
//   pnpm tsx scripts/merge-series.ts --apply    — aplica

import { config } from "dotenv";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { lancamentos } from "../db/schema";

config();

const USER_ID = process.env.SEED_USER_ID;
const CARTAO_ID = process.env.SEED_CARTAO_ID;

if (!USER_ID || !CARTAO_ID) {
  console.error("Erro: defina SEED_USER_ID e SEED_CARTAO_ID no .env");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  console.log("\nMerge de series_id de parcelas da mesma compra");
  console.log(apply ? "Modo: APLICAR\n" : "Modo: DRY-RUN (use --apply para gravar)\n");

  // Carrega todas as parcelas do cartão
  const rows = await db
    .select({
      id: lancamentos.id,
      name: lancamentos.name,
      purchaseDate: lancamentos.purchaseDate,
      period: lancamentos.period,
      amount: lancamentos.amount,
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
        eq(lancamentos.condition, "Parcelado"),
      ),
    );

  // Chave natural: primeira_palavra_do_nome + installmentCount + abs(amount)
  // NÃO usa purchaseDate porque importações via AI podem ter salvo datas diferentes.
  // Usa só a primeira palavra do nome porque o .txt SISBB trunca nomes longos
  // (ex.: "IPLACE SAO PAULO" no backup vs "IPLACE" no .txt).
  // Usa Math.abs() porque backups antigos gravaram despesas com valor negativo.
  const purchaseKey = (row: (typeof rows)[0]): string => {
    const amt = Math.abs(Number(row.amount)).toFixed(2);
    const firstWord = row.name.trim().toUpperCase().split(/\s+/)[0];
    return `${firstWord}|${row.installmentCount}|${amt}`;
  };

  // Agrupa por chave natural
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = purchaseKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  let totalMerges = 0;
  let totalAtualizados = 0;

  for (const [key, parcelas] of groups) {
    // Séries distintas presentes neste grupo
    const seriesIds = [...new Set(parcelas.map((p) => p.seriesId).filter(Boolean))];

    if (seriesIds.length <= 1) continue; // Já unificadas ou sem seriesId

    totalMerges++;

    // Escolhe o seriesId canônico: o que tem mais parcelas ou mais metadados
    const scoreSeries = (sid: string) => {
      const group = parcelas.filter((p) => p.seriesId === sid);
      const metaScore = group.filter((p) => p.pagadorId || p.categoriaId || p.note).length;
      return metaScore * 1000 + group.length;
    };
    const canonicalId = seriesIds.sort((a, b) => scoreSeries(b!) - scoreSeries(a!))[0]!;

    // Metadados: pega o melhor disponível em TODAS as parcelas do grupo
    let bestPagadorId: string | null = null;
    let bestCategoriaId: string | null = null;
    let bestNote: string | null = null;
    for (const p of parcelas) {
      if (p.pagadorId) bestPagadorId = p.pagadorId;
      if (p.categoriaId) bestCategoriaId = p.categoriaId;
      if (p.note && !p.note.startsWith("[IA]")) bestNote = p.note;
    }

    // Parcelas que precisam de atualização (seriesId diferente ou faltando metadados)
    const paraAtualizar = parcelas.filter(
      (p) =>
        p.seriesId !== canonicalId ||
        (bestPagadorId && !p.pagadorId) ||
        (bestCategoriaId && !p.categoriaId) ||
        (bestNote && !p.note),
    );

    const nomes = [...new Set(parcelas.map((p) => p.name))].join(" / ");
    console.log(`\n  Compra: ${nomes}`);
    console.log(`  Chave:  ${key}`);
    console.log(`  Series encontradas: ${seriesIds.length} → unifica em ${canonicalId}`);
    console.log(`  Metadados: pagador=${bestPagadorId ?? "—"}  categoria=${bestCategoriaId ?? "—"}  note=${bestNote ?? "—"}`);
    console.log(`  Parcelas a corrigir: ${paraAtualizar.length}/${parcelas.length}`);

    for (const p of paraAtualizar) {
      const dateStr =
        p.purchaseDate instanceof Date
          ? p.purchaseDate.toISOString().slice(0, 10)
          : String(p.purchaseDate).slice(0, 10);
      const flags = [
        p.seriesId !== canonicalId ? "series_id" : "",
        bestPagadorId && !p.pagadorId ? "pagador" : "",
        bestCategoriaId && !p.categoriaId ? "categoria" : "",
        bestNote && !p.note ? "note" : "",
      ]
        .filter(Boolean)
        .join(", ");
      console.log(
        `    [${p.currentInstallment}/${p.installmentCount}] ${p.period}  ${p.name}  → fix: ${flags}`,
      );
    }

    if (apply && paraAtualizar.length > 0) {
      const ids = paraAtualizar.map((p) => p.id);
      const updatePayload: Record<string, string | null> = {
        seriesId: canonicalId,
      };
      if (bestPagadorId) updatePayload.pagadorId = bestPagadorId;
      if (bestCategoriaId) updatePayload.categoriaId = bestCategoriaId;
      if (bestNote) updatePayload.note = bestNote;

      await db
        .update(lancamentos)
        .set(updatePayload)
        .where(
          and(
            inArray(lancamentos.id, ids),
            eq(lancamentos.userId, USER_ID!),
          ),
        );

      totalAtualizados += ids.length;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  if (totalMerges === 0) {
    console.log("Nenhuma série fragmentada encontrada. Tudo OK.");
  } else {
    console.log(`Compras com séries fragmentadas: ${totalMerges}`);
    if (apply) {
      console.log(`Parcelas corrigidas: ${totalAtualizados}`);
    } else {
      console.log("Nenhuma alteração gravada. Use --apply para aplicar.");
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
