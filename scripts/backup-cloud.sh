#!/bin/bash
# scripts/backup-cloud.sh
# Faz dump do banco, comprime e envia para o Google Drive via rclone.
#
# Uso:
#   make backup-cloud
#   bash scripts/backup-cloud.sh
#
# Requer:
#   - rclone instalado e configurado (make setup-rclone para instruções)
#   - RCLONE_REMOTE e RCLONE_PATH definidos no .env (padrão: gdrive / openmonetis/backups)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

# Lê variáveis do .env sem usar export (evita problemas com senhas especiais)
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

PG_USER=$(get_env POSTGRES_USER openmonetis)
PG_DB=$(get_env POSTGRES_DB openmonetis_db)
CONTAINER="openmonetis_postgres"
REMOTE=$(get_env RCLONE_REMOTE gdrive)
REMOTE_PATH=$(get_env RCLONE_PATH openmonetis/backups)

LOCAL_DIR="${ROOT_DIR}/backups"
FILE="${LOCAL_DIR}/latest.sql"

mkdir -p "$LOCAL_DIR"

echo "=== Backup Cloud ==="
echo "Banco:    ${PG_USER}@${PG_DB} (${CONTAINER})"
echo "Destino:  ${REMOTE}:${REMOTE_PATH}/latest.sql.gz (sobrescreve)"
echo ""

echo "1/3  Dump do banco..."
docker exec "$CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" > "$FILE"
echo "     OK — $(du -h "$FILE" | cut -f1)"

echo "2/3  Comprimindo..."
gzip -f "$FILE"
echo "     OK — $(du -h "${FILE}.gz" | cut -f1)"

echo "3/3  Enviando para ${REMOTE}:${REMOTE_PATH}/..."
rclone copyto "${FILE}.gz" "${REMOTE}:${REMOTE_PATH}/latest.sql.gz"
echo "     OK — latest.sql.gz atualizado"

# Grava timestamp do último backup (lido pelo app na navbar)
date -u +"%Y-%m-%dT%H:%M:%S.000Z" > "${LOCAL_DIR}/.last-backup-time"

echo ""
echo "Concluído."
echo "  Local:  backups/latest.sql.gz"
echo "  Nuvem:  ${REMOTE}:${REMOTE_PATH}/latest.sql.gz"
