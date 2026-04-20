#!/usr/bin/env node
// Node.js scraper: bankaların emekli promosyon tutarlarını çeker ve data/promosyon.json yazar.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TIMEOUT = 30000;
const MAX_RETRIES = 2;

// ===== HTTP Helpers =====

function request(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const timer = setTimeout(() => { reject(new Error('Timeout')); }, TIMEOUT);
        const reqOpts = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: opts.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                ...(opts.headers || {})
            }
        };
        if (opts.body) {
            reqOpts.headers['Content-Length'] = Buffer.byteLength(opts.body);
        }
        const req = mod.request(reqOpts, res => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => {
                clearTimeout(timer);
                resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
            });
        });
        req.on('error', e => { clearTimeout(timer); reject(e); });
        req.setTimeout(TIMEOUT, () => { req.destroy(); reject(new Error('Timeout')); });
        if (opts.body) req.write(opts.body);
        req.end();
    });
}

async function fetchHTML(url) {
    const res = await request(url);
    return new JSDOM(res.body).window.document;
}

async function fetchJSON(url, body, contentType) {
    const res = await request(url, {
        method: 'POST',
        headers: {
            'Content-Type': contentType || 'application/json; charset=utf-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': new URL(url).origin,
            'Referer': new URL(url).origin + '/'
        },
        body: body
    });
    return JSON.parse(res.body);
}

async function fetchGETJSON(url) {
    const res = await request(url, {
        headers: { 'Accept': 'application/json, */*' }
    });
    return JSON.parse(res.body);
}

// ===== Parse Helpers =====

function parseNumber(str) {
    if (!str) return 0;
    str = str.replace(/[^\d,.]/g, '');
    if (!str) return 0;
    const cp = str.split(',');
    if (cp.length === 2) {
        str = str.replace(/\./g, '').replace(',', '.');
    } else {
        const dp = str.split('.');
        if (dp.length === 2 && dp[1].length <= 2) { /* keep */ }
        else { str = str.replace(/\./g, ''); }
    }
    return parseFloat(str) || 0;
}

function parseAmount(str) {
    if (!str) return 0;
    return parseNumber(String(str).replace(/<[^>]*>/g, '').replace(/TL|₺/gi, '').trim());
}

function parseRange(str) {
    if (!str) return null;
    str = String(str).replace(/<[^>]*>/g, '').trim().replace(/TL|₺/gi, '').trim();
    const mOpen = str.match(/([\d.,]+)\s*[-–]?\s*(?:ve\s+)?[üu]zeri/i) || str.match(/([\d.,]+)\s*\+/);
    if (mOpen) return { min: parseNumber(mOpen[1]), max: null };
    const m = str.match(/([\d.,]+)\s*[-–]\s*([\d.,]+)/);
    if (!m) return null;
    return { min: parseNumber(m[1]), max: parseNumber(m[2]) };
}

// ===== Parsers =====
// Her banka için parser burada tanımlanır.
// Parser imzası: async (bank) => { tiers: [{min, max, amount}], extras?: string[], notes?: string }
// Dönen tiers dizisi promosyon kademelerini içerir. null dönerse "başarısız" sayılır.

const parsers = {
    // Örnek: bank slug'ı = 'ornek-bank'
    // 'ornek-bank': async (bank) => {
    //     const doc = await fetchHTML(bank.url);
    //     const table = doc.querySelector('table');
    //     if (!table) return null;
    //     const tiers = [];
    //     for (const row of table.querySelectorAll('tbody tr')) {
    //         const cells = row.querySelectorAll('td');
    //         if (cells.length < 2) continue;
    //         const range = parseRange(cells[0].textContent);
    //         if (!range) continue;
    //         const amount = parseAmount(cells[1].textContent);
    //         if (amount > 0) tiers.push({ min: range.min, max: range.max, amount });
    //     }
    //     return tiers.length > 0 ? { tiers } : null;
    // },
};

// ===== Main =====

async function scrapeBank(bank, attempt) {
    attempt = attempt || 1;
    try {
        const parser = parsers[bank.slug];
        if (!parser) {
            console.log('  SKIP ' + bank.slug + ': parser tanımlı değil');
            return null;
        }
        return await parser(bank);
    } catch (e) {
        if (attempt < MAX_RETRIES) {
            console.log('  RETRY ' + bank.slug + ' (' + e.message + ')');
            await new Promise(r => setTimeout(r, 3000));
            return scrapeBank(bank, attempt + 1);
        }
        console.log('  ERROR ' + bank.slug + ': ' + e.message);
        return null;
    }
}

async function main() {
    const configPath = path.join(__dirname, 'banks.json');
    const outputPath = path.join(__dirname, '..', 'data', 'promosyon.json');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const configBanks = (config.banks || []).filter(b => b.enabled !== false);

    // Mevcut data/promosyon.json'u oku — config'te olmayan bankalar aynen korunur,
    // scrape başarısız olan banka için de önceki tier'lar korunur.
    let existingOutput = { banks: [] };
    if (fs.existsSync(outputPath)) {
        try {
            existingOutput = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        } catch (e) { /* ignore */ }
    }
    const existingBySlug = {};
    for (const b of (existingOutput.banks || [])) existingBySlug[b.slug] = b;

    console.log(configBanks.length + ' banka scrape ediliyor...\n');

    const scrapedBySlug = {};
    let success = 0;

    for (const bank of configBanks) {
        process.stdout.write(bank.name + '... ');
        const data = await scrapeBank(bank);
        const prev = existingBySlug[bank.slug];
        if (data && data.tiers && data.tiers.length > 0) {
            console.log('OK (' + data.tiers.length + ' kademe)');
            scrapedBySlug[bank.slug] = {
                slug: bank.slug,
                name: bank.name,
                type: bank.type,
                color: bank.color,
                url: bank.url,
                phone: bank.phone || (prev && prev.phone) || '',
                tiers: data.tiers,
                extras: data.extras || bank.extras || (prev && prev.extras) || [],
                notes: data.notes || bank.notes || (prev && prev.notes) || '',
                scrapedAt: new Date().toISOString()
            };
            success++;
        } else if (prev && prev.tiers && prev.tiers.length > 0) {
            console.log('FAIL (önceki veri korundu)');
            scrapedBySlug[bank.slug] = prev;
        } else {
            console.log('FAIL (veri yok)');
        }
    }

    // Çıktı: config'te olmayan bankaları aynen koru, olanları güncelle.
    const resultBanks = [];
    const seen = new Set();
    for (const b of (existingOutput.banks || [])) {
        resultBanks.push(scrapedBySlug[b.slug] || b);
        seen.add(b.slug);
    }
    // Config'te yeni eklenen banka varsa listeye dahil et.
    for (const b of configBanks) {
        if (!seen.has(b.slug) && scrapedBySlug[b.slug]) {
            resultBanks.push(scrapedBySlug[b.slug]);
        }
    }

    const output = {
        lastUpdated: new Date().toISOString(),
        commitmentMonths: config.commitmentMonths || existingOutput.commitmentMonths || 36,
        note: 'Tutarlar bankaların resmi sayfalarından otomatik olarak çekilmiştir. Güncel bilgi için bankayla iletişime geçin.',
        banks: resultBanks
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log('\nBitti! ' + success + '/' + configBanks.length + ' banka. Çıktı: data/promosyon.json');

    if (configBanks.length > 0 && success === 0) {
        console.error('UYARI: Hiçbir banka scrape edilemedi.');
        process.exit(1);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
