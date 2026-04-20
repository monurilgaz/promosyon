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

Banka verileri `data/banks.json` içinde tutulur. Her banka için:

- Banka adı, türü ve rengi
- Maaş aralıklarına göre promosyon kademeleri (tier)
- Ek avantajlar, taahhüt notları, iletişim bilgileri

Tutarlar yaklaşık değerlerdir ve bankaların güncel kampanyalarına göre değişebilir.

## Yerel çalıştırma

```bash
python3 -m http.server 8000
# tarayıcıda: http://localhost:8000
```

## Yayın

GitHub Pages üzerinden `main` branch'ten otomatik yayınlanır.
