#!/usr/bin/env tsx
// scripts/parse-fatura-txt.ts
// Converte o arquivo .txt da fatura SISBB (Banco do Brasil) em JSON
// compatível com import-fatura.ts
//
// Uso:
//   tsx scripts/parse-fatura-txt.ts scripts/import/abril.txt
//   make parse-fatura FILE=scripts/import/abril.txt
//
// O arquivo de saída é salvo no mesmo diretório com nome fatura-YYYY-MM.json

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────

type SectionState = "skip" | "avista" | "parcelado" | "debitos" | "encargos";

type Lancamento = {
  name: string;
  amount: number;
  purchaseDate: string;      // YYYY-MM-DD
  period: string;            // YYYY-MM  (período de cobrança da fatura)
  condition: "À vista" | "Parcelado";
  currentInstallment: number | null;
  installmentCount: number | null;
  paymentMethod: string;
  transactionType: "Despesa" | "Receita";
  isSettled: boolean;
};

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

/** "1.234,56" → 1234.56 */
function parseBRL(s: string): number {
  return parseFloat(s.replace(/\./g, "").replace(",", "."));
}

/**
 * Determina o ano da compra.
 *
 * Para compras à vista: o mês da compra deve ser <= mês da fatura.
 * Se for maior (ex.: dezembro numa fatura de janeiro), é do ano anterior.
 *
 * Para parceladas: subtrai `currentInstallment` meses do período da fatura
 * para chegar ao mês/ano da compra original.
 */
function resolveYear(
  billPeriod: string,
  purchaseMonth: number,
  currentInstallment: number | null,
): number {
  const [billYear, billMonth] = billPeriod.split("-").map(Number);

  if (currentInstallment !== null) {
    // Mês da compra = período da fatura − currentInstallment meses
    let month = billMonth - currentInstallment;
    let year = billYear;
    while (month <= 0) {
      month += 12;
      year--;
    }
    return year;
  }

  // À vista: se o mês da compra > mês da fatura, é do ano anterior
  return purchaseMonth > billMonth ? billYear - 1 : billYear;
}

/**
 * Limpa o nome do estabelecimento.
 * A descrição bruta da linha tem formato: "NOME  CIDADE  PAIS"
 * Separamos no primeiro bloco de 3+ espaços e normalizamos.
 */
function extractName(rawDesc: string): string {
  // Remove marcadores de parcelamento que sobraram (segurança)
  const withoutParc = rawDesc.replace(/\s+PARC\s+\d+\/\d+.*/i, "").trim();
  // Divide na primeira sequência de 3+ espaços (separa nome da cidade)
  const firstPart = withoutParc.split(/\s{3,}/)[0];
  // Normaliza espaços internos
  return firstPart.replace(/\s{2,}/g, " ").trim();
}

/**
 * Detecta mudança de seção principal a partir da linha trimada.
 * Retorna a nova seção ou null se a linha não é um cabeçalho de seção.
 * Retorna "subsection" para sub-cabeçalhos que não mudam o estado.
 */
