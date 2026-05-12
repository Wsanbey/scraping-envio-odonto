/**
 * woo.js — Módulo de envio de produtos ao WooCommerce via REST API
 *
 * Suporta:
 *  - Produtos simples
 *  - Produtos compostos (variáveis com variantes)
 *  - DRY_RUN: simula o envio sem tocar na API real
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

// ─────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────
const WOO_URL        = (process.env.WOO_URL || '').replace(/\/$/, '');
const CONSUMER_KEY   = process.env.WOO_CONSUMER_KEY   || '';
const CONSUMER_SECRET= process.env.WOO_CONSUMER_SECRET|| '';
const DRY_RUN        = process.env.DRY_RUN !== 'false'; // padrão: true (seguro)

if (!WOO_URL || !CONSUMER_KEY || !CONSUMER_SECRET) {
    console.warn('  ⚠️  woo.js: Credenciais não configuradas no .env!');
}

// Cliente HTTP pré-configurado com autenticação Basic
const api = axios.create({
    baseURL: `${WOO_URL}/wp-json/wc/v3`,
    auth: { username: CONSUMER_KEY, password: CONSUMER_SECRET },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000
});
// Cache de categorias para evitar requisições repetidas
const categoryCache = {};

// ─────────────────────────────────────────────
// Funções auxiliares
// ─────────────────────────────────────────────

/**
 * Converte preço em formato brasileiro para string decimal.
 * Ex: "R$ 180,19" → "180.19"
 *     "R$ 1.234,56" → "1234.56"
 */
function parsePreco(precoStr) {
    if (!precoStr || precoStr === 'indisponivel') return '';
    const limpo = precoStr
        .replace(/R\$\s*/g, '')   // remove "R$"
        .replace(/\./g, '')        // remove separador de milhar
        .replace(',', '.')         // vírgula decimal → ponto
        .trim();
    const num = parseFloat(limpo);
    return isNaN(num) ? '' : num.toFixed(2);
}

/**
 * Extrai apenas o número do código do produto.
 * Ex: "Código do produto: 4023" → "4023"
 */
function parseCodigo(codigoStr) {
    if (!codigoStr || codigoStr === 'indisponivel') return '';
    const match = codigoStr.match(/[\d]+/);
    return match ? match[0] : codigoStr;
}

/**
 * Monta o array de imagens no formato esperado pela API do WooCommerce.
 * Substitui tamanhos miniaturas (ex: _50x50.png, _100x100.png) por 800x800
 * para garantir imagens em alta resolução no WooCommerce.
 */
function montarImagens(imagensUrls) {
    return imagensUrls
        .filter(src => src && !src.includes('data:'))
        .map(src => ({
            src: src.replace(/_\d+x\d+\.png$/, '_800x800.png')
        }));
}

/**
 * Garante que as categorias existam no WooCommerce e retorna seus IDs.
 * Suporta hierarquia baseada na ordem do array.
 */
async function obterOuCriarCategorias(nomes) {
    if (!nomes || nomes.length === 0) return [];

    const ids = [];
    let lastParentId = 0;

    for (const nome of nomes) {
        const cacheKey = `${lastParentId}:${nome.toLowerCase()}`;
        
        if (categoryCache[cacheKey]) {
            lastParentId = categoryCache[cacheKey];
            ids.push({ id: lastParentId });
            continue;
        }

        if (DRY_RUN) {
            // No modo simulação, gera um ID fictício
            lastParentId = Math.floor(Math.random() * 1000) + 500;
            categoryCache[cacheKey] = lastParentId;
            ids.push({ id: lastParentId });
            continue;
        }

        try {
            // 1. Tenta buscar a categoria pelo nome e pai
            const resp = await api.get('/products/categories', {
                params: { per_page: 100, parent: lastParentId }
            });

            const existente = resp.data.find(c => c.name.trim().toLowerCase() === nome.toLowerCase());

            if (existente) {
                lastParentId = existente.id;
            } else {
                // 2. Se não existir, tenta criar
                try {
                    const createResp = await api.post('/products/categories', {
                        name: nome,
                        parent: lastParentId
                    });
                    lastParentId = createResp.data.id;
                } catch (createErr) {
                    // Caso ocorra erro de concorrência (já criado por outra tarefa simultânea)
                    if (createErr.response && createErr.response.data && createErr.response.data.code === 'term_exists') {
                        lastParentId = createErr.response.data.data.resource_id;
                    } else {
                        throw createErr;
                    }
                }
            }

            categoryCache[cacheKey] = lastParentId;
            ids.push({ id: lastParentId });

        } catch (err) {
            const msg = err.response ? JSON.stringify(err.response.data) : err.message;
            console.warn(`    ⚠️  Aviso: Falha ao processar categoria "${nome}": ${msg}`);
            // Em caso de erro, continua sem essa categoria ou tenta a próxima
        }
    }

    return ids;
}

// ─────────────────────────────────────────────
// Envio de produto SIMPLES
// ─────────────────────────────────────────────

