// Classe para gerenciar as conquistas e áreas
class AchievementManager {
    constructor() {
        this.achievements = [];
        this.areas = [];
        this.currentAreaId = null;
        this.currentFilter = 'todas';
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.renderAreas();
        this.selectArea(null);
    }

    async loadData() {
        try {
            const [achievementsRes, areasRes] = await Promise.all([
                fetch('./data/achievements.json'),
                fetch('./data/areas.json')
            ]);

            const achievementsData = await achievementsRes.json();
            const areasData = await areasRes.json();

            // Carregar dados salvos do localStorage
            const savedAchievements = localStorage.getItem('achievements');

            // Se existem dados salvos, verificar se têm areaId (dados novos)
            if (savedAchievements) {
                const parsed = JSON.parse(savedAchievements);
                // Verificar se o primeiro item tem areaId, se não, descartar dados antigos
                if (parsed.length > 0 && parsed[0].areaId !== undefined) {
                    this.achievements = parsed;
                } else {
                    // Dados antigos sem areaId, usar novos dados
                    this.achievements = achievementsData.achievements;
                    this.saveToLocalStorage();
                }
            } else {
                this.achievements = achievementsData.achievements;
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

    saveToLocalStorage() {
        localStorage.setItem('achievements', JSON.stringify(this.achievements));
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

