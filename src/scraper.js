const puppeteer = require('puppeteer');
const fs = require('fs');

const urlsFile = './todas_urls.txt';

function withFallback(value, defaultValue) {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    return value;
}

async function scrapePage(browser, url, produtoNumero) {
    let page;
    try {
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        try {
            await page.waitForSelector('h1.p-title-subtitle-color', { timeout: 15000 });
        } catch (e) {
            console.log('  ! Titulo nao encontrado, aguardando...');
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

        try {
            await page.waitForSelector('span.text-price', { timeout: 8000 });
        } catch (e) {
            console.log('  ! Preco nao encontrado, aguardando mais...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        try {
            await page.waitForSelector('table[class*="Product_table__"]', { timeout: 5000 });
        } catch (e) {
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        const result = await page.evaluate((prodNum) => {
            const $ = document.querySelector.bind(document);
            const $$ = document.querySelectorAll.bind(document);

            function withFallback(value, defaultValue) {
                if (value === null || value === undefined || value === '') return defaultValue;
                return value;
            }

            function firstTextOf(...selectors) {
                for (let sel of selectors) {
                    const el = $(sel);
                    if (el) return el.textContent?.trim() || '';
                }
                return '';
            }

            function firstNumericOf(...selectors) {
                for (let sel of selectors) {
                    const el = $(sel);
                    if (el) {
                        const val = parseInt(el.textContent);
                        if (!isNaN(val)) return val;
                    }
                }
                return null;
            }

            function firstOf(...selectors) {
                for (let sel of selectors) {
                    const el = $(sel);
                    if (el) return el;
                }
                return null;
            }

            const nome = firstTextOf('h1.p-title-subtitle-color') || 'indisponivel';

            const embalagem = firstTextOf(
                'p.mb-50.p-title-subtitle-color',
                'p[class*="subtitle-color"][class*="mb-"]',
                'p[class*="subtitle"]',
                'div[class*="Product_description"] + p'
            ) || 'indisponivel';

            let codigo = '';
            const allPs = $$('p');
            for (let p of allPs) {
                const text = p.textContent.trim();
                if (text.includes('Código') || text.includes('Cód.')) {
                    codigo = text.replace(/\s+/g, ' ').trim();
                    break;
                }
            }
            codigo = withFallback(codigo, 'indisponivel');

            const precoVista = firstTextOf(
                'div[class*="boxChildrens"] span[class*="price"]',
                'div[class*="boxChildrens"] span.text-price',
                'span.customProduct__price.text-price',
                'span.text-price',
                'div[class*="customProduct"] span[class*="price"]',
                'div[class*="price"] span',
                'p[class*="price"] span',
                'span[class*="customProduct"]'
            ) || 'indisponivel';

            const precoParcelado = firstTextOf(
                'div[class*="boxChildrens"] span.font-small-2',
                'span.customProduct__price.font-small-2',
                'span.font-small-2',
                'div[class*="price"] span.font-small-2',
                'p[class*="price"] span.font-small-2',
                'div[class*="parcelado"]',
                'div[class*="installment"]',
                'span[class*="parcelado"]',
                'p[class*="parcelado"]'
            ) || 'indisponivel';

            let estoqueMax = null;
            const inputs = $$('input[type="number"], input[class*="customQtd"], input#exampleNumber');
            for (let inp of inputs) {
                const max = parseInt(inp.max);
                if (!isNaN(max)) {
                    estoqueMax = max;
                    break;
                }
            }
            if (estoqueMax === null) {
                const maxAttr = $('input[type="number"]')?.getAttribute('max');
                if (maxAttr) estoqueMax = parseInt(maxAttr);
            }
            if (estoqueMax === null) {
                const spanEstoque = firstTextOf(
                    'span[class*="stock"]',
                    'span[class*="estoque"]',
                    'span.text-muted'
                );
                if (spanEstoque) {
                    const num = parseInt(spanEstoque);
                    if (!isNaN(num)) estoqueMax = num;
                }
            }
            estoqueMax = estoqueMax !== null ? estoqueMax : -1;

            const status = firstTextOf(
                'span.text-muted',
                'span[class*="status"]',
                'span[class*="badge"]',
                'p[class*="stock"]',
                'div[class*="stock"] span',
                'div[class*="status"]'
            ) || 'indisponivel';

            const images = [];
            const thumbs = $$(
                'div.Product_photos__MVCxp ul li img',
                'div[class*="Product_photos"] img',
                'div[class*="photos"] img',
                'ul[class*="thumbs"] img',
                'div[class*="gallery"] img',
                'img[class*="thumb"]'
            );
            thumbs.forEach((img, i) => {
                const src = img.src;
                const alt = img.alt || '';
                if (src && !src.includes('data:')) {
                    images.push({
                        index: i + 1,
                        src: src,
                        alt: alt
                    });
                }
            });

            const thumbnailUrls = images.map(img => img.src);

            let descricaoHtml = '';
            const descEl = $('div.Product_description__NLPW3') ||
                $('div[class*="Product_description"]') ||
                $('div[class*="description"]') ||
                $('div[id*="description"]');
            if (descEl) {
                descricaoHtml = descEl.innerHTML;
            }
            if (!descricaoHtml) {
                const nextUl = $('div[class*="description"] + ul') || $('div[class*="Product_description"] + ul');
                if (nextUl) descricaoHtml = nextUl.innerHTML;
            }
            descricaoHtml = withFallback(descricaoHtml, 'indisponivel');

            const productTable = $('table[class*="Product_table__"]');
            let tipo = 'simples';
            const variantes = [];

            if (productTable) {
                const tableRows = productTable.querySelectorAll('tbody tr');

                if (tableRows.length > 0) {
                    tipo = 'composto';

                    tableRows.forEach((row) => {
                        const cells = row.querySelectorAll('td');
                        let nomeVariante = 'indisponivel';
                        let codigoVariante = 'indisponivel';
                        let precoVariante = 'indisponivel';
                        let estoqueVariante = -1;

                        const firstTd = cells[0];
                        if (firstTd) {
                            const allSpans = firstTd.querySelectorAll('span');
                            if (allSpans.length > 0) {
                                const strongSpan = firstTd.querySelector('span[style*="font-weight"]') || allSpans[0];
                                if (strongSpan) {
                                    nomeVariante = strongSpan.textContent?.replace(/\s+/g, ' ').trim() || 'indisponivel';
                                }
                                for (let sp of allSpans) {
                                    const txt = sp.textContent || '';
                                    if (txt.includes('Cód.') || txt.includes('Cod.') || txt.includes('Código')) {
                                        codigoVariante = txt.replace(/\s+/g, ' ').trim();
                                        break;
                                    }
                                }
                            }
                        }

                        const cellArray = Array.from(cells);
                        const priceTd = cellArray.find(td => td.className && td.className.includes('tdPrice')) ||
                            cellArray.find(td => td.className && td.className.includes('Price'));
                        if (priceTd) {
                            const priceSpan = priceTd.querySelector('span') || priceTd;
                            const text = priceSpan.textContent?.replace(/\s+/g, ' ').trim() || '';
                            if (text) precoVariante = text;
                        }

                        const inputEl = row.querySelector('input[type="number"]') || row.querySelector('input');
                        if (inputEl && inputEl.max) {
                            estoqueVariante = parseInt(inputEl.max) || -1;
                        }

                        variantes.push({
                            nome: nomeVariante,
                            codigo: codigoVariante,
                            preco: precoVariante,
                            estoqueMax: estoqueVariante
                        });
                    });
                }
            }

            const categorias = [];
            const breadcrumbLinks = $$('nav[class*="Breadcrumb_breadcrumb"] ol.breadcrumb li.breadcrumb-item a');
            breadcrumbLinks.forEach((a) => {
                const text = a.textContent?.trim();
                const href = a.getAttribute('href');
                if (text && 
                    text.toLowerCase() !== 'home' && 
                    text.toLowerCase() !== 'início' && 
                    text.toLowerCase() !== 'inicio' &&
                    href !== '/') {
                    categorias.push(text);
                }
            });

            return {
                produtoNumero: prodNum,
                url: window.location.href,
                nome: withFallback(nome, 'indisponivel'),
                embalagem: withFallback(embalagem, 'indisponivel'),
                codigo: withFallback(codigo, 'indisponivel'),
                precoVista: withFallback(precoVista, 'indisponivel'),
                precoParcelado: withFallback(precoParcelado, 'indisponivel'),
                estoqueMax: estoqueMax,
                status: withFallback(status, 'indisponivel'),
                imagens: thumbnailUrls,
                imageDetails: images,
                descricao: descricaoHtml,
                tipo: withFallback(tipo, 'simples'),
                variantes: variantes,
                categorias: categorias
            };
        }, produtoNumero);

        await page.close();
        return result;

    } catch (error) {
        if (page) await page.close();
        return {
            produtoNumero,
            url,
            nome: 'indisponivel',
            embalagem: 'indisponivel',
            codigo: 'indisponivel',
            precoVista: 'indisponivel',
            precoParcelado: 'indisponivel',
            estoqueMax: -1,
            status: 'indisponivel',
            imagens: [],
            imageDetails: [],
            descricao: 'indisponivel',
            tipo: 'simples',
            variantes: [],
            error: error.message
        };
    }
}

function formatResults(result, wooResult = null) {
    let output = '';
    output += '═══════════════════════════════════════════════════════\n';
    output += `PRODUTO ${result.produtoNumero}\n`;
    output += `URL: ${result.url}\n`;

    if (result.error) {
        output += `❌ ERRO SCRAPING: ${result.error}\n`;
    } else {
        output += `Nome: ${result.nome}\n`;
        output += `Embalagem: ${result.embalagem}\n`;
        output += `Tipo: ${result.tipo === 'composto' ? `COMPOSTO (${result.variantes.length} variantes)` : 'SIMPLES'}\n`;
        output += `Codigo: ${result.codigo}\n`;
        output += `Preco a vista: ${result.precoVista}\n`;
        output += `Preco parcelado: ${result.precoParcelado}\n`;
        output += `Estoque max: ${result.estoqueMax}\n`;
        output += `Status: ${result.status}\n`;
        output += `Imagens: ${result.imagens.length}\n`;
        output += `Categorias: ${result.categorias.join(' > ') || 'Nenhuma'}\n`;

        if (result.tipo === 'composto' && result.variantes.length > 0) {
            output += '\n--- Variantes ---\n';
            result.variantes.slice(0, 5).forEach((v, i) => {
                output += `  ${i + 1}. nome="${v.nome}" codigo="${v.codigo}" preco="${v.preco}" estoque=${v.estoqueMax}\n`;
            });
            if (result.variantes.length > 5) {
                output += `  ... e mais ${result.variantes.length - 5} variantes\n`;
            }
        }

        if (wooResult) {
            if (wooResult.error) {
                output += `\n❌ ERRO WOOCOMMERCE: ${wooResult.error}\n`;
            } else {
                output += `\n✅ Produto salvo!\n`;
                output += `🆔 ID WooCommerce: ${wooResult.id}\n`;
                output += `🔗 Link: ${wooResult.permalink}\n`;
            }
        }
    }
    output += '═══════════════════════════════════════════════════════\n';
    return output;
}

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getUrlsPendentes, marcarScraping, marcarEnviado, marcarErro } = require('./db');
const { enviarProduto, isDryRun } = require('./woo');

async function main() {
    const DRY_RUN    = isDryRun();
    const LIMITE     = parseInt(process.env.LIMITE_URLS || '0', 10);

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  ODONTO SCRAPING → WOOCOMMERCE');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Modo:   ${DRY_RUN ? '🧪 DRY RUN (simulação — sem envio real)' : '🚀 PRODUÇÃO (enviando ao WooCommerce)'}`);
    console.log(`  Limite: ${LIMITE > 0 ? `${LIMITE} URLs por execução` : 'Sem limite (processa todos os pendentes)'}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // ── Busca URLs pendentes no banco ──
    let pendentes = getUrlsPendentes();

    if (pendentes.length === 0) {
        console.log('  ✅ Nenhuma URL pendente no banco.');
        console.log('  Execute "npm run importar" para adicionar novas URLs.');
        console.log('');
        return;
    }

    // Aplica limite se configurado
    if (LIMITE > 0) {
        pendentes = pendentes.slice(0, LIMITE);
    }

    console.log(`  📋 URLs pendentes encontradas: ${pendentes.length}`);
    console.log('');

    let enviados  = 0;
    let erros     = 0;

    const CONCURRENCIA = parseInt(process.env.CONCURRENCIA || '1', 10);
    console.log(`  ⚡ Concorrência: ${CONCURRENCIA} processamentos simultâneos`);
    console.log('');

    // Inicia o navegador UMA vez
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        // Processa em lotes (chunks) de tamanho CONCURRENCIA
        for (let i = 0; i < pendentes.length; i += CONCURRENCIA) {
            const lote = pendentes.slice(i, i + CONCURRENCIA);
            const lotePromises = lote.map(async (registro, indexNoLote) => {
                const idReal = i + indexNoLote + 1;
                const { id, url } = registro;
                const progresso = `[${idReal}/${pendentes.length}]`;

                console.log(`${progresso} Iniciando: ${url}`);

                // Marca como "em andamento" no banco
                marcarScraping(id);

                // ── Etapa 1: Scraping ──
                const dados = await scrapePage(browser, url, idReal);

                if (dados.error) {
                    marcarErro(id, `SCRAPING: ${dados.error}`);
                    erros++;
                    console.log(formatResults(dados));
                    return;
                }

                // ── Etapa 2: Envio ao WooCommerce ──
                try {
                    const woo = await enviarProduto(dados);

                    marcarEnviado(id, woo.id, woo.permalink);
                    enviados++;

                    // Exibe tudo junto (dados + resultado do envio)
                    console.log(formatResults(dados, { 
                        id: woo.id, 
                        permalink: woo.permalink 
                    }));

                } catch (errWoo) {
                    const msg = errWoo.response
                        ? `WOO API ${errWoo.response.status}: ${JSON.stringify(errWoo.response.data)}`
                        : `WOO: ${errWoo.message}`;

                    marcarErro(id, msg);
                    erros++;
                    
                    console.log(formatResults(dados, { error: msg }));
                }
            });

            // Aguarda o lote atual terminar antes de seguir para o próximo
            await Promise.all(lotePromises);

            // Pequena pausa entre lotes para não sufocar o banco/API
            if (i + CONCURRENCIA < pendentes.length) {
                console.log(`\n  --- Aguardando 2s para o próximo lote ---\n`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    } finally {
        await browser.close();
    }

    // ── Resumo final ──
    console.log('═══════════════════════════════════════════════════════');
    console.log('  RESUMO DA EXECUÇÃO');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  ✅ Enviados com sucesso: ${enviados}`);
    console.log(`  ❌ Com erro:             ${erros}`);
    console.log(`  📦 Processados agora:   ${pendentes.length}`);
    if (DRY_RUN) {
        console.log('');
        console.log('  ⚠️  Modo DRY RUN ativo — nenhum produto foi enviado de verdade.');
        console.log('  Para enviar em produção: altere DRY_RUN=false no arquivo .env');
    }
    console.log('  Use "npm run status" para ver o estado completo do banco.');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
}

main();