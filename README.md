# Emekli Promosyon

Türkiye'deki bankaların **emekli promosyon tutarlarını** ve **taahhüt şartlarını** karşılaştıran statik web sayfası.

🔗 **Canlı Site:** [monurilgaz.github.io/promosyon](https://monurilgaz.github.io/promosyon)

## Özellikler

- 20+ banka (kamu / özel / katılım) için promosyon tutarları
- Emekli maaş aralığına göre dinamik promosyon hesaplama
- Banka türüne göre filtreleme ve arama
- Promosyon tutarına göre sıralama
- Her banka için detay modalı (tüm kademeler, iletişim, ek avantajlar)
- Açık / koyu tema

## Veri

Banka verileri `data/promosyon.json` içinde tutulur ve `scraper/scrape.js` tarafından bankaların resmi sitelerinden otomatik çekilir. Her banka için:

- Banka adı, türü ve rengi
- Maaş aralıklarına göre promosyon kademeleri (tier)
- Ek avantajlar, taahhüt notları, iletişim bilgileri

## Scraper

```bash
cd scraper
npm install
cd ..
node scraper/scrape.js
```

- Scraper config'i: `scraper/banks.json` (scrape edilecek bankaların URL + parser slug listesi)
- Çıktı: `data/promosyon.json` (siteye yüklenen dosya)
- Scrape başarısız olursa o bankanın **önceki verisi korunur**.

## Yerel çalıştırma

```bash
python3 -m http.server 8000
# tarayıcıda: http://localhost:8000
```

## Yayın

GitHub Pages üzerinden `main` branch'ten otomatik yayınlanır. Scraper, GitHub Actions ile **her Pazartesi 09:00 TR** saatinde otomatik çalışır (`.github/workflows/scrape.yml`).
