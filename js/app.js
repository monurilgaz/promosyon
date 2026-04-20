(() => {
    const state = {
        data: null,
        pension: 12000,
        bankType: 'all',
        search: '',
        sort: 'amount-desc',
    };

    const $ = (id) => document.getElementById(id);

    const fmtTL = (n) => new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
        maximumFractionDigits: 0,
    }).format(n);

    const fmtNum = (n) => new Intl.NumberFormat('tr-TR').format(n);

    // Banka adından 1-2 harfli kısaltma üret (ör. "Türkiye İş Bankası" → "Tİ").
    const initialsOf = (name) => {
        const stop = new Set(['ve', 'türk', 'türkiye']);
        const words = name.split(/\s+/).filter(w => !stop.has(w.toLocaleLowerCase('tr-TR')));
        const letters = (words.length >= 2 ? words.slice(0, 2) : words).map(w => w[0]).join('');
        return letters.toLocaleUpperCase('tr-TR') || name[0].toLocaleUpperCase('tr-TR');
    };

    // Logo HTML: önce <slug>.png, yoksa <slug>.svg, yoksa banka renginde harfli fallback.
    const logoHtml = (bank) => {
        const initials = initialsOf(bank.name);
        const safe = bank.color.replace(/"/g, '');
        const onErr = "if(this.dataset.tried){this.parentElement.classList.add('no-img');this.remove();}else{this.dataset.tried='1';this.src='assets/logos/" + bank.slug + ".svg';}";
        return `<div class="bank-logo" style="background:${safe}">
            <img src="assets/logos/${bank.slug}.png" alt="${bank.name}" loading="lazy" onerror="${onErr}">
            <span class="bank-logo-fallback">${initials}</span>
        </div>`;
    };

    const parsePension = (raw) => {
        const cleaned = String(raw).replace(/[^\d]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
    };

    const getTierAmount = (bank, pension) => {
        const tier = bank.tiers.find(t =>
            pension >= t.min && (t.max === null || pension <= t.max)
        );
        return tier ? tier.amount : bank.tiers[bank.tiers.length - 1].amount;
    };

    const loadTheme = () => {
        const saved = localStorage.getItem('theme');
        const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
    };

    const toggleTheme = () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    };

    const renderSummary = (banks) => {
        if (banks.length === 0) {
            $('highestAmount').textContent = '-';
            $('highestBank').textContent = '-';
            $('averageAmount').textContent = '-';
            $('bankCount').textContent = '0 banka';
            return;
        }

        const amounts = banks.map(b => getTierAmount(b, state.pension));
        const maxIdx = amounts.indexOf(Math.max(...amounts));
        const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;

        $('highestAmount').textContent = fmtTL(amounts[maxIdx]);
        $('highestBank').textContent = banks[maxIdx].name;
        $('averageAmount').textContent = fmtTL(Math.round(avg));
        $('bankCount').textContent = `${banks.length} banka`;
    };

    const renderBankCard = (bank) => {
        const amount = getTierAmount(bank, state.pension);
        const tier = bank.tiers.find(t =>
            state.pension >= t.min && (t.max === null || state.pension <= t.max)
        ) || bank.tiers[bank.tiers.length - 1];
        const isCombined = tier && tier.breakdown && tier.breakdown.length > 1;

        const card = document.createElement('article');
        card.className = 'bank-card';
        card.style.setProperty('--bank-color', bank.color);
        card.dataset.slug = bank.slug;

        const extrasHtml = bank.extras.slice(0, 3)
            .map(e => `<span class="extra-chip">${e}</span>`)
            .join('');

        const amountLabel = isCombined
            ? `${fmtNum(state.pension)} ₺ maaş • ${tier.breakdown.length} kalem toplam`
            : `${fmtNum(state.pension)} ₺ maaş için`;

        card.innerHTML = `
            <div class="bank-card-header">
                ${logoHtml(bank)}
                <div class="bank-name-wrap">
                    <div class="bank-name">${bank.name}</div>
                    <span class="bank-type-badge" data-type="${bank.type}">${bank.type}</span>
                </div>
            </div>
            <div>
                <div class="bank-amount">${fmtTL(amount)}</div>
                <div class="bank-amount-label">${amountLabel}</div>
            </div>
            <div class="bank-extras">${extrasHtml}</div>
            <div class="bank-card-footer">
                <span>Taahhüt: <strong>${state.data.commitmentMonths} ay</strong></span>
                <span>Detaylar →</span>
            </div>
        `;

        card.addEventListener('click', () => openModal(bank));
        return card;
    };

    const renderBanks = () => {
        const grid = $('banksGrid');
        let filtered = state.data.banks.filter(b => {
            if (state.bankType !== 'all' && b.type !== state.bankType) return false;
            if (state.search && !b.name.toLocaleLowerCase('tr-TR').includes(state.search)) return false;
            return true;
        });

        filtered.sort((a, b) => {
            if (state.sort === 'name-asc') return a.name.localeCompare(b.name, 'tr');
            const aAmt = getTierAmount(a, state.pension);
            const bAmt = getTierAmount(b, state.pension);
            return state.sort === 'amount-asc' ? aAmt - bAmt : bAmt - aAmt;
        });

        grid.innerHTML = '';
        if (filtered.length === 0) {
            grid.innerHTML = '<div class="loading">Eşleşen banka bulunamadı.</div>';
        } else {
            filtered.forEach(b => grid.appendChild(renderBankCard(b)));
        }

        renderSummary(filtered);
    };

    const openModal = (bank) => {
        const modal = $('bankModal');
        const body = $('modalBody');
        const currentAmount = getTierAmount(bank, state.pension);
        const activeTier = bank.tiers.find(t =>
            state.pension >= t.min && (t.max === null || state.pension <= t.max)
        ) || bank.tiers[bank.tiers.length - 1];

        const tiersHtml = bank.tiers.map(t => {
            const rangeLabel = t.max === null
                ? `${fmtNum(t.min)} ₺ ve üzeri`
                : `${fmtNum(t.min)} - ${fmtNum(t.max)} ₺`;
            const isActive = t === activeTier;
            return `
                <tr class="${isActive ? 'highlighted' : ''}">
                    <td>${rangeLabel}</td>
                    <td>${fmtTL(t.amount)}</td>
                </tr>
            `;
        }).join('');

        // Aktif kademede breakdown varsa kalem dökümünü göster.
        const breakdown = activeTier && activeTier.breakdown && activeTier.breakdown.length > 0
            ? activeTier.breakdown
            : null;
        const breakdownHtml = breakdown
            ? `<div class="modal-section">
                <h4>Kazanım Kalemleri</h4>
                <ul class="breakdown-list">
                    ${breakdown.map(c => `
                        <li>
                            <span class="bd-label">${c.label}</span>
                            <span class="bd-amount">${fmtTL(c.amount)}</span>
                        </li>`).join('')}
                    <li class="bd-total">
                        <span class="bd-label">Toplam</span>
                        <span class="bd-amount">${fmtTL(activeTier.amount)}</span>
                    </li>
                </ul>
                <p class="bd-note">Toplam kazanım için tüm koşulların sağlanması gerekir.</p>
            </div>`
            : '';

        const extrasHtml = bank.extras.length > 0
            ? `<ul class="extras-list">${bank.extras.map(e => `<li>${e}</li>`).join('')}</ul>`
            : '<p style="color: var(--text-muted); font-size: 0.9rem">Bilgi bulunmuyor.</p>';
        const phoneClean = bank.phone.replace(/\s/g, '');

        body.innerHTML = `
            <div class="modal-header">
                ${logoHtml(bank)}
                <div>
                    <h3 style="color: ${bank.color}">${bank.name}</h3>
                    <div class="modal-subtitle">${bank.type} Bankası • ${state.data.commitmentMonths} Ay Taahhüt</div>
                </div>
            </div>

            <div class="modal-section">
                <h4>Maaş Aralığına Göre Promosyon</h4>
                <table class="tier-table">
                    <thead>
                        <tr><th>Emekli Maaşı</th><th>Promosyon</th></tr>
                    </thead>
                    <tbody>${tiersHtml}</tbody>
                </table>
            </div>

            <div class="modal-section">
                <h4>Sizin için Tahmini Promosyon</h4>
                <p style="font-size: 1.5rem; font-weight: 700; color: ${bank.color}">${fmtTL(currentAmount)}</p>
                <p style="color: var(--text-muted); font-size: 0.9rem">${fmtNum(state.pension)} ₺ emekli maaşı için ${breakdown ? '(toplam kazanım)' : ''}</p>
            </div>

            ${breakdownHtml}

            <div class="modal-section">
                <h4>Ek Avantajlar</h4>
                ${extrasHtml}
            </div>

            <div class="modal-section">
                <h4>Şartlar</h4>
                <p>${bank.notes}</p>
            </div>

            <div class="modal-contact">
                <a class="contact-btn primary" href="${bank.url}" target="_blank" rel="noopener">Banka Sitesi</a>
                <a class="contact-btn" href="tel:${phoneClean}">${bank.phone}</a>
            </div>
        `;

        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    };

    const closeModal = () => {
        const modal = $('bankModal');
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    };

    const formatPensionInput = () => {
        const input = $('pensionInput');
        const val = parsePension(input.value);
        if (val > 0) input.value = fmtNum(val);
    };

    const init = async () => {
        loadTheme();

        try {
            const res = await fetch('data/promosyon.json?v=' + Date.now());
            state.data = await res.json();
        } catch (err) {
            $('banksGrid').innerHTML = '<div class="loading">Veriler yüklenemedi.</div>';
            console.error(err);
            return;
        }

        const lu = new Date(state.data.lastUpdated);
        $('lastUpdated').textContent = lu.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
        $('commitmentMonths').textContent = `${state.data.commitmentMonths} Ay`;

        $('themeToggle').addEventListener('click', toggleTheme);

        $('pensionInput').addEventListener('input', (e) => {
            state.pension = parsePension(e.target.value);
            renderBanks();
        });
        $('pensionInput').addEventListener('blur', formatPensionInput);

        $('bankTypeFilter').addEventListener('change', (e) => {
            state.bankType = e.target.value;
            renderBanks();
        });

        $('searchInput').addEventListener('input', (e) => {
            state.search = e.target.value.toLocaleLowerCase('tr-TR').trim();
            renderBanks();
        });

        $('sortSelect').addEventListener('change', (e) => {
            state.sort = e.target.value;
            renderBanks();
        });

        $('modalClose').addEventListener('click', closeModal);
        $('modalOverlay').addEventListener('click', closeModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });

        formatPensionInput();
        renderBanks();
    };

    document.addEventListener('DOMContentLoaded', init);
})();
