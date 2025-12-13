// Classe para gerenciar as conquistas e áreas
class AchievementManager {
    constructor() {
        this.achievements = [];
        this.areas = [];
        this.currentAreaId = null;
        this.currentFilter = 'todas';
        this.dataVersion = null;
        this.currentUser = null;
        this.saveTimeout = null;
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.setupAuthListeners();
        this.renderAreas();
        this.selectArea(null);
    }

    async loadData() {
        try {
            // Adicionar timestamp para forçar atualização (sem cache)
            const timestamp = new Date().getTime();
            const [achievementsRes, areasRes] = await Promise.all([
                fetch(`./data/achievements.json?v=${timestamp}`),
                fetch(`./data/areas.json?v=${timestamp}`)
            ]);

            const achievementsData = await achievementsRes.json();
            const areasData = await areasRes.json();

            // Auto-gerar IDs se não existirem ou se estiverem duplicados
            let achievementsWithIds = this.autoGenerateIds(achievementsData.achievements);

            // Criar um hash dos dados para detectar mudanças
            const currentHash = JSON.stringify(achievementsWithIds);
            const savedVersion = localStorage.getItem('dataVersion');
            const savedAchievements = localStorage.getItem('achievements');

            // Se o JSON mudou, limpar localStorage e usar novos dados
            if (savedVersion !== currentHash) {
                console.log('JSON foi modificado, atualizando dados...');
                localStorage.setItem('dataVersion', currentHash);
                localStorage.removeItem('achievements');
                this.achievements = achievementsWithIds;
                this.saveToLocalStorage();
            } else if (savedAchievements) {
                // Dados salvos estão atualizados, usar do localStorage
                const parsed = JSON.parse(savedAchievements);
                if (parsed.length > 0 && parsed[0].areaId !== undefined) {
                    this.achievements = parsed;
                } else {
                    // Dados antigos, usar novos
                    this.achievements = achievementsWithIds;
                    this.saveToLocalStorage();
                }
            } else {
                this.achievements = achievementsWithIds;
                this.saveToLocalStorage();
            }

            this.areas = areasData.areas;

            // Debug
            console.log('Achievements carregadas:', this.achievements.length);
            console.log('Primeira conquista:', this.achievements[0]);
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
            this.showToast('Erro ao carregar dados', true);
        }
    }

    autoGenerateIds(achievements) {
        // Verificar se precisamos gerar IDs
        const hasAllIds = achievements.every((a, index) => a.id === index + 1);

        if (!hasAllIds) {
            console.log('Gerando IDs automaticamente...');
            // Atribuir IDs sequenciais
            return achievements.map((achievement, index) => ({
                ...achievement,
                id: index + 1
            }));
        }

        return achievements;
    }

    saveToLocalStorage() {
        localStorage.setItem('achievements', JSON.stringify(this.achievements));

        // Se o usuário estiver logado, gravar no Firestore (com debounce)
        if (this.currentUser) {
            this.debouncedSaveToServer(this.currentUser.uid);
        }
    }

