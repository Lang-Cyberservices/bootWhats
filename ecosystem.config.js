// Dois processos: o bot (WhatsApp/Puppeteer, só I/O) e o analisador de imagens
// (sharp + tfjs-node). O split existe porque a inferência
// bloqueia o event loop de quem a executa — rodando junto, ela sufocava a ponte
// CDP com o Chromium e as respostas do bot chegavam a demorar minutos.
module.exports = {
    apps: [
        {
            name: 'bootwhats',
            script: 'index.js',
            time: true,
            autorestart: true,
            max_restarts: 20,
            max_memory_restart: '1500M'
        },
        {
            name: 'bootwhats-analyzer',
            script: 'services/analyzer/worker.js',
            time: true,
            autorestart: true,
            max_restarts: 50,
            // O worker sai sozinho a cada ANALYZER_MAX_JOBS_BEFORE_EXIT jobs para
            // zerar memória nativa do TF; o PM2 sobe de volta.
            // Era 2G para acomodar o CLIP do LAION; sem o sidecar Python sobra só
            // o tfjs-node.
            max_memory_restart: '1G',
            env: {
                // Sem teto, o TF pega TODOS os cores e mata o bot de fome.
                TF_NUM_INTRAOP_THREADS: '2',
                TF_NUM_INTEROP_THREADS: '1',
                OMP_NUM_THREADS: '2',
                UV_THREADPOOL_SIZE: '2'
            }
        }
    ]
};
