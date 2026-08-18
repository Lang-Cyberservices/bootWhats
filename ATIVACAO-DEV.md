# Ativação em máquina de desenvolvimento

Passos para colocar a branch `feat/analise-imagens-worker` para rodar. Nenhuma dependência nova de
npm ou de Python foi adicionada — o `package.json` não mudou.

A mudança que mais afeta o dia a dia: **agora são dois processos.** Rodar só `node index.js` deixa o
bot funcionando, mas sem moderar imagem nenhuma — as imagens entram na fila e ficam lá esperando
alguém consumir.

---

## 1. Banco de dados

Duas migrações novas. Sem elas o bot sobe e quebra ao enfileirar a primeira imagem.

```bash
docker compose up -d
```

```bash
npx prisma migrate deploy && npx prisma generate
```

O que entra:
- `media_analysis_jobs` — a fila de análise
- `media_hashes.fileHash` — coluna nova, permite reconhecer imagem já julgada antes de baixar

## 2. Variáveis de ambiente

**Todas têm valor padrão no código**, então o bot sobe sem você tocar no `.env`. Mas duas decisões
são suas:

### `GOOGLE_VISION_API_KEY` — sem ela a moderação não decide nada

O NSFWJS não bloqueia sozinho: acima de `NSFW_VISION_GATE` quem decide é o Google Vision. Sem chave,
todo job nessa faixa é retentado `JOB_MAX_ATTEMPTS` vezes, vira `failed` e a mensagem **não** é
apagada. O worker avisa no boot.

### `NSFW_VISION_GATE` e os níveis do Vision

`NSFW_VISION_GATE` (padrão `0.3`) é o portão: abaixo dele o NSFWJS libera sem gastar requisição.
`GOOGLE_VISION_ADULT_LEVEL` e `GOOGLE_VISION_RACY_LEVEL` (padrão `LIKELY`) definem a partir de qual
nível da escala do Google se bloqueia — `VERY_UNLIKELY`, `UNLIKELY`, `POSSIBLE`, `LIKELY`,
`VERY_LIKELY`, do mais fraco ao mais forte.

Baixar o portão significa mais requisições e mais custo; subir significa confiar mais no NSFWJS
sozinho para liberar. O número sai da medição (passo 5).

### Opcionais

Estão todas documentadas no `.env_example`. As que valem conhecer:

| Variável | Padrão | Para quê |
|---|---|---|
| `IMAGE_ANALYSIS_MODE` | `queue` | `inline` volta ao comportamento antigo, analisando dentro do bot. Escape de emergência. |
| `MEDIA_SPOOL_DIR` | `./storage/spool` | Onde o bot guarda a mídia até o worker consumir. Criada sozinha. |
| `GOOGLE_VISION_TIMEOUT_MS` | `15000` | Teto da chamada ao Vision. Estourou, o job é retentado. |
| `ANALYZER_MAX_JOBS_BEFORE_EXIT` | `500` | Worker sai a cada N jobs para zerar memória nativa do TF; o PM2 sobe de volta. |
| `CLIENT_DESTROY_TIMEOUT_MS` | `30000` | Espera pelo `client.destroy()` antes de matar o Chromium à força. |

## 3. Subir os dois processos

Em desenvolvimento, dois terminais. Terminal A, o analisador:

```bash
APP_ENV=development node services/analyzer/worker.js
```

Terminal B, o bot:

```bash
APP_ENV=development node index.js
```

Ou os dois de uma vez, como roda em produção:

```bash
pm2 start ecosystem.config.js
```

### O que confirmar nos logs

No bot, ao subir: `🖼️ Análise de imagens delegada ao worker (fila no banco)` e `⚖️ Entregador de
vereditos ativo`. **Se aparecer o modelo de IA carregando no processo do bot, algo está errado** —
isso é responsabilidade exclusiva do worker.

No worker: `✅ Modelo de IA carregado no worker` e `🖼️ Worker de análise de imagens ATIVO`.

Postando uma imagem no grupo de dev, o bot loga `Enfileirando mídia de:` e responde na hora; o worker
loga `Job N (hash): ok — NSFWJS_PASS` alguns segundos depois. Repostando a mesma imagem, se aparecer
`Mídia reconhecida pelo filehash (sem download)`, o dedup pré-download está funcionando na sua build
do WhatsApp Web — se nunca aparecer, o fallback assumiu e funciona igual, só sem economizar o
download.

## 4. Inspecionar a fila

```bash
node -e "require('dotenv').config();const{prisma}=require('./services/database');prisma.mediaAnalysisJob.findMany({orderBy:{id:'desc'},take:10,select:{id:1,status:1,isNsfw:1,attempts:1,deliveredAt:1,error:1}}).then(r=>{console.table(r);process.exit(0)})"
```

