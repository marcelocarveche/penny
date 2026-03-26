#!/usr/bin/env tsx
// scripts/extract-fatura.ts
// Envia o PDF/JPG da fatura para a API de IA página por página e agrega os resultados.
//
// Uso:
//   make extract-fatura FILE=scripts/import/fatura.pdf
//   tsx scripts/extract-fatura.ts scripts/import/fatura.pdf
//
// Requer no .env: OPENAI_API_KEY ou ANTHROPIC_API_KEY

import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, dirname } from "node:path";
import { config } from "dotenv";
import { PDFDocument } from "pdf-lib";

config();

// Prompt para extração de UMA página (sem exigir total — será validado no aggregate)
const PROMPT_PAGE = `Você é um extrator de dados financeiros especializado em faturas de cartão de crédito brasileiras.
Analise esta página da fatura e extraia TODAS as transações visíveis.

Regras:
- "name": nome do estabelecimento limpo e legível
- "amount": valor numérico positivo da PARCELA (não o total), sem símbolo de moeda (ex: 149.90)
- Para compras em moeda estrangeira: use o valor em BRL cobrado na fatura (já convertido)
- "purchaseDate": data da compra no formato YYYY-MM-DD (se não aparecer na página, use a data mais próxima visível)
- "period": mês de competência da fatura no formato YYYY-MM
- "condition": "À vista" para compras sem parcelamento, "Parcelado" para parceladas (ex: "2/6")
- "currentInstallment": número da parcela atual como inteiro (null se "À vista")
- "installmentCount": total de parcelas como inteiro (null se "À vista")
- "paymentMethod": sempre "credito"
- "transactionType": "Despesa" para compras, "Receita" para estornos/créditos
- "isSettled": sempre true
- "categoriaSugerida": escolha UMA: Alimentacao, Mercado, Transporte, Combustivel, Saude, Farmacia, Educacao, Lazer, Viagem, Moradia, Contas e Servicos, Assinaturas, Vestuario, Eletronicos, Pet, Beleza, Academia, Presente, Impostos, Outros

IGNORE: pagamento de fatura anterior, encargos, juros rotativos, IOF.
Se a página não contiver transações (ex: página de resumo sem lista), retorne lancamentos vazio.
Se encontrar o total da fatura nesta página, inclua em fatura.total (caso contrário use 0).

Retorne APENAS JSON válido, sem markdown, sem explicações:
{
  "fatura": {
    "period": "YYYY-MM",
    "vencimento": "YYYY-MM-DD",
    "total": 0.00,
    "nomeCartao": "nome do cartão ou vazio"
  },
  "lancamentos": []
}`;

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
  categoriaSugerida: string;
};

type PageResult = {
  fatura: { period: string; vencimento: string; total: number; nomeCartao: string };
  lancamentos: Lancamento[];
};

async function splitPdfPages(pdfBuffer: Buffer): Promise<Buffer[]> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const pageCount = srcDoc.getPageCount();
  const pages: Buffer[] = [];

  for (let i = 0; i < pageCount; i++) {
    const newDoc = await PDFDocument.create();
    const [page] = await newDoc.copyPages(srcDoc, [i]);
    newDoc.addPage(page);
    const bytes = await newDoc.save();
    pages.push(Buffer.from(bytes));
  }

  return pages;
}

async function callOpenAI(fileBuffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY nao definida no .env");

  const base64 = fileBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT_PAGE },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const json = await response.json() as { choices: Array<{ message: { content: string } }> };
  return json.choices[0]?.message?.content ?? "";
}

