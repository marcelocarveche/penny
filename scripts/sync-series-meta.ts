#!/usr/bin/env tsx
// scripts/sync-series-meta.ts
// Propaga pagador, categoria e nota para todas as parcelas de uma mesma série.
//
// Útil quando parcelas de meses anteriores já foram enriquecidas (pagador/categoria/nota)
// mas parcelas de outros meses foram importadas depois sem esses dados.
//
// O script NUNCA sobrescreve um campo que já está preenchido — só preenche NULLs.
//
// Uso:
//   pnpm tsx scripts/sync-series-meta.ts            — mostra o que seria alterado
//   pnpm tsx scripts/sync-series-meta.ts --apply    — aplica as alterações

import { config } from "dotenv";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
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
  console.log(`\nSync de metadados entre parcelas da mesma série`);
  console.log(apply ? "Modo: APLICAR alterações\n" : "Modo: DRY-RUN (use --apply para gravar)\n");

  // Carrega todas as parcelas do cartão
  const rows = await db
    .select({
      id: lancamentos.id,
      name: lancamentos.name,
      purchaseDate: lancamentos.purchaseDate,
      period: lancamentos.period,
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
        isNotNull(lancamentos.seriesId),
      ),
    );

  // Agrupa por seriesId
  const series = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.seriesId) continue;
    if (!series.has(row.seriesId)) series.set(row.seriesId, []);
    series.get(row.seriesId)!.push(row);
  }

  console.log(`Séries encontradas: ${series.size}`);

  let totalAtualizados = 0;
  let seriesComDiff = 0;

  for (const [seriesId, parcelas] of series) {
    // Encontra os melhores metadados disponíveis na série
    // Prioriza a entrada que tem mais campos preenchidos
    let bestPagadorId: string | null = null;
    let bestCategoriaId: string | null = null;
    let bestNote: string | null = null;

    for (const p of parcelas) {
      if (p.pagadorId) bestPagadorId = p.pagadorId;
      if (p.categoriaId) bestCategoriaId = p.categoriaId;
      // Note: ignora notas geradas por IA [IA] ao propagar
      if (p.note && !p.note.startsWith("[IA]")) bestNote = p.note;
    }

    // Se a série não tem nenhum metadado definido, nada a fazer
    if (!bestPagadorId && !bestCategoriaId && !bestNote) continue;

    // Identifica parcelas que precisam ser atualizadas
    const paraAtualizar = parcelas.filter(
      (p) =>
        (bestPagadorId && !p.pagadorId) ||
        (bestCategoriaId && !p.categoriaId) ||
        (bestNote && !p.note),
    );

    if (paraAtualizar.length === 0) continue;

    seriesComDiff++;
    const nomeSerie = `${parcelas[0].name} (${parcelas[0].installmentCount} parcelas)`;
    console.log(`\n  Série: ${nomeSerie}`);
    console.log(`    pagadorId:   ${bestPagadorId ?? "—"}`);
    console.log(`    categoriaId: ${bestCategoriaId ?? "—"}`);
    console.log(`    note:        ${bestNote ?? "—"}`);
    console.log(`    Parcelas a atualizar: ${paraAtualizar.length}/${parcelas.length}`);

    for (const p of paraAtualizar) {
      const dateStr =
        p.purchaseDate instanceof Date
          ? p.purchaseDate.toISOString().slice(0, 10)
          : String(p.purchaseDate).slice(0, 10);
      console.log(
        `      [${p.currentInstallment}/${p.installmentCount}] período ${p.period}  compra ${dateStr}`,
      );
    }

    if (apply) {
      const ids = paraAtualizar.map((p) => p.id);

      // Monta o update apenas com os campos que têm valor a propagar
      const updatePayload: Record<string, string | null> = {};
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
  console.log(`Séries com diferença: ${seriesComDiff}`);
  if (apply) {
    console.log(`Parcelas atualizadas: ${totalAtualizados}`);
  } else {
    console.log("Nenhuma alteração gravada (dry-run). Use --apply para aplicar.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
