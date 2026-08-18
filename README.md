# BootWhats

Bot do WhatsApp com filtro de mensagens, análise de imagens (NSFW) e comandos auxiliares, usando `whatsapp-web.js`, `nsfwjs` e Prisma + MariaDB.

**Resumo rápido**
1. Suba o MariaDB (docker compose).
2. Copie `.env_example` para `.env` e ajuste `DATABASE_URL` e chaves.
3. Rode `npm install`.
4. Rode migrações do Prisma.
5. Inicie com `node index.js` e escaneie o QR.

## Requisitos
- Node.js **22 LTS** (recomendado para compatibilidade com `@tensorflow/tfjs-node`).
- MariaDB 10+ (ou via Docker).
- Chave da API do Google Cloud Vision (`GOOGLE_VISION_API_KEY`) para a segunda opinião do score de imagens.
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

3. Suba o banco (opção com Docker):
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
No primeiro uso, escaneie o QR do WhatsApp Web. O estado da sessão fica em `.wwebjs_auth`.

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
- `safeSearch`: os cinco níveis devolvidos pelo Google Vision (`adult`, `racy`, `violence`, `spoof`, `medical`).
- `blocked`: `true`, `false` ou `null` (quando o Vision falha).
- `reason`: `NSFWJS_PASS`, `VISION`, `VISION_PASS`, `VISION_ERROR`, `UNSUPPORTED_FORMAT`.

### Observações sobre o Google Vision
Abaixo de `NSFW_VISION_GATE` (padrão `0.3`) o NSFWJS libera sozinho. Acima do portão quem decide é
sempre o Vision, que bloqueia quando `adult` ou `racy` chega ao nível configurado (padrão `LIKELY`).
Se o Vision falhar, a ferramenta retorna `blocked: null` e `reason: VISION_ERROR` — e, em produção, o
job é retentado sem apagar nada.

```bash
GOOGLE_VISION_API_KEY=sua_chave node tools/validate_evidence_md5.js /caminho/da/imagem.webp
```

Você também pode ajustar:
- `NSFW_VISION_GATE` (default `0.3`)
- `GOOGLE_VISION_ADULT_LEVEL` / `GOOGLE_VISION_RACY_LEVEL` (default `LIKELY`)
- `GOOGLE_VISION_TIMEOUT_MS` (default `15000`)

## Estrutura (alto nível)
- `index.js`: entrada do bot.
- `services/`: serviços (filtros, análise de imagem, logger, comandos).
- `models/`: modelo NSFWJS.
- `prisma/`: schema e migrações.
- `tools/`: utilitários (incluindo a validação de imagens).

## Problemas comuns
**Erro `DATABASE_URL não foi definida no .env`**
- Verifique se `.env` existe na raiz e contém `DATABASE_URL`.

**Erro em `@tensorflow/tfjs-node`**
- Use Node 20 LTS. Node 22/24 pode quebrar com `tfjs-node`.

---
Se quiser, posso incluir um script `npm` para rodar a ferramenta de validação com atalho.
