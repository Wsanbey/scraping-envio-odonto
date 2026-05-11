/**
 * status-db.js — Relatório visual do banco de dados scrapin.db
 *
 * Uso: npm run status
 *
 * Exibe:
 *  - Contagem de URLs por status
 *  - Últimas URLs com erro (para diagnóstico)
 *  - Últimas URLs enviadas com link do WooCommerce (para conferência)
 */

const { getResumo, getUrlsComErro, getUrlsEnviadas } = require('./db');

const CORES = {
    reset:    '\x1b[0m',
    bold:     '\x1b[1m',
    verde:    '\x1b[32m',
    amarelo:  '\x1b[33m',
    vermelho: '\x1b[31m',
    azul:     '\x1b[34m',
    cinza:    '\x1b[90m',
};

function cor(texto, estilo) {
    return `${estilo}${texto}${CORES.reset}`;
}

function iconeStatus(status) {
    switch (status) {
        case 'pendente':  return '🕐';
        case 'scraping':  return '⚙️ ';
        case 'enviado':   return '✅';
        case 'erro':      return '❌';
        default:          return '❓';
    }
}

function corStatus(status) {
    switch (status) {
        case 'pendente':  return CORES.amarelo;
        case 'scraping':  return CORES.azul;
        case 'enviado':   return CORES.verde;
        case 'erro':      return CORES.vermelho;
        default:          return CORES.cinza;
    }
}

function formatarData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function truncar(texto, max = 70) {
    if (!texto) return '—';
    return texto.length > max ? texto.slice(0, max - 3) + '...' : texto;
}

function main() {
    console.log('');
    console.log(cor('════════════════════════════════════════════════════', CORES.bold));
    console.log(cor('  STATUS DO BANCO DE DADOS — scrapin.db', CORES.bold));
    console.log(cor('════════════════════════════════════════════════════', CORES.bold));

    // ── Resumo por status ──
    const resumo = getResumo();

    if (resumo.length === 0) {
        console.log('\n  ⚠️  Banco vazio. Execute "npm run importar" primeiro.\n');
        process.exit(0);
    }

    console.log('');
    let total = 0;
    for (const linha of resumo) {
        const icone = iconeStatus(linha.status);
        const label = cor(linha.status.padEnd(10), corStatus(linha.status));
        const qtd   = cor(String(linha.total).padStart(5), CORES.bold);
        console.log(`  ${icone}  ${label}  ${qtd} URL(s)`);
        total += linha.total;
    }
    console.log('');
    console.log(`  ${'TOTAL'.padEnd(12)}  ${cor(String(total).padStart(5), CORES.bold)} URL(s)`);

    // ── URLs enviadas recentemente ──
    const enviadas = getUrlsEnviadas(10);
    if (enviadas.length > 0) {
        console.log('');
        console.log(cor('────────────────────────────────────────────────────', CORES.cinza));
        console.log(cor('  ÚLTIMAS ENVIADAS AO WOOCOMMERCE (conferência)', CORES.verde));
        console.log(cor('────────────────────────────────────────────────────', CORES.cinza));
        for (const item of enviadas) {
            console.log('');
            console.log(`  ID: ${item.id}  |  Produto WooCommerce #${item.woo_product_id}`);
            console.log(`  ${cor('Origem :', CORES.cinza)} ${truncar(item.url, 80)}`);
            console.log(`  ${cor('Link   :', CORES.verde)} ${item.woo_url || '(sem link salvo)'}`);
            console.log(`  ${cor('Enviado:', CORES.cinza)} ${formatarData(item.enviado_em)}`);
        }
    }

    // ── URLs com erro ──
    const erros = getUrlsComErro(10);
    if (erros.length > 0) {
        console.log('');
        console.log(cor('────────────────────────────────────────────────────', CORES.cinza));
        console.log(cor('  URLs COM ERRO (últimas 10)', CORES.vermelho));
        console.log(cor('────────────────────────────────────────────────────', CORES.cinza));
        for (const item of erros) {
            console.log('');
            console.log(`  ID: ${item.id}  |  Tentativas: ${item.tentativas}`);
            console.log(`  ${cor('URL  :', CORES.cinza)} ${truncar(item.url, 80)}`);
            console.log(`  ${cor('Erro :', CORES.vermelho)} ${truncar(item.erro_msg, 80)}`);
        }
        console.log('');
        console.log(cor('  Dica: Para retentar os erros, edite o status delas de volta para "pendente".', CORES.cinza));
    }

    console.log('');
    console.log(cor('════════════════════════════════════════════════════', CORES.bold));
    console.log('');
}

main();
