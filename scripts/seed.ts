#!/usr/bin/env tsx
// scripts/seed.ts
// Popula o banco com conta BB, cartão Ourocard e categorias comuns
//
// Uso:
//   tsx scripts/seed.ts
//
// Requer variavel de ambiente DATABASE_URL e USER_ID configurados.
// USER_ID pode ser passado como argumento ou definido abaixo.

import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { categorias, cartoes, contas } from "../db/schema";

config();

const USER_ID = process.env.SEED_USER_ID;

if (!USER_ID) {
  console.error("Erro: variavel SEED_USER_ID nao definida no .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  console.log(`Iniciando seed para o usuario: ${USER_ID}\n`);

  // --------------------------------------------------
  // 1. Conta Banco do Brasil
  // --------------------------------------------------
  let contaBB = (await db.select().from(contas).where(eq(contas.userId, USER_ID))
    .then((rows) => rows.find((r) => r.name === "Banco do Brasil"))) ?? null;

  if (contaBB) {
    console.log(`  SKIP — conta Banco do Brasil ja existe: ${contaBB.id}`);
  } else {
    console.log("Criando conta Banco do Brasil...");
    const [nova] = await db
      .insert(contas)
      .values({
        name: "Banco do Brasil",
        accountType: "corrente",
        logo: "bb",
        status: "ativo",
        initialBalance: "0",
        excludeFromBalance: false,
        excludeInitialBalanceFromIncome: false,
        userId: USER_ID,
      })
      .returning();
    contaBB = nova;
    console.log(`  OK — conta criada: ${contaBB.id}`);
  }

  // --------------------------------------------------
  // 2. Cartao Ourocard vinculado ao BB
  // --------------------------------------------------
  let cartaoOurocard = (await db.select().from(cartoes).where(eq(cartoes.userId, USER_ID))
    .then((rows) => rows.find((r) => r.name === "Ourocard"))) ?? null;

  if (cartaoOurocard) {
    console.log(`  SKIP — cartao Ourocard ja existe: ${cartaoOurocard.id}`);
  } else {
    console.log("Criando cartao Ourocard...");
    const [novo] = await db
      .insert(cartoes)
      .values({
        name: "Ourocard",
        brand: "mastercard",
        logo: "bb",
        closingDay: "3",
        dueDay: "10",
        status: "ativo",
        userId: USER_ID,
        contaId: contaBB.id,
      })
      .returning();
    cartaoOurocard = novo;
    console.log(`  OK — cartao criado: ${cartaoOurocard.id}`);
  }

  // --------------------------------------------------
  // 3. Categorias comuns
  // --------------------------------------------------
  console.log("Criando categorias...");

  const categoriasParaInserir = [
    // Despesas
    { name: "Alimentacao",        type: "despesa",  icon: "RiRestaurantLine" },
    { name: "Mercado",            type: "despesa",  icon: "RiShoppingCart2Line" },
    { name: "Transporte",         type: "despesa",  icon: "RiCarLine" },
    { name: "Combustivel",        type: "despesa",  icon: "RiGasStationLine" },
    { name: "Saude",              type: "despesa",  icon: "RiHeartPulseLine" },
    { name: "Farmacia",           type: "despesa",  icon: "RiMedicineBottleLine" },
    { name: "Educacao",           type: "despesa",  icon: "RiGraduationCapLine" },
    { name: "Lazer",              type: "despesa",  icon: "RiGamepadLine" },
    { name: "Viagem",             type: "despesa",  icon: "RiPlaneLine" },
    { name: "Moradia",            type: "despesa",  icon: "RiHome2Line" },
    { name: "Contas e Servicos",  type: "despesa",  icon: "RiFileList3Line" },
    { name: "Assinaturas",        type: "despesa",  icon: "RiRepeatLine" },
    { name: "Vestuario",          type: "despesa",  icon: "RiShirtLine" },
    { name: "Eletronicos",        type: "despesa",  icon: "RiSmartphoneLine" },
    { name: "Pet",                type: "despesa",  icon: "RiPawPrintLine" },
    { name: "Beleza",             type: "despesa",  icon: "RiScissorsCutLine" },
    { name: "Academia",           type: "despesa",  icon: "RiRunLine" },
    { name: "Presente",           type: "despesa",  icon: "RiGift2Line" },
    { name: "Impostos",           type: "despesa",  icon: "RiGovernmentLine" },
    { name: "Outros",             type: "despesa",  icon: "RiMoreLine" },
    // Receitas
    { name: "Salario",            type: "receita",  icon: "RiBriefcaseLine" },
    { name: "Freelance",          type: "receita",  icon: "RiComputerLine" },
    { name: "Investimentos",      type: "receita",  icon: "RiLineChartLine" },
    { name: "Aluguel Recebido",   type: "receita",  icon: "RiBuilding2Line" },
    { name: "Reembolso",          type: "receita",  icon: "RiRefundLine" },
    { name: "Outras Receitas",    type: "receita",  icon: "RiAddCircleLine" },
  ];

  const existentes = await db.select().from(categorias).where(eq(categorias.userId, USER_ID));
  const nomesExistentes = new Set(existentes.map((c) => c.name));

  const novas = categoriasParaInserir.filter((c) => !nomesExistentes.has(c.name));

  if (novas.length === 0) {
    console.log(`  SKIP — todas as categorias ja existem (${existentes.length} no total)`);
  } else {
    const categoriasCriadas = await db
      .insert(categorias)
      .values(novas.map((c) => ({ name: c.name, type: c.type, icon: c.icon, userId: USER_ID })))
      .returning();
    console.log(`  OK — ${categoriasCriadas.length} categorias criadas, ${nomesExistentes.size} ja existiam`);
  }

  // --------------------------------------------------
  // Resumo
  // --------------------------------------------------
  console.log("\n=== Seed concluido ===");
  console.log(`Conta BB:        ${contaBB.id}`);
  console.log(`Cartao Ourocard: ${cartaoOurocard.id}`);
  console.log("\nGuarde esses IDs para usar no script de importacao de fatura (IMPORT_FATURA.md).");
  console.log("Voce tambem pode consulta-los a qualquer momento com: pnpm db:studio");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
