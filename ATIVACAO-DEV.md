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

### `LAION_VARIANT` — atenção, muda comportamento

O padrão passou a ser `b32`, com o QuickGELU corrigido. Isso **altera a escala dos scores do LAION**
em relação ao que roda hoje. Na mesma imagem de teste: 0,0617 antes, 0,4804 depois.

Se quiser congelar o comportamento antigo enquanto calibra:

```
LAION_VARIANT=b32-legacy
```

### `LAION_THRESHOLD` — precisa ser recalibrado

O valor atual (`0.03`) foi escolhido para compensar os embeddings quebrados. Com a variante
corrigida ele bloqueia quase tudo. O worker avisa no boot se detectar essa combinação.

Não existe limiar recomendado pelo LAION — o número tem que sair da medição (passo 5).

### Opcionais

Estão todas documentadas no `.env_example`. As que valem conhecer:

| Variável | Padrão | Para quê |
|---|---|---|
| `IMAGE_ANALYSIS_MODE` | `queue` | `inline` volta ao comportamento antigo, analisando dentro do bot. Escape de emergência. |
| `MEDIA_SPOOL_DIR` | `./storage/spool` | Onde o bot guarda a mídia até o worker consumir. Criada sozinha. |
| `LAION_IDLE_SHUTDOWN_MS` | `1800000` | Desliga o Python após 30 min sem uso e devolve ~1,5 GB. `0` nunca desliga. |
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
node tools/nsfw_eval.js storage/eval --models=inception_v3,mobilenet_v2_mid --variants=b32-legacy,b32,l14
```

A primeira rodada gera `storage/eval/labels.csv` com todos os scores e a coluna `label` vazia.
Preencha com `nsfw` ou `ok` e rode de novo — aí saem matriz de confusão, varredura de limiares e o
teste da hipótese do `Sexy`. Rótulo já preenchido nunca é sobrescrito.

Cada variante do LAION carrega o CLIP uma vez, o que leva cerca de 90 s. Três variantes = uns 5
minutos de espera antes dos resultados, independente do tamanho da pasta.

### O que cada eixo compara

**`--models`** é o portão principal, que decide a maioria dos casos sozinho:

| Modelo | O que é |
|---|---|
| `inception_v3` | v1.0 do `nsfw_model`, o que produção usa hoje. Não existe versão mais nova dele. |
| `mobilenet_v2_mid` | release v1.1.0 (2020) do mesmo autor, arquitetura diferente. Vem empacotado no `nsfwjs`, sem download. |

**`--variants`** é a segunda opinião do LAION, consultada só na faixa cinzenta (`nsfwScore` entre
0,65 e 0,95). Ver a tabela do passo 2.

Ambos os modelos são de 2019–2020. Se nenhum dos dois resolver, o caminho seria um classificador
ViT atual — fora do escopo desta branch.

**Aviso sobre a variante `l14`:** ela baixa ~890 MB de pesos na primeira execução e o processo chega
a **2,9 GB de RSS**. Confira a RAM antes de cogitar isso em produção.

## 6. Antes de mandar para produção

- [ ] Limiares escolhidos pela medição do passo 5 e gravados no `.env` do servidor
- [ ] Decidir `LAION_VARIANT` (`b32-legacy` mantém o comportamento atual; `b32` é o corrigido)
- [ ] **Rodar `pm2 delete bootwhats` no servidor, uma única vez.** A entrada antiga foi criada com
      `pm2 start index.js --name bootwhats` e ficaria pendurada ao lado das duas do
      `ecosystem.config.js`. O deploy automático já foi ajustado para
      `pm2 startOrReload ecosystem.config.js`.

## Notas

**Node 22.** O `.node-version` fixa a 22 LTS e o `CLAUDE.md` avisa que o `@tensorflow/tfjs-node` pode
quebrar em 24+. Rodou normal no 24 durante os testes, mas se aparecer erro estranho de módulo nativo
é o primeiro lugar para olhar.

**Rede.** O sidecar do LAION baixa os pesos do Hugging Face e a cabeça de classificação do
`raw.githubusercontent.com` na primeira execução de cada variante. Já vem com retry e backoff — o
GitHub devolve 429/503 com facilidade. Depois de cacheado o único acesso externo é uma checagem no
Hub ao subir; `HF_HUB_OFFLINE=1` elimina até isso.

**Nenhuma imagem sai da máquina.** O que trafega é só download de modelo.

## Fora de escopo, para depois

- O `Sexy` entra no bloqueio automático com o mesmo peso de `Porn`. O passo 5 responde se é a origem
  dos falsos positivos; se for, a correção não envolve trocar modelo.
- O `nsfw_testset.zip` do LAION, anotado à mão pelos autores do modelo, daria um limiar de referência
  independente das suas imagens.
- Trocar o portão principal por um classificador ViT moderno. Os dois modelos disponíveis hoje são de
  2019 e 2020; o sidecar persistente já tornou um modelo maior viável em custo.
