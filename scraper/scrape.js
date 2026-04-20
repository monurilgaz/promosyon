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

// ===== Shared helpers =====

function cleanText(s) {
    return String(s || '')
        .replace(/\s+/g, ' ')
        .replace(/^["“”‘’'`]+|["“”‘’'`]+$/g, '')
        .replace(/[,!.]+$/, '')
        .trim();
}

// Header'ında `headerKeyword` (örn. "Promosyon") geçen <table>'ı bulup
// [{min, max, amount}] döner. Bulamazsa null.
async function scrapePromosyonTable(url, headerKeyword) {
    const doc = await fetchHTML(url);
    let table = null;
    for (const t of doc.querySelectorAll('table')) {
        for (const th of t.querySelectorAll('th')) {
            if (th.textContent.indexOf(headerKeyword) >= 0) { table = t; break; }
        }
        if (table) break;
    }
    if (!table) return null;
    const tiers = [];
    for (const row of table.querySelectorAll('tr')) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;
        const range = parseRange(cells[0].textContent);
        if (!range) continue;
        const amount = parseAmount(cells[1].textContent);
        if (amount > 0) tiers.push({ min: range.min, max: range.max, amount });
    }
    return tiers.length > 0 ? tiers : null;
}

// Container'lardaki <ul><li> metinlerini toplar. Uzunluk filtreli, dedup'lı.
function extractListExtras(doc, containerSelector) {
    const roots = containerSelector ? doc.querySelectorAll(containerSelector) : [doc.body];
    const seen = new Set();
    const out = [];
    for (const root of roots) {
        for (const li of root.querySelectorAll('ul li, ol li')) {
            const t = cleanText(li.textContent);
            if (t.length < 10 || t.length > 180) continue;
            const key = t.toLocaleLowerCase('tr-TR');
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(t);
        }
    }
    return out;
}

// Container'lardaki <p><strong>...</strong></p> metinlerini toplar.
function extractStrongExtras(doc, containerSelector) {
    const roots = containerSelector ? doc.querySelectorAll(containerSelector) : [doc.body];
    const seen = new Set();
    const out = [];
    for (const root of roots) {
        for (const p of root.querySelectorAll('p')) {
            const strong = p.querySelector('strong, b');
            if (!strong) continue;
            const t = cleanText(strong.textContent);
            if (t.length < 10 || t.length > 140) continue;
            const key = t.toLocaleLowerCase('tr-TR');
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(t);
        }
    }
    return out;
}

// ===== Parsers =====
// Her banka için parser burada tanımlanır.
// Parser imzası: async (bank) => { tiers, extras?, notes? } veya null.

const parsers = {
    'ziraat-bankasi': async (bank) => {
        const tiers = await scrapePromosyonTable(bank.url, 'Promosyon');
        if (!tiers) return null;
        let extras = [];
        if (bank.extrasUrl) {
            const doc = await fetchHTML(bank.extrasUrl);
            extras = extractStrongExtras(doc, '.ms-rtestate-field')
                // "Promosyon Ödemesi" başlığı sayfada strong olarak da geçiyor — atla.
                .filter(e => !/promosyon\s+[öo]demesi/i.test(e));
        }
        return { tiers, extras };
    },

    'vakifbank': async (bank) => {
        // Vakıfbank tutarları FAQ accordion'unda (h3 → "Ne kadar promosyon ödemesi alırım?")
        // verilen prose <li>'lerde tutuyor. Tablo değil.
        const doc = await fetchHTML(bank.url);
        const h3 = Array.from(doc.querySelectorAll('h3'))
            .find(h => h.textContent.includes('Ne kadar promosyon'));
        if (!h3) return null;
        const card = h3.closest('.card');
        if (!card) return null;
        const tiers = [];
        for (const li of card.querySelectorAll('ul li')) {
            const txt = li.textContent.replace(/\s+/g, ' ').trim();
            const amountMatch = txt.match(/toplam\s+([\d.,]+)\s*TL/i);
            if (!amountMatch) continue;
            const amount = parseAmount(amountMatch[1] + ' TL');
            if (amount <= 0) continue;
            let min = 0, max = null;
            const upTo = txt.match(/^([\d.,]+)\s*TL.*kadar/i);
            const between = txt.match(/([\d.,]+)\s*TL\s*[-–]\s*([\d.,]+)\s*TL.*aras[ıi]nda/i);
            const over = txt.match(/([\d.,]+)\s*TL\s+ve\s+daha\s+fazla/i);
            if (between) {
                min = parseAmount(between[1] + ' TL');
                max = parseAmount(between[2] + ' TL') - 0.01;
            } else if (upTo) {
                max = parseAmount(upTo[1] + ' TL') - 0.01;
            } else if (over) {
                min = parseAmount(over[1] + ' TL');
            } else {
                continue;
            }
            tiers.push({ min, max, amount });
        }
        if (tiers.length === 0) return null;

        // Yan haklar: kampanya sayfasından "ek kazanım/varan promosyon" geçen
        // anlamlı paragrafları çek. Kampanya şartları/kısıtlamaları skip edilir.
        let extras = [];
        if (bank.extrasUrl) {
            const adoc = await fetchHTML(bank.extrasUrl);
            const h1 = Array.from(adoc.querySelectorAll('h1'))
                .find(h => h.textContent.includes('Emekli'));
            if (h1) {
                let container = h1.parentElement;
                for (let i = 0; i < 5 && container.parentElement; i++) container = container.parentElement;
                const skip = /sona erm|dahil değil|kabul edilm|durdurma|yans[ıi]t|hak edilen|geçerli olacak|takvim|ekstre|harcama olarak|sanal kart|taksitl|gerekmektedir|durumunda|ödül hakk|altında ol|katı[lr]ım şart|tarihleri aras|tarihinde|tarihler/i;
                const good = /TL.{0,3}ye varan|ek kazanım|ek olarak|aylık.*TL nakit|TL nakit ödeme|toplamda.*TL/i;
                const seen = new Set();
                for (const el of container.querySelectorAll('p, li')) {
                    let t = el.textContent.replace(/\s+/g, ' ').trim();
                    if (t.length < 30 || t.length > 400) continue;
                    if (skip.test(t)) continue;
                    if (!good.test(t)) continue;
                    // Sayılardaki noktayı korumak için "nokta + boşluk" ile cümle böl
                    const first = t.split(/\.\s/)[0];
                    if (first.length >= 30 && first.length <= 280) t = first;
                    if (t.length > 280) continue;
                    const key = t.toLocaleLowerCase('tr-TR');
                    if (seen.has(key)) continue;
                    seen.add(key);
                    extras.push(t);
                    if (extras.length >= 5) break;
                }
            }
        }
        return { tiers, extras };
    },

    'halkbank': async (bank) => {
        const tiers = await scrapePromosyonTable(bank.url, 'Promosyon');
        if (!tiers) return null;
        let extras = [];
        if (bank.extrasUrl) {
            const doc = await fetchHTML(bank.extrasUrl);
            extras = extractListExtras(doc, '.cmp-text')
                // İlk maddede "maaş promosyonu" var — zaten tutarı ayrı gösteriyoruz, atla.
                .filter(e => !/maa[sş]\s+promosyonu/i.test(e));
        }
        return { tiers, extras };
    },
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
                // Parser extras alanını explicit set ettiyse (boş array dahil) onu kullan,
                // tanımlamadıysa config/önceki veriye düş.
                extras: (data.extras !== undefined)
                    ? data.extras
                    : (bank.extras || (prev && prev.extras) || []),
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