async function callAnthropic(fileBuffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY nao definida no .env");

  const base64 = fileBuffer.toString("base64");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: mimeType, data: base64 } },
            { type: "text", text: PROMPT_PAGE },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${err}`);
  }

  const json = await response.json() as { content: Array<{ text: string }> };
  return json.content[0]?.text ?? "";
}

async function extractPage(
  pageBuffer: Buffer,
  mimeType: string,
  provider: "openai" | "anthropic",
): Promise<PageResult> {
  const raw = provider === "openai"
    ? await callOpenAI(pageBuffer, mimeType)
    : await callAnthropic(pageBuffer, mimeType);

  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    return JSON.parse(cleaned) as PageResult;
  } catch {
    console.warn("  Aviso: pagina retornou JSON invalido, ignorando.");
    return { fatura: { period: "", vencimento: "", total: 0, nomeCartao: "" }, lancamentos: [] };
  }
}

function chooseProvider(): "openai" | "anthropic" {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasOpenAI && !hasAnthropic) {
    console.error("Erro: defina OPENAI_API_KEY ou ANTHROPIC_API_KEY no .env");
    process.exit(1);
  }

  return hasOpenAI ? "openai" : "anthropic";
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  const mime = map[ext];
  if (!mime) throw new Error(`Formato nao suportado: ${ext}. Use PDF, JPG ou PNG.`);
  return mime;
}

function aggregate(pages: PageResult[]): PageResult {
  const lancamentos = pages.flatMap((p) => p.lancamentos);

  // Usa os metadados da página que tiver total > 0 e period preenchido
  const meta = pages.find((p) => p.fatura.total > 0 && p.fatura.period) ?? pages[0];

  return { fatura: meta.fatura, lancamentos };
}

function validate(data: PageResult) {
  const soma = data.lancamentos
    .filter((l) => l.transactionType === "Despesa" || l.transactionType === "despesa")
    .reduce((acc, l) => acc + l.amount, 0);
  const total = data.fatura.total;
  const diff = Math.abs(soma - total);
  const pct = total > 0 ? (diff / total) * 100 : 0;

  console.log(`\nValidacao:`);
  console.log(`  Total da fatura:      R$ ${total.toFixed(2)}`);
  console.log(`  Soma dos lancamentos: R$ ${soma.toFixed(2)}`);
  console.log(`  Diferenca:            R$ ${diff.toFixed(2)} (${pct.toFixed(1)}%)`);

  if (total === 0) {
    console.warn("  ATENCAO: total da fatura nao encontrado. Confira o JSON gerado.");
  } else if (pct > 5) {
    console.warn("  ATENCAO: diferenca acima de 5%. Pode haver transacoes perdidas.");
  } else {
    console.log("  OK — dentro da margem aceitavel.");
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Uso: tsx scripts/extract-fatura.ts <caminho-do-arquivo>");
    process.exit(1);
  }

  const fileBuffer = readFileSync(filePath);
  const mimeType = getMimeType(filePath);
  const provider = chooseProvider();
  const providerName = provider === "openai" ? "OpenAI GPT-4o" : "Anthropic Claude";

  console.log(`Arquivo:  ${basename(filePath)} (${(fileBuffer.length / 1024).toFixed(0)} KB)`);
  console.log(`Provedor: ${providerName}`);

  let pages: Buffer[];

  if (mimeType === "application/pdf") {
    pages = await splitPdfPages(fileBuffer);
    console.log(`Paginas:  ${pages.length}`);
  } else {
    pages = [fileBuffer];
    console.log("Paginas:  1 (imagem)");
  }

  console.log("\nProcessando...\n");

  const results: PageResult[] = [];

  for (let i = 0; i < pages.length; i++) {
    process.stdout.write(`  Pagina ${i + 1}/${pages.length}... `);

    let result: PageResult;
    try {
      result = await extractPage(pages[i], mimeType, provider);
    } catch (err) {
      const msg = String(err);
      const isQuota = msg.includes("insufficient_quota") || msg.includes("exceeded");
      if (isQuota && provider === "openai" && !!process.env.ANTHROPIC_API_KEY) {
        console.warn("\nOpenAI sem creditos. Trocando para Anthropic...");
        result = await extractPage(pages[i], mimeType, "anthropic");
      } else {
        console.error(`\nErro na pagina ${i + 1}:`, err);
        process.exit(1);
      }
    }

    console.log(`${result.lancamentos.length} lancamentos`);
    results.push(result);
  }

  const data = aggregate(results);
  validate(data);

  const period = data.fatura?.period ?? "sem-periodo";
  const outputPath = join(dirname(filePath), `fatura-${period}.json`);
  writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");

  console.log(`\nArquivo salvo: ${outputPath}`);
  console.log(`Total de lancamentos: ${data.lancamentos.length}`);
  console.log(`\nProximo passo:`);
  console.log(`  make import-fatura FILE=${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
