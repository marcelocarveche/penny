#!/usr/bin/env tsx
// scripts/normalize-transaction-types.ts
// Normaliza os valores de tipo_transacao para capitalização correta ("Despesa", "Receita").
//
// Uso:
//   tsx scripts/normalize-transaction-types.ts
//   make normalize-types

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  const result = await db.execute(sql`
    UPDATE lancamentos
    SET tipo_transacao = CASE
      WHEN LOWER(tipo_transacao) = 'despesa'     THEN 'Despesa'
      WHEN LOWER(tipo_transacao) = 'receita'     THEN 'Receita'
      WHEN LOWER(tipo_transacao) = 'transferência' THEN 'Transferência'
      ELSE tipo_transacao
    END
    WHERE tipo_transacao NOT IN ('Despesa', 'Receita', 'Transferência')
  `);

  console.log(`Lançamentos atualizados: ${result.rowCount}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
  process.exit(1);
});
