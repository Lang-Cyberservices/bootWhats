# BootWhats

Bot do WhatsApp com filtro de mensagens, análise de imagens (NSFW) e comandos auxiliares, usando Evolution API, `nsfwjs` e Prisma + MariaDB.

**Resumo rápido**
1. Suba o MariaDB e a Evolution API (`docker compose`).
2. Copie `.env_example` para `.env` e ajuste `DATABASE_URL` e chaves.
3. Rode `npm install`.
4. Rode migrações do Prisma.
5. Inicie com `node index.js` e escaneie o QR gerado pela Evolution API.

## Requisitos
- Node.js **22 LTS** (recomendado para compatibilidade com `@tensorflow/tfjs-node`).
- MariaDB 10+ (ou via Docker).
- Docker Compose para o stack local da Evolution API.
- Python 3 (opcional, usado para LAION no score de imagens).
- Dependências nativas para `sharp` e `canvas` (instaladas via npm, geralmente já resolvem).

## Instalação
1. Instale dependências:
```bash
npm install
```

2. Configure variáveis de ambiente:
```bash
cp .env_example .env
```
Edite `.env` com os valores corretos (principalmente `DATABASE_URL` e `GEMINI_API_KEY`).

3. Suba o banco e a Evolution API:
```bash
docker compose up -d
```

4. Aplique migrações do Prisma:
```bash
npx prisma migrate deploy
```

## Executar
```bash
node index.js
```
No primeiro uso, o bot tenta garantir a instância da Evolution API, configura o webhook em `http://host.docker.internal:5000/evolution/webhook` (por padrão em dev) e imprime o QR no terminal.

## Ferramenta de gestão
O painel de gestão fica em `tools/gestao` e permite administrar admins, piadas, boas-vindas e status do sistema.

### Modo desenvolvedor (PHP embutido)
Para subir o painel localmente em modo desenvolvedor:
```bash
php -S localhost:8080 -t tools/gestao/public
```

## Variáveis de ambiente principais
Veja `.env_example` para todas as opções. As mais usadas:
- `DATABASE_URL`: conexão MariaDB.
- `APP_ENV`: `development` habilita logs extra.
- `DEV_GROUP_ID`: limita o bot a um grupo específico em dev.
- `NSFW_EVIDENCE_DIR`: pasta para salvar evidências de mídia bloqueada.
- `GEMINI_API_KEY` / `GEMINI_MODEL`: usados pelo serviço Oracle.
- `MAX_COMMANDS_PER_MINUTE`: rate limit dos comandos.
- `EVOLUTION_API_URL`: URL da Evolution API local.
- `EVOLUTION_GLOBAL_API_KEY`: chave global da Evolution API.
- `EVOLUTION_INSTANCE_NAME`: nome da instância usada pelo bot.
- `EVOLUTION_WEBHOOK_URL`: URL que a Evolution API vai chamar para entregar eventos.
- `EVOLUTION_WEBHOOK_SECRET`: segredo opcional validado pelo endpoint `/evolution/webhook`.

## Ferramenta de validação de imagem (`tools/validate_evidence_md5.js`)
Esta ferramenta analisa uma imagem local, calcula o `md5`, gera as notas (scores) e indica se a imagem seria bloqueada pela lógica atual.

### Uso
```bash
node tools/validate_evidence_md5.js /caminho/da/imagem.webp
```

### Saída
Retorna um JSON com campos como:
- `md5`: hash do arquivo.
- `pornScore`, `sexyScore`, `hentaiScore`, `neutralScore`, `nsfwScore`.
- `laionScore` (se aplicável).
- `blocked`: `true`, `false` ou `null` (quando o LAION falha).
- `reason`: `NSFWJS`, `LAION`, `LAION_PASS`, `LAION_ERROR`, etc.

### Observações sobre o LAION
Quando `nsfwScore` está entre `0.60` e `0.95`, a lógica atual chama o LAION.
Se o LAION falhar, a ferramenta retorna `blocked: null` e `reason: LAION_ERROR`.

Para habilitar o LAION localmente, instale `torch` em um venv e aponte o Python:
```bash
python3 -m venv .venv
./.venv/bin/pip install torch torchvision
LAION_PYTHON=./.venv/bin/python node tools/validate_evidence_md5.js /caminho/da/imagem.webp
```

Você também pode ajustar:
- `LAION_PYTHON` (default `python3`)
- `LAION_SCRIPT` (default `tools/laion_score.py`)
- `LAION_THRESHOLD` (default `0.5`)

## Estrutura (alto nível)
- `index.js`: entrada do bot.
- `services/`: serviços (filtros, análise de imagem, logger, comandos).
- `models/`: modelo NSFWJS.
- `prisma/`: schema e migrações.
- `tools/`: utilitários (incluindo a validação de imagens).

## Dev com Docker
O `docker-compose.yml` sobe:
- `mariadb` para o Prisma.
- `evolution-api` em `http://localhost:8080`.
- `evolution-manager` em `http://localhost:3000`.
- `evolution-redis` e `evolution-postgres` como dependências da Evolution.

Fluxo sugerido:
1. `docker compose up -d`
2. `npm install`
3. `npx prisma migrate deploy`
4. `node index.js`
5. Escaneie o QR exibido no terminal do bot.

## Problemas comuns
**Erro `DATABASE_URL não foi definida no .env`**
- Verifique se `.env` existe na raiz e contém `DATABASE_URL`.

**Erro em `@tensorflow/tfjs-node`**
- Use Node 20 LTS. Node 22/24 pode quebrar com `tfjs-node`.

---
Se quiser, posso incluir um script `npm` para rodar a ferramenta de validação com atalho.
