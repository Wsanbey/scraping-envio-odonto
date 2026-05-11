/**
 * db.js — Módulo central do banco de dados SQLite
 * Inicializa o banco scrapin.db e exporta funções de controle de URLs.
 */

const Database = require('better-sqlite3');
const path = require('path');

// Banco de dados fica na raiz do projeto
const DB_PATH = path.join(__dirname, '..', 'scrapin.db');

const db = new Database(DB_PATH);

// Performance: WAL mode é mais rápido para leitura/escrita simultânea
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────────
// Inicialização da tabela (cria se não existir)
// ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS urls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    url             TEXT    NOT NULL UNIQUE,
    status          TEXT    NOT NULL DEFAULT 'pendente',
    tentativas      INTEGER NOT NULL DEFAULT 0,
    importado_em    TEXT    NOT NULL,
    scrapeado_em    TEXT,
    enviado_em      TEXT,
    woo_product_id  INTEGER,
    woo_url         TEXT,
    erro_msg        TEXT
  );
`);

// ─────────────────────────────────────────────
// Funções de acesso ao banco
// ─────────────────────────────────────────────

/**
 * Insere uma URL no banco. Se já existir, ignora silenciosamente.
 * @param {string} url
 * @returns {{ changes: number }} — changes=1 se inseriu, changes=0 se já existia
 */
function inserirUrl(url) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO urls (url, status, importado_em)
        VALUES (?, 'pendente', ?)
    `);
    return stmt.run(url, new Date().toISOString());
}

/**
 * Retorna todas as URLs com status 'pendente', ordenadas por id.
 * @returns {Array}
 */
function getUrlsPendentes() {
    return db.prepare(`SELECT * FROM urls WHERE status = 'pendente' ORDER BY id`).all();
}

/**
 * Marca uma URL como 'scraping' (em processamento).
 * @param {number} id
 */
function marcarScraping(id) {
    db.prepare(`
        UPDATE urls
        SET status = 'scraping', scrapeado_em = ?
        WHERE id = ?
    `).run(new Date().toISOString(), id);
}

/**
 * Marca uma URL como 'enviado' com os dados do produto WooCommerce.
 * @param {number} id
 * @param {number} wooProductId — ID retornado pela API do WooCommerce
 * @param {string} wooUrl — Link público do produto na loja
 */
function marcarEnviado(id, wooProductId, wooUrl) {
    db.prepare(`
        UPDATE urls
        SET status = 'enviado',
            enviado_em = ?,
            woo_product_id = ?,
            woo_url = ?,
            tentativas = tentativas + 1
        WHERE id = ?
    `).run(new Date().toISOString(), wooProductId, wooUrl, id);
}

/**
 * Marca uma URL como 'erro' com a mensagem de falha.
 * @param {number} id
 * @param {string} mensagemErro
 */
function marcarErro(id, mensagemErro) {
    db.prepare(`
        UPDATE urls
        SET status = 'erro',
            erro_msg = ?,
            tentativas = tentativas + 1
        WHERE id = ?
    `).run(mensagemErro, id);
}

/**
 * Recoloca uma URL com status 'erro' de volta para 'pendente' (para retentar).
 * @param {number} id
 */
function recolocarPendente(id) {
    db.prepare(`
        UPDATE urls
        SET status = 'pendente', erro_msg = NULL
        WHERE id = ?
    `).run(id);
}

/**
 * Retorna contagem agrupada por status.
 * @returns {Array} [{status, total}]
 */
function getResumo() {
    return db.prepare(`
        SELECT status, COUNT(*) as total
        FROM urls
        GROUP BY status
        ORDER BY CASE status
            WHEN 'pendente'  THEN 1
            WHEN 'scraping'  THEN 2
            WHEN 'enviado'   THEN 3
            WHEN 'erro'      THEN 4
            ELSE 5
        END
    `).all();
}

/**
 * Retorna as URLs com erro para diagnóstico.
 * @param {number} limite
 * @returns {Array}
 */
function getUrlsComErro(limite = 20) {
    return db.prepare(`
        SELECT id, url, tentativas, erro_msg, scrapeado_em
        FROM urls
        WHERE status = 'erro'
        ORDER BY id
        LIMIT ?
    `).all(limite);
}

/**
 * Retorna as últimas URLs enviadas com sucesso.
 * @param {number} limite
 * @returns {Array}
 */
function getUrlsEnviadas(limite = 20) {
    return db.prepare(`
        SELECT id, url, woo_product_id, woo_url, enviado_em
        FROM urls
        WHERE status = 'enviado'
        ORDER BY enviado_em DESC
        LIMIT ?
    `).all(limite);
}

module.exports = {
    db,
    inserirUrl,
    getUrlsPendentes,
    marcarScraping,
    marcarEnviado,
    marcarErro,
    recolocarPendente,
    getResumo,
    getUrlsComErro,
    getUrlsEnviadas
};
