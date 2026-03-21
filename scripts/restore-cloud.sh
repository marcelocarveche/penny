#!/bin/bash
# scripts/restore-cloud.sh
# Baixa o backup mais recente do Google Drive e restaura o banco, se estiver vazio.
#
# Uso:
#   make restore-cloud           — restaura apenas se o banco estiver vazio
#   make restore-cloud FORCE=1   — restaura mesmo se o banco tiver dados
#
# Requer:
#   - rclone instalado e configurado (make setup-rclone para instruções)
#   - RCLONE_REMOTE e RCLONE_PATH definidos no .env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
FORCE="${FORCE:-0}"

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

echo "=== Restore Cloud ==="
echo "Banco:   ${PG_USER}@${PG_DB} (${CONTAINER})"
echo "Origem:  ${REMOTE}:${REMOTE_PATH}/"
echo ""

# Verifica se o banco já tem dados (tabela "user")
ROW_COUNT=$(docker exec "$CONTAINER" \
  psql -U "$PG_USER" "$PG_DB" -t -c 'SELECT COUNT(*) FROM "user";' 2>/dev/null \
  | tr -d ' \n') || ROW_COUNT="0"

if [ "${ROW_COUNT:-0}" -gt "0" ] 2>/dev/null && [ "$FORCE" != "1" ]; then
  echo "Banco já possui dados (${ROW_COUNT} usuário(s)). Restore cancelado."
  echo "Para forçar, use: make restore-cloud FORCE=1"
  exit 0
fi

if [ "$FORCE" = "1" ] && [ "${ROW_COUNT:-0}" -gt "0" ]; then
  echo "AVISO: banco com dados — restaurando mesmo assim (FORCE=1)."
  echo ""
fi

# Verifica se o arquivo existe no Drive
echo "1/3  Verificando backup no Drive..."
if ! rclone lsf "${REMOTE}:${REMOTE_PATH}/latest.sql.gz" &>/dev/null; then
  echo "     Nenhum backup encontrado em ${REMOTE}:${REMOTE_PATH}/latest.sql.gz"
  exit 1
fi
echo "     Encontrado: latest.sql.gz"

# Download
echo "2/3  Baixando..."
mkdir -p "$LOCAL_DIR"
rclone copyto "${REMOTE}:${REMOTE_PATH}/latest.sql.gz" "${LOCAL_DIR}/latest.sql.gz"
echo "     OK — $(du -h "${LOCAL_DIR}/latest.sql.gz" | cut -f1)"

# Restore
echo "3/3  Restaurando..."
gunzip -c "${LOCAL_DIR}/latest.sql.gz" | docker exec -i "$CONTAINER" psql -U "$PG_USER" "$PG_DB" -q
echo "     OK"

echo ""
echo "Restore concluído a partir de latest.sql.gz."