function detectSection(trimmed: string): SectionState | "subsection" | null {
  if (trimmed === "Pagamentos") return "skip";
  if (trimmed === "Compras a vista") return "avista";
  if (trimmed.includes("Compras/Pagamento de contas parceladas")) return "parcelado";
  if (/d.bitos diversos/i.test(trimmed)) return "debitos";
  if (trimmed === "Anuidades") return "skip";
  if (trimmed === "Encargos") return "encargos";

  // Sub-cabeçalhos: não alteram a seção corrente
  if (
    trimmed === "Compras Diversas" ||
    trimmed === "Compras por mala direta/telefone/web" ||
    trimmed === "Restaurantes"
  ) {
    return "subsection";
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// Parser principal
// ─────────────────────────────────────────────────────────

export function parse(filePath: string): {
  fatura: { period: string; vencimento: string; total: number; nomeCartao: string };
  lancamentos: Lancamento[];
} {
  // Faturas SISBB/BB são codificadas em CP-1252 (Latin-1 superset)
  const content = readFileSync(filePath, "latin1");
  const lines = content.split(/\r?\n/);

  let section: SectionState = "skip";
  let billPeriod = "";
  let billTotal = 0;
  let nomeCartao = "OUROCARD VISA INTERNATIONAL";
  const lancamentos: Lancamento[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    // ── Metadados do cabeçalho ──────────────────────────────

    // Data de impressão: "31/03/2026   Auto-Atendimento   ..."
    // Período da fatura = mês seguinte ao da impressão
    if (!billPeriod) {
      const m = line.match(/(\d{2})\/(\d{2})\/(\d{4})\s+Auto-Atendimento/);
      if (m) {
        const month = parseInt(m[2]);
        const year = parseInt(m[3]);
        const periodMonth = month === 12 ? 1 : month + 1;
        const periodYear = month === 12 ? year + 1 : year;
        billPeriod = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;
      }
    }

    // Nome do cartão
    if (trimmed.startsWith("Modalidade")) {
      const m = trimmed.match(/Modalidade\s*:\s*(.+)/);
      if (m) nomeCartao = m[1].trim();
    }

    // Total da fatura (linha "   Total   4.717,63   0,00")
    const totalMatch = line.match(/^\s+Total\s+([\d.]+,\d{2})/);
    if (totalMatch) {
      billTotal = parseBRL(totalMatch[1]);
      continue;
    }

    // ── Detecção de seção ───────────────────────────────────

    const sectionResult = detectSection(trimmed);
    if (sectionResult !== null) {
      if (sectionResult !== "subsection") section = sectionResult;
      continue;
    }

    if (section === "skip") continue;

    // ── Linhas auxiliares (notas de câmbio, etc.) ───────────
    if (trimmed.startsWith("***")) continue;
    if (/^Cota.{1,3}o do D.{1,3}lar/i.test(trimmed)) continue;
    if (trimmed.startsWith("(SUSEP")) continue;

    // ── Linha de transação: começa com DD/MM ────────────────
    // Formato: DD/MM    DESCRIÇÃO...     VALOR_BRL   VALOR_USD
    const txMatch = line.match(
      /^(\d{2}\/\d{2})\s{4,}(.+?)\s{2,}(-?[\d.]+,\d{2})\s+[\d.]+,\d{2}\s*$/,
    );
    if (!txMatch) continue;

    const [, dateDDMM, rawDesc, rawAmount] = txMatch;
    const [dayStr, monthStr] = dateDDMM.split("/");
    const day = parseInt(dayStr);
    const month = parseInt(monthStr);
    const amount = parseBRL(rawAmount);

    if (amount === 0) continue;

    // Detecta parcelamento: " PARC XX/YY" (requer espaço antes de PARC
    // para não confundir com "TIT-PARC" das anuidades)
    const parcMatch = rawDesc.match(/\s+PARC\s+(\d+)\/(\d+)/i);
    let currentInstallment: number | null = null;
    let installmentCount: number | null = null;
    let name: string;

    if (parcMatch) {
      currentInstallment = parseInt(parcMatch[1]);
      installmentCount = parseInt(parcMatch[2]);
      name = extractName(rawDesc.slice(0, rawDesc.indexOf(parcMatch[0])));
    } else {
      name = extractName(rawDesc);
    }

    if (!name) continue;

    const year = resolveYear(billPeriod, month, currentInstallment);
    const purchaseDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    lancamentos.push({
      name,
      amount: Math.abs(amount),
      purchaseDate,
      period: billPeriod,
      condition: currentInstallment !== null ? "Parcelado" : "À vista",
      currentInstallment,
      installmentCount,
      paymentMethod: "Cartão de crédito",
      transactionType: amount < 0 ? "Receita" : "Despesa",
      isSettled: true,
    });
  }

  // Due date: convenção Ourocard BB = dia 10 do mês de vencimento
  const vencimento = billPeriod ? `${billPeriod}-10` : "";

  return {
    fatura: { period: billPeriod, vencimento, total: billTotal, nomeCartao },
    lancamentos,
  };
}

// ─────────────────────────────────────────────────────────
// Validação e saída
// ─────────────────────────────────────────────────────────

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Uso: tsx scripts/parse-fatura-txt.ts <fatura.txt>");
    process.exit(1);
  }

  const data = parse(filePath);

  const somaDespesas = data.lancamentos
    .filter((l) => l.transactionType === "Despesa")
    .reduce((acc, l) => acc + l.amount, 0);

  const diff = Math.abs(somaDespesas - data.fatura.total);
  const pct = data.fatura.total > 0 ? (diff / data.fatura.total) * 100 : 0;

  console.log(`\nFatura: ${data.fatura.nomeCartao} — período ${data.fatura.period}`);
  console.log(`Lançamentos extraídos: ${data.lancamentos.length}`);
  console.log(
    `  À vista:   ${data.lancamentos.filter((l) => l.condition === "À vista").length}`,
  );
  console.log(
    `  Parcelado: ${data.lancamentos.filter((l) => l.condition === "Parcelado").length}`,
  );

  console.log(`\nValidação:`);
  console.log(`  Total da fatura:      R$ ${data.fatura.total.toFixed(2)}`);
  console.log(`  Soma das despesas:    R$ ${somaDespesas.toFixed(2)}`);
  console.log(`  Diferença:            R$ ${diff.toFixed(2)} (${pct.toFixed(1)}%)`);

  if (data.fatura.total === 0) {
    console.warn("  ATENÇÃO: total da fatura não encontrado.");
  } else if (pct > 1) {
    console.warn("  ATENÇÃO: diferença acima de 1% — verifique o JSON gerado.");
  } else {
    console.log("  OK — dentro da margem aceitável.");
  }

  const outPath = join(dirname(filePath), `fatura-${data.fatura.period}.json`);
  writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`\nArquivo salvo: ${outPath}`);
  console.log(`\nPróximo passo:`);
  console.log(`  make import-fatura FILE=${outPath}`);
}

main();
