.PHONY: dev prod stop down logs logs-app logs-dev ps build backup restore

# Inicia em modo desenvolvimento (hot reload)
dev:
	docker compose --profile dev up

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