    setupEventListeners() {
        // Botões de filtro
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.renderAchievements();
            });
        });

        // Botão desbloquear aleatória
        document.getElementById('unlockRandomBtn').addEventListener('click', () => {
            this.unlockRandom();
        });

        // Botão resetar
        document.getElementById('resetBtn').addEventListener('click', () => {
            if (confirm('Tem certeza que deseja resetar todas as conquistas?')) {
                this.resetAll();
            }
        });
    }

    setupAuthListeners() {
        // Elements
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const userEmailEl = document.getElementById('userEmail');
        const loginModal = document.getElementById('loginModal');
        const closeLoginBtn = document.getElementById('closeLoginBtn');

        if (loginBtn) loginBtn.addEventListener('click', () => loginModal.classList.remove('hidden'));
        if (closeLoginBtn) closeLoginBtn.addEventListener('click', () => loginModal.classList.add('hidden'));
        if (logoutBtn) logoutBtn.addEventListener('click', async () => {
            if (window.firebaseService) {
                await window.firebaseService.signOut();
            }
        });



        // Google sign-in
        const googleBtn = document.getElementById('googleSignInBtn');
        if (googleBtn) {
            googleBtn.addEventListener('click', async () => {
                try {
                    await window.firebaseService.signInWithGoogle();
                    loginModal.classList.add('hidden');
                    this.showToast('Login com Google bem-sucedido');
                } catch (error) {
                    console.error('Erro no login com Google', error);
                    this.showToast('Erro no login com Google: ' + (error.message || error), true);
                }
            });
        }

        // Migrate button
        const migrateBtn = document.getElementById('migrateBtn');
        if (migrateBtn) {
            migrateBtn.addEventListener('click', async () => {
                if (!this.currentUser) {
                    this.showToast('Faça login para migrar seu progresso', true);
                    return;
                }
                const unlockedIds = this.achievements.filter(a => a.unlocked).map(a => a.id);
                const totalPoints = this.achievements.reduce((sum, a) => sum + (a.unlocked ? a.points : 0), 0);
                try {
                    this.updateSyncStatus('Migrando...');
                    const res = await window.firebaseService.callFunction('importUserProgress', {
                        uid: this.currentUser.uid,
                        unlockedIds,
                        totalPoints,
                        merge: true
                    });
                    if (res && res.success) {
                        this.updateSyncStatus('Migrado');
                        this.showToast('Progresso migrado com sucesso!');
                    } else {
                        this.updateSyncStatus('Erro');
                        this.showToast('Ocorreu um erro durante a migração', true);
                    }
                } catch (err) {
                    console.error('Migration error', err);
                    this.updateSyncStatus('Erro');
                    this.showToast('Erro ao migrar: ' + (err.message || err), true);
                }
            });
        }



        // Auth state observer
        if (window.firebaseService && window.firebaseService.onAuthStateChanged) {
            window.firebaseService.onAuthStateChanged(user => this.handleAuthStateChange(user));
        }
    }

    handleAuthStateChange(user) {
        this.currentUser = user;
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const userEmailEl = document.getElementById('userEmail');

        if (user) {
            if (loginBtn) loginBtn.hidden = true;
            if (logoutBtn) logoutBtn.hidden = false;
            if (userEmailEl) userEmailEl.textContent = user.email || '';
            // Carregar progresso do usuário
            this.loadUserDataFor(user.uid);
        } else {
            if (loginBtn) loginBtn.hidden = false;
            if (logoutBtn) logoutBtn.hidden = true;
            if (userEmailEl) userEmailEl.textContent = '';
            this.updateSyncStatus('Offline');
        }
    }

    async loadUserDataFor(uid) {
        if (!window.firebaseService) return;
        const remote = await window.firebaseService.loadUserProgress(uid);
        if (!remote) {
            // Nenhum progresso remoto: salvar o local atual
            await this.saveUserProgressToServer(uid);
            this.updateSyncStatus('Nenhum progresso remoto, salvo localmente');
        } else {
            this.mergeRemoteProgress(remote);
            this.updateSyncStatus('Progresso carregado');
        }
    }

    mergeRemoteProgress(remote) {
        const remoteUnlocked = remote.unlockedIds || [];
        const localUnlocked = this.achievements.filter(a => a.unlocked).map(a => a.id);
        const mergedSet = new Set([...remoteUnlocked, ...localUnlocked]);

        this.achievements.forEach(a => {
            a.unlocked = mergedSet.has(a.id);
        });

        this.saveToLocalStorage();
        this.render();

        // Salvar novamente o estado mesclado no servidor
        if (this.currentUser) {
            this.saveUserProgressToServer(this.currentUser.uid);
        }
    }

    debouncedSaveToServer(uid) {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.saveUserProgressToServer(uid);
        }, 1000);
    }

    async saveUserProgressToServer(uid) {
        if (!window.firebaseService) return;

        const unlockedIds = this.achievements.filter(a => a.unlocked).map(a => a.id);
        const totalPoints = this.achievements.reduce((sum, a) => sum + (a.unlocked ? a.points : 0), 0);
        const progress = { unlockedIds, totalPoints, lastUpdated: Date.now() };

        const ok = await window.firebaseService.saveUserProgress(uid, progress);
        if (!ok) {
            this.showToast('Erro ao salvar progresso no servidor', true);
            this.updateSyncStatus('Erro ao salvar', true);
        } else {
            this.updateSyncStatus('Sincronizado');
        }
    }

    renderAreas() {
        const nav = document.getElementById('areasNav');
        nav.innerHTML = '';

        // Botão "Todas as Áreas"
        const allAreasBtn = document.createElement('button');
        allAreasBtn.className = 'area-btn';
        allAreasBtn.innerHTML = `
            <span class="area-icon">🎮</span>
            <span class="area-info">
                <span class="area-name">Todas as Áreas</span>
                <span class="area-count">${this.achievements.length} conquistas</span>
            </span>
        `;
        allAreasBtn.addEventListener('click', () => this.selectArea(null));
        nav.appendChild(allAreasBtn);

        // Botões das áreas
        this.areas.forEach(area => {
            const achievementsInArea = this.achievements.filter(a => a.areaId === area.id);
            const unlockedInArea = achievementsInArea.filter(a => a.unlocked).length;

            const btn = document.createElement('button');
            btn.className = 'area-btn';
            btn.dataset.areaId = area.id;
            btn.innerHTML = `
                <span class="area-icon">${area.icon}</span>
                <span class="area-info">
                    <span class="area-name">${area.name}</span>
                    <span class="area-count">${unlockedInArea}/${achievementsInArea.length}</span>
                </span>
            `;
            btn.addEventListener('click', () => this.selectArea(area.id));
            nav.appendChild(btn);
        });
    }

    selectArea(areaId) {
        this.currentAreaId = areaId;
        this.currentFilter = 'todas';

        // Atualizar botões
        document.querySelectorAll('.area-btn').forEach(btn => {
            btn.classList.remove('active');
            const btnAreaId = btn.dataset.areaId ? parseInt(btn.dataset.areaId) : null;
            if (areaId === null && btnAreaId === null) {
                btn.classList.add('active');
            } else if (btnAreaId === areaId) {
                btn.classList.add('active');
            }
        });

        // Resetar filtro
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === 'todas');
        });

        // Renderizar
        this.updateTitle();
        this.render();
    }

    updateTitle() {
        const titleElement = document.getElementById('areaTitle');
        if (this.currentAreaId === null) {
            titleElement.textContent = 'Progresso Geral';
        } else {
            const area = this.areas.find(a => a.id === this.currentAreaId);
            titleElement.textContent = area ? `Progresso - ${area.name}` : 'Progresso Geral';
        }
    }

    getFilteredAchievements() {
        let filtered = this.achievements;

        // Filtrar por área
        if (this.currentAreaId !== null) {
            console.log('Filtrando por areaId:', this.currentAreaId);
            console.log('Total de achievements:', filtered.length);
            filtered = filtered.filter(a => a.areaId === parseInt(this.currentAreaId));
            console.log('Achievements após filtrar por área:', filtered.length);
        }

        // Filtrar por status
        if (this.currentFilter === 'desbloqueadas') {
            filtered = filtered.filter(a => a.unlocked);
        } else if (this.currentFilter === 'bloqueadas') {
            filtered = filtered.filter(a => !a.unlocked);
        }

        // Ordenar por raridade (comum -> incomum -> raro -> épico -> lendário)
        const rarityOrder = { comum: 0, incomum: 1, raro: 2, épico: 3, lendário: 4 };
        filtered.sort((a, b) => {
            return rarityOrder[a.rarity] - rarityOrder[b.rarity];
        });

        return filtered;
    }

    setupAchievementCardListeners() {
        const cards = document.querySelectorAll('.achievement-card');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                const achievementId = parseInt(card.dataset.id);
                const achievement = this.achievements.find(a => a.id === achievementId);
                if (achievement) {
                    this.toggleAchievement(achievement);
                }
            });
        });
    }

    toggleAchievement(achievement) {
        achievement.unlocked = !achievement.unlocked;
        this.saveToLocalStorage();
        this.render();

        if (achievement.unlocked) {
            this.showToast(`🎉 Conquista desbloqueada: ${achievement.name}! +${achievement.points} pontos`);
        } else {
            this.showToast(`Conquista bloqueada: ${achievement.name}`, false);
        }
    }

    unlockRandom() {
        const filtered = this.getFilteredAchievements();
        const locked = filtered.filter(a => !a.unlocked);

        if (locked.length === 0) {
            this.showToast('Todas as conquistas já foram desbloqueadas!', false);
            return;
        }

        const randomIndex = Math.floor(Math.random() * locked.length);
        const randomAchievement = locked[randomIndex];
        randomAchievement.unlocked = true;

        this.saveToLocalStorage();
        this.render();
        this.showToast(`🎉 Conquista desbloqueada: ${randomAchievement.name}! +${randomAchievement.points} pontos`);
    }

    resetAll() {
        if (this.currentAreaId !== null) {
            this.achievements.filter(a => a.areaId === this.currentAreaId).forEach(a => a.unlocked = false);
        } else {
            this.achievements.forEach(a => a.unlocked = false);
        }
        this.saveToLocalStorage();
        this.render();
        this.showToast('Conquistas foram resetadas!');
    }

    updateStats() {
        const filtered = this.getFilteredAchievements();
        const unlockedCount = filtered.filter(a => a.unlocked).length;
        const totalPoints = filtered.reduce((sum, a) => sum + (a.unlocked ? a.points : 0), 0);
        const progress = filtered.length > 0 ? (unlockedCount / filtered.length) * 100 : 0;

        document.getElementById('unlockedCount').textContent = unlockedCount;
        document.getElementById('totalPoints').textContent = totalPoints;

        // Atualizar progresso com troféu se 100%
        const progressPercentageEl = document.getElementById('progressPercentage');
        const progressText = `${Math.round(progress)}%`;

        if (progress === 100 && filtered.length > 0) {
            progressPercentageEl.innerHTML = `${progressText} 🏆`;
        } else {
            progressPercentageEl.textContent = progressText;
        }

        document.getElementById('progressText').textContent = `${unlockedCount}/${filtered.length}`;
        document.getElementById('progressBar').style.width = `${progress}%`;

        // Atualizar sidebar com contadores
        this.renderAreas();
    }

    render() {
        this.updateStats();
        this.renderAchievements();
        this.setupAchievementCardListeners();
    }

    renderAchievements() {
        const grid = document.getElementById('achievementsGrid');
        const filtered = this.getFilteredAchievements();
        grid.innerHTML = '';

        if (filtered.length === 0) {
            grid.innerHTML = '<p class="no-achievements">Nenhuma conquista encontrada</p>';
            return;
        }

        filtered.forEach(achievement => {
            const card = document.createElement('div');
            card.className = `achievement-card ${achievement.rarity}`;
            card.dataset.id = achievement.id;

            if (!achievement.unlocked) {
                card.classList.add('locked');
            }

            card.innerHTML = `
                <div class="achievement-icon">${achievement.icon}</div>
                <h3 class="achievement-name">${achievement.name}</h3>
                <p class="achievement-description">${achievement.description}</p>
                <div class="achievement-footer">
                    <span class="achievement-points">+${achievement.points} pts</span>
                    <span class="achievement-status ${achievement.unlocked ? 'unlocked' : 'locked'}">
                        ${achievement.unlocked ? 'Desbloqueada' : 'Bloqueada'}
                    </span>
                </div>
            `;

            grid.appendChild(card);
        });
    }

    updateSyncStatus(msg, isError = false) {
        const el = document.getElementById('syncStatus');
        if (!el) return;
        el.textContent = msg;
        if (isError) {
            el.style.color = 'var(--danger-color)';
        } else {
            el.style.color = 'var(--text-muted)';
        }
    }

    showToast(message, isError = false) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');

        if (isError) {
            toast.classList.add('error');
        } else {
            toast.classList.remove('error');
        }

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

// Iniciar aplicação quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    new AchievementManager();
});