Estados: `pending` → `processing` → `done`. `failed` significa que esgotou as tentativas — a coluna
`error` diz por quê. `deliveredAt` preenchido quer dizer que o bot já agiu (ou já registrou que não
conseguiu apagar).

## 5. Calibrar os limiares

É o passo que resolve o problema de precisão. O avaliador é **somente leitura**: não apaga imagem,
não escreve no banco, não fala com o WhatsApp.

```bash
mkdir -p storage/eval
```

Coloque em `storage/eval` **os dois tipos** de imagem: as que deveriam ser bloqueadas e as inocentes
que você suspeita terem sido bloqueadas por engano. Sem os dois lados a matriz não mede falso
positivo, que é provavelmente o problema principal.

```bash
node tools/nsfw_eval.js storage/eval --models=inception_v3,mobilenet_v2_mid --limiar=0,3
```

A primeira rodada gera `storage/eval/labels.csv` com todos os scores e a coluna `label` vazia.
Preencha com `nsfw` ou `ok` e rode de novo — aí saem matriz de confusão, varredura de limiares e o
teste da hipótese do `Sexy`. Rótulo já preenchido nunca é sobrescrito. O CSV sai no padrão pt-BR:
separador `;` e vírgula decimal, para abrir direto no Excel.

O avaliador **não chama o Vision** — rotular um corpus não deve custar requisição. Ele mede o
NSFWJS sozinho, que é justamente o que define o portão `NSFW_VISION_GATE`: um limiar mais baixo
manda mais imagem para a API.

### O que comparar

| Modelo | O que é |
|---|---|
| `inception_v3` | v1.0 do `nsfw_model`, o que produção usa hoje. Não existe versão mais nova dele. |
| `mobilenet_v2_mid` | release v1.1.0 (2020) do mesmo autor, arquitetura diferente. Vem empacotado no `nsfwjs`, sem download. |

Ambos são de 2019–2020. Como agora eles só decidem a liberação (o bloqueio é sempre do Vision), o
que importa medir neles é o falso negativo: imagem imprópria que fica abaixo do portão nunca chega
a ser vista pelo Google.

## 6. Antes de mandar para produção

- [ ] Limiares escolhidos pela medição do passo 5 e gravados no `.env` do servidor
- [ ] `GOOGLE_VISION_API_KEY` no `.env` do servidor, com a Vision API habilitada no projeto do GCP
      e faturamento ativo — sem isso a moderação não bloqueia nada
- [ ] Decidir `GOOGLE_VISION_ADULT_LEVEL` / `GOOGLE_VISION_RACY_LEVEL` (padrão `LIKELY` nos dois)
- [ ] **Rodar `pm2 delete bootwhats` no servidor, uma única vez.** A entrada antiga foi criada com
      `pm2 start index.js --name bootwhats` e ficaria pendurada ao lado das duas do
      `ecosystem.config.js`. O deploy automático já foi ajustado para
      `pm2 startOrReload ecosystem.config.js`.

## Notas

**Node 22.** O `.node-version` fixa a 22 LTS e o `CLAUDE.md` avisa que o `@tensorflow/tfjs-node` pode
quebrar em 24+. Rodou normal no 24 durante os testes, mas se aparecer erro estranho de módulo nativo
é o primeiro lugar para olhar.

**Imagens passaram a sair da máquina.** Isto mudou com o Vision e vale dizer em voz alta: toda
imagem acima do portão é enviada ao Google, redimensionada para no máximo 1024px e em JPEG. Antes,
com o LAION local, nada trafegava além do download dos pesos. Quem baixa o portão aumenta o volume
de imagens de terceiros enviadas a uma API externa — é uma decisão de privacidade, não só de custo.

**Custo.** O SafeSearch é cobrado por requisição (as primeiras 1.000/mês são gratuitas). O cache de
`media_hashes`, por `fileHash` e por md5, é o que segura a conta: imagem repetida não é reanalisada.
No corpus de referência (254 imagens do dump), 18 ficaram acima de 0,3 — cerca de 7%.

## Fora de escopo, para depois

- O `Sexy` entra no bloqueio automático com o mesmo peso de `Porn`. O passo 5 responde se é a origem
  dos falsos positivos; se for, a correção não envolve trocar modelo.
- Trocar o portão principal por um classificador ViT moderno. Os dois modelos disponíveis hoje são de
  2019 e 2020, e agora eles só decidem o que **não** vai para o Vision.
- Guardar o nível do Vision no `media_hashes` (hoje o cache só grava o booleano), para dar para
  auditar por que um md5 foi bloqueado sem procurar o job correspondente.
