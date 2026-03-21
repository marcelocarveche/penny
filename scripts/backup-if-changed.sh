#!/bin/bash
# scripts/backup-if-changed.sh
# Verifica se o banco mudou desde o último backup e, se sim, faz backup na nuvem.
# Projetado para ser chamado a cada 5 minutos via Agendador de Tarefas do Windows.
#
# Uso:
#   bash scripts/backup-if-changed.sh
#   wsl.exe -e bash -c "cd /mnt/c/Users/marce/www/penny && bash scripts/backup-if-changed.sh >> backups/backup.log 2>&1"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
STATE_FILE="${ROOT_DIR}/backups/.last-state"
REQUEST_FILE="${ROOT_DIR}/backups/.backup-requested"

get_env() {
  local key="$1" default="${2:-}"
  if [ -f "$ENV_FILE" ]; then
    local val
    val=$(grep -m1 "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
    echo "${val:-$default}"
  else
    echo "$default"
  fi
}

PG_USER=$(get_env POSTGRES_USER penny)
PG_DB=$(get_env POSTGRES_DB penny_db)
CONTAINER="penny_postgres"

mkdir -p "${ROOT_DIR}/backups"

# Verifica se o container está rodando
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "[$(date '+%Y-%m-%d %H:%M')] Container ${CONTAINER} não está rodando. Pulando."
  exit 0
fi

# Se o app solicitou backup manual, executa imediatamente ignorando detecção de mudança
if [ -f "$REQUEST_FILE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M')] Backup solicitado pelo app. Executando..."
  rm -f "$REQUEST_FILE"
  bash "${SCRIPT_DIR}/backup-cloud.sh"
  # Atualiza estado para evitar backup duplo logo em seguida
  docker exec "$CONTAINER" psql -U "$PG_USER" "$PG_DB" -t -c \
    "SELECT SUM(c) FROM (
       SELECT COUNT(*) AS c FROM lancamentos
       UNION ALL SELECT COUNT(*) FROM \"user\"
       UNION ALL SELECT COUNT(*) FROM cartoes
       UNION ALL SELECT COUNT(*) FROM contas
     ) t;" 2>/dev/null | tr -d ' \n' > "$STATE_FILE" || true
  echo "[$(date '+%Y-%m-%d %H:%M')] Backup concluído."
  exit 0
fi

# Obtém estado atual: contagem de linhas nas tabelas principais
CURRENT_STATE=$(docker exec "$CONTAINER" psql -U "$PG_USER" "$PG_DB" -t -c \
  "SELECT SUM(c) FROM (
     SELECT COUNT(*) AS c FROM lancamentos
     UNION ALL SELECT COUNT(*) FROM \"user\"
     UNION ALL SELECT COUNT(*) FROM cartoes
     UNION ALL SELECT COUNT(*) FROM contas
   ) t;" 2>/dev/null | tr -d ' \n') || CURRENT_STATE="0"

# Lê o estado do último backup
LAST_STATE=""
if [ -f "$STATE_FILE" ]; then
  LAST_STATE=$(cat "$STATE_FILE")
fi

if [ "$CURRENT_STATE" = "$LAST_STATE" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M')] Sem mudanças (${CURRENT_STATE} registros). Nenhum backup necessário."
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M')] Mudança detectada (${LAST_STATE:-0} → ${CURRENT_STATE}). Iniciando backup..."

# Executa o backup
bash "${SCRIPT_DIR}/backup-cloud.sh"

# Atualiza o estado salvo
echo "$CURRENT_STATE" > "$STATE_FILE"

echo "[$(date '+%Y-%m-%d %H:%M')] Backup concluído."
