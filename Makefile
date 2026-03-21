.PHONY: dev prod stop down logs logs-app logs-dev ps build backup restore backup-cloud restore-cloud backup-if-changed setup-rclone seed extract-fatura import-fatura import-ofx


# Inicia em modo desenvolvimento (hot reload)
dev:
	docker compose --profile dev up -d

# Inicia em modo produção
prod:
	docker compose --profile prod up -d

# Reinicia os containers em modo desenvolvimento
restart:
	docker compose stop && docker compose --profile dev up

# Para os containers sem remover
stop:
	docker compose stop

# Para e remove os containers
down:
	docker compose down

# Remove containers e volumes (CUIDADO: apaga dados do banco local)
down-v:
	docker compose down -v

# Reconstrói a imagem de produção
build:
	docker compose --profile prod build

# Reconstrói e sobe em produção
prod-build:
	docker compose --profile prod up -d --build

# Status dos containers
ps:
	docker compose ps

# Logs de todos os containers
logs:
	docker compose logs -f

# Logs apenas da aplicação (prod)
logs-app:
	docker compose logs -f app

# Logs apenas do dev
logs-dev:
	docker compose logs -f dev

# Logs apenas do banco
logs-db:
	docker compose logs -f db

# Exporta o banco para backups/penny_YYYY-MM-DD_HH-MM.sql
backup:
	mkdir -p backups
	docker exec penny_postgres pg_dump -U penny penny_db > backups/penny_$$(date +%Y-%m-%d_%H-%M).sql
	@echo "Backup salvo em backups/"

# Restaura o banco a partir de um arquivo (uso: make restore FILE=backups/penny_2024-01-01_12-00.sql)
restore:
	@test -n "$(FILE)" || (echo "Informe o arquivo: make restore FILE=backups/arquivo.sql" && exit 1)
	docker exec -i penny_postgres psql -U penny penny_db < $(FILE)
	@echo "Restore concluido a partir de $(FILE)"

# Backup local + upload para Google Drive
backup-cloud:
	bash scripts/backup-cloud.sh

# Restaura do backup mais recente no Drive (só age se banco estiver vazio; use FORCE=1 para forçar)
restore-cloud:
	bash scripts/restore-cloud.sh

# Verifica se o banco mudou e faz backup na nuvem se necessário
backup-if-changed:
	bash scripts/backup-if-changed.sh

# Instruções para configurar o rclone com Google Drive
setup-rclone:
	@echo ""
	@echo "=== Configurar rclone com Google Drive ==="
	@echo ""
	@echo "1. Instalar rclone:"
	@echo "   curl https://rclone.org/install.sh | sudo bash"
	@echo ""
	@echo "2. Configurar o remote 'gdrive':"
	@echo "   rclone config"
	@echo "   → New remote → name: gdrive → storage: drive → seguir o wizard OAuth"
	@echo ""
	@echo "3. Adicionar ao .env (opcional, esses são os padrões):"
	@echo "   RCLONE_REMOTE=gdrive"
	@echo "   RCLONE_PATH=penny/backups"
	@echo ""
	@echo "4. Copiar config para o projeto (necessário para o container dev):"
	@echo "   make setup-rclone-copy"
	@echo ""
	@echo "5. Testar:"
	@echo "   rclone lsd gdrive:"
	@echo ""

# Copia o rclone.conf do host para backups/ (usado pelo container dev)
setup-rclone-copy:
	mkdir -p backups
	cp ~/.config/rclone/rclone.conf backups/rclone.conf
	@echo "rclone.conf copiado para backups/rclone.conf"

# Popula o banco com conta BB, cartao Ourocard e categorias comuns
seed:
	pnpm tsx scripts/seed.ts

# Extrai lancamentos de uma fatura via IA e salva JSON (uso: make extract-fatura FILE=scripts/import/fatura.pdf)
extract-fatura:
	@test -n "$(FILE)" || (echo "Informe o arquivo: make extract-fatura FILE=scripts/import/fatura.pdf" && exit 1)
	pnpm tsx scripts/extract-fatura.ts $(FILE)

# Importa o JSON extraido para o banco (uso: make import-fatura FILE=scripts/import/fatura-2025-03.json)
import-fatura:
	@test -n "$(FILE)" || (echo "Informe o arquivo: make import-fatura FILE=scripts/import/fatura-2025-03.json" && exit 1)
	pnpm tsx scripts/import-fatura.ts $(FILE)

# Importa o arquivo OFX em scripts/import/fatura.ofx para o banco
import-ofx:
	pnpm tsx scripts/import-ofx.ts scripts/import/fatura.ofx
