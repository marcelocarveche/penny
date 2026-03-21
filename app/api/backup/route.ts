import { exec } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const maxDuration = 60;

const execAsync = promisify(exec);
const BACKUP_DIR = join(process.cwd(), "backups");
const TIMESTAMP_FILE = join(BACKUP_DIR, ".last-backup-time");

export async function GET() {
  try {
    const content = readFileSync(TIMESTAMP_FILE, "utf-8").trim();
    return NextResponse.json({ lastBackup: content });
  } catch {
    return NextResponse.json({ lastBackup: null });
  }
}

export async function POST() {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    await execAsync("bash scripts/backup-cloud.sh", { cwd: process.cwd() });
    const lastBackup = readFileSync(TIMESTAMP_FILE, "utf-8").trim();
    return NextResponse.json({ lastBackup });
  } catch (err) {
    console.error("[backup] Erro:", err);
    return NextResponse.json({ error: "Backup falhou" }, { status: 500 });
  }
}
