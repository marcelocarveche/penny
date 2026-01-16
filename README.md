<img width="1190" alt="maybe_hero" src="https://github.com/user-attachments/assets/5ed08763-a9ee-42b2-a436-e05038fcf573" />

# Penny: Gerenciador de Finanças Pessoais

**Aplicativo de finanças pessoais em português brasileiro com suporte a Real (BRL)**

---

## ⚖️ Atribuição e Licença

> [!IMPORTANT]
> Este projeto é um **fork** do [Maybe Finance](https://github.com/maybe-finance/maybe)
> licenciado sob **AGPLv3**.
>
> Este fork **NÃO é afiliado, associado, autorizado, endossado por, ou de qualquer
> forma oficialmente conectado** com Maybe Finance Inc.
>
> "Maybe" é uma **marca registrada** da Maybe Finance Inc. Este projeto usa o nome
> "Penny" para evitar confusão de marcas.

### Modificações neste Fork:

- ✅ Moeda padrão alterada para Real Brasileiro (BRL)
- ✅ Interface traduzida para Português (pt-BR)
- ✅ Configurações localizadas para o Brasil
- ✅ Mantém 100% do código original disponível (AGPLv3)

> **Nota Técnica:** O código interno mantém referências ao módulo "Maybe" para
> compatibilidade do Rails. O nome "Penny" é usado apenas no branding e documentação.

### Código-Fonte

Conforme exigido pela licença AGPLv3, o código-fonte completo incluindo todas as
modificações está disponível em: https://github.com/marcelocarveche/penny

---

## 🚀 Hospedagem Docker

Penny é um aplicativo totalmente funcional que pode ser [auto-hospedado com Docker](docs/hosting/docker.md).

## 💻 Setup para Desenvolvimento Local

**Se você quer apenas _hospedar_ o Penny, pare aqui e
[leia este guia](docs/hosting/docker.md).**

As instruções abaixo são para desenvolvedores que querem contribuir.

### Requisitos

- Ruby (veja arquivo `.ruby-version`)
- PostgreSQL >9.3 (preferencialmente versão estável mais recente)

### Comandos de Setup

```sh
cd maybe
cp .env.local.example .env.local
bin/setup
bin/dev

# Opcional: carregar dados de demonstração
rake demo_data:default
```

Acesse http://localhost:3000 e use as credenciais:

- Email: `user@maybe.local`
- Senha: `password`

For further instructions, see guides below.

### Setup Guides

- [Mac dev setup guide](https://github.com/maybe-finance/maybe/wiki/Mac-Dev-Setup-Guide)
- [Linux dev setup guide](https://github.com/maybe-finance/maybe/wiki/Linux-Dev-Setup-Guide)
- [Windows dev setup guide](https://github.com/maybe-finance/maybe/wiki/Windows-Dev-Setup-Guide)
- Dev containers - visit [this guide](https://code.visualstudio.com/docs/devcontainers/containers) to learn more

## 📄 Copyright & Licença

### Licença Original (Maybe Finance)

O código-fonte original do Maybe é distribuído sob
[licença AGPLv3](https://github.com/maybe-finance/maybe/blob/main/LICENSE).

"Maybe" é uma marca registrada da Maybe Finance, Inc.

### Este Fork (Penny)

Penny é distribuído sob a mesma [licença AGPLv3](LICENSE).

Copyright do código original © Maybe Finance, Inc.  
Modificações © 2026 Marcelo Carveche

Este software é fornecido "como está", sem garantias de qualquer tipo.