async function enviarSimples(dados) {
    const preco  = parsePreco(dados.precoVista);
    const sku    = parseCodigo(dados.codigo);
    const imagens= montarImagens(dados.imagens || []);
    
    // Processa categorias
    const categoriasIds = await obterOuCriarCategorias(dados.categorias);

    const payload = {
        name:               dados.nome,
        type:               'simple',
        status:             'publish',
        regular_price:      preco,
        sku:                sku,
        description:        dados.descricao   !== 'indisponivel' ? dados.descricao   : '',
        short_description:  dados.embalagem   !== 'indisponivel' ? dados.embalagem   : '',
        manage_stock:       dados.estoqueMax  > 0,
        stock_quantity:     dados.estoqueMax  > 0 ? dados.estoqueMax : null,
        images:             imagens,
        categories:         categoriasIds
    };

    if (DRY_RUN) {
        return simularEnvio('simples', payload);
    }

    const response = await api.post('/products', payload);
    return { id: response.data.id, permalink: response.data.permalink };
}

// ─────────────────────────────────────────────
// Envio de produto COMPOSTO (variável)
// ─────────────────────────────────────────────

async function enviarComposto(dados) {
    const imagens = montarImagens(dados.imagens || []);
    const sku     = parseCodigo(dados.codigo);

    // Processa categorias
    const categoriasIds = await obterOuCriarCategorias(dados.categorias);

    // 1. Cria o produto pai com tipo "variable"
    const payloadPai = {
        name:               dados.nome,
        type:               'variable',
        status:             'publish',
        sku:                sku,
        description:        dados.descricao  !== 'indisponivel' ? dados.descricao  : '',
        short_description:  dados.embalagem  !== 'indisponivel' ? dados.embalagem  : '',
        images:             imagens,
        categories:         categoriasIds,
        attributes: [{
            name:    'Variante',
            visible: true,
            variation: true,
            options: dados.variantes.map(v => v.nome).filter(n => n !== 'indisponivel')
        }]
    };

    let produtoPai;

    if (DRY_RUN) {
        produtoPai = simularEnvio('composto-pai', payloadPai);
    } else {
        const respPai = await api.post('/products', payloadPai);
        produtoPai = { id: respPai.data.id, permalink: respPai.data.permalink };
    }

    // 2. Cria cada variante
    for (const variante of dados.variantes) {
        const precoVar = parsePreco(variante.preco);
        const skuVar   = parseCodigo(variante.codigo);

        const payloadVar = {
            status:         'publish',
            regular_price:  precoVar,
            sku:            skuVar,
            manage_stock:   variante.estoqueMax > 0,
            stock_quantity: variante.estoqueMax > 0 ? variante.estoqueMax : null,
            attributes: [{
                name:   'Variante',
                option: variante.nome !== 'indisponivel' ? variante.nome : 'Padrão'
            }]
        };

        if (DRY_RUN) {
            console.log(`    [DRY RUN] Variante "${variante.nome}": preço=${precoVar} sku=${skuVar} estoque=${variante.estoqueMax}`);
        } else {
            await api.post(`/products/${produtoPai.id}/variations`, payloadVar);
        }
    }

    return produtoPai;
}

// ─────────────────────────────────────────────
// Função principal de envio (roteador)
// ─────────────────────────────────────────────

/**
 * Envia um produto ao WooCommerce (simples ou composto).
 * @param {Object} dados — Resultado do scrapePage()
 * @returns {{ id: number, permalink: string }}
 */
async function enviarProduto(dados) {
    if (dados.tipo === 'composto' && dados.variantes.length > 0) {
        return await enviarComposto(dados);
    }
    return await enviarSimples(dados);
}

// ─────────────────────────────────────────────
// DRY RUN — simulação sem API real
// ─────────────────────────────────────────────

function simularEnvio(tipo, payload) {
    const fakeId = Math.floor(Math.random() * 90000) + 10000;
    console.log(`    [DRY RUN] Tipo: ${tipo}`);
    console.log(`    [DRY RUN] Nome: ${payload.name}`);
    console.log(`    [DRY RUN] SKU: ${payload.sku || '(sem sku)'}`);
    console.log(`    [DRY RUN] Preço: R$ ${payload.regular_price || '(sem preço)'}`);
    console.log(`    [DRY RUN] Imagens: ${(payload.images || []).length}`);
    if (payload.type === 'variable') {
        console.log(`    [DRY RUN] Atributos: ${payload.attributes?.[0]?.options?.join(', ')}`);
    }
    console.log(`    [DRY RUN] Categorias (IDs): ${payload.categories?.map(c => c.id).join(', ') || '(nenhuma)'}`);
    return {
        id:        fakeId,
        permalink: `${WOO_URL}/?p=${fakeId}-dry-run`
    };
}

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────

module.exports = {
    enviarProduto,
    isDryRun: () => DRY_RUN,
    parsePreco,
    parseCodigo
};
