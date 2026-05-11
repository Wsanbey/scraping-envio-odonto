/**
 * importar-urls.js — Importa URLs do TXT para o banco de dados SQLite
 *
 * Uso: npm run importar
 *
 * Comportamento:
 *  - Lê todas_urls.txt
 *  - Insere no banco APENAS as URLs novas (duplicatas são ignoradas)
 *  - Exibe um resumo: quantas foram importadas e quantas já existiam
 */

const fs = require('fs');
const path = require('path');
const { inserirUrl } = require('./db');

const ARQUIVO_URLS = path.join(__dirname, '..', 'todas_urls.txt');

function main() {
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('  IMPORTAR URLs → scrapin.db');
    console.log('════════════════════════════════════════════════');

    // Verifica se o arquivo existe
    if (!fs.existsSync(ARQUIVO_URLS)) {
        console.error(`\n❌ Arquivo não encontrado: ${ARQUIVO_URLS}`);
        process.exit(1);
    }

    // Lê e limpa as URLs
    const linhas = fs.readFileSync(ARQUIVO_URLS, 'utf-8')
        .split('\n')
        .map(linha => linha.trim())
        .filter(linha => linha.length > 0 && linha.startsWith('http'));

    if (linhas.length === 0) {
        console.log('\n⚠️  Nenhuma URL válida encontrada no arquivo.');
        process.exit(0);
    }

    console.log(`\n📄 URLs encontradas no TXT: ${linhas.length}`);
    console.log('');

    let novas = 0;
    let duplicatas = 0;

    for (const url of linhas) {
        const resultado = inserirUrl(url);

        if (resultado.changes === 1) {
            novas++;
            console.log(`  ✅ NOVA       → ${url}`);
        } else {
            duplicatas++;
            console.log(`  ⏭️  JÁ EXISTE  → ${url}`);
        }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('  RESUMO DA IMPORTAÇÃO');
    console.log('════════════════════════════════════════════════');
    console.log(`  ✅ Novas inseridas:    ${novas}`);
    console.log(`  ⏭️  Já existiam:        ${duplicatas}`);
    console.log(`  📦 Total no arquivo:  ${linhas.length}`);
    console.log('════════════════════════════════════════════════');
    console.log('');

    if (novas > 0) {
        console.log(`  💾 ${novas} URL(s) salva(s) em: scrapin.db`);
        console.log('  Execute "npm run status" para ver o estado do banco.');
    } else {
        console.log('  Nenhuma URL nova para importar. Banco já atualizado!');
    }
    console.log('');
}

main();
