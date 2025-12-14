// Classe para gerenciar as conquistas e áreas
class AchievementManager {
    constructor() {
        this.achievements = [];
        this.areas = [];
        this.currentAreaId = null;
        this.currentView = 'achievements'; // 'achievements' or 'friends'
        this.currentFilter = 'todas';
        this.friendsMap = new Set();
        this.pendingRequests = new Map(); // key: otherUid -> { direction: 'sent'|'received', requestId }
        this.lastSearchResults = [];
        this.dataVersion = null;
        this.currentUser = null;
        this.saveTimeout = null;
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.setupAuthListeners();
        this.setupFriendsListeners();
        this.setupNameModal();
        this.setupNotifications();
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
        const modalCloseX = document.getElementById('loginModalCloseX');
        if (modalCloseX) modalCloseX.addEventListener('click', () => loginModal.classList.add('hidden'));
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
                    if (!window.firebaseService || !window.firebaseService.signInWithGoogle) {
                        console.error('firebaseService.signInWithGoogle is not available');
                        this.showToast('Serviço de autenticação indisponível', true);
                        return;
                    }
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

        // Prompt login on start if user is not authenticated (small delay for SDK init)
        setTimeout(() => {
            try {
                let current = null;
                if (window.firebaseService && typeof window.firebaseService.getCurrentUser === 'function') {
                    current = window.firebaseService.getCurrentUser();
                } else if (window.firebaseService && window.firebaseService.auth && window.firebaseService.auth.currentUser) {
                    current = window.firebaseService.auth.currentUser;
                } else if (window.firebase && firebase.auth) {
                    current = firebase.auth().currentUser;
                }
                if (!current) {
                    if (loginModal) loginModal.classList.remove('hidden');
                }
            } catch (e) {
                // ignore
            }
        }, 500);
    }

    async handleAuthStateChange(user) {
        this.currentUser = user;
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const userEmailEl = document.getElementById('userEmail');
        const friendsNavBtn = document.getElementById('friendsNavBtn');

        if (user) {
            // update search UI now that auth changed
            this.updateFriendsAuthState();
            if (loginBtn) loginBtn.hidden = true;
            if (logoutBtn) logoutBtn.hidden = false;
            if (userEmailEl) userEmailEl.textContent = user.email || '';
            if (friendsNavBtn) friendsNavBtn.style.display = 'flex';
            // Carregar progresso do usuário
            this.loadUserDataFor(user.uid);
            // Subscribe to realtime updates for friends and friendRequests
            this.subscribeToFriends();
            this.subscribeToFriendRequests();
            // Save public profile for search
            if (window.firebaseService) {
                await window.firebaseService.savePublicProfile(user.uid, { displayName: user.displayName || '', photoURL: user.photoURL || '' });
                // Load public profile and set header to displayName if exists
                const publicProfile = await window.firebaseService.getPublicProfile(user.uid);
                const headerName = (publicProfile && publicProfile.displayName) || user.displayName || user.email || '';
                if (userEmailEl) userEmailEl.textContent = headerName;
                // Check if the profile has name; if not, open name modal
                if (!publicProfile || !publicProfile.displayName) {
                    const nameModal = document.getElementById('setNameModal');
                    const nameInput = document.getElementById('displayNameInput');
                    if (nameInput && nameModal) {
                        nameInput.value = user.displayName || (user.email ? user.email.split('@')[0] : '');
                        nameModal.classList.remove('hidden');
                    }
                }
                // We do not show any admin actions here.
            }
        } else {
            // update UI for friends search when user signed out
            this.updateFriendsAuthState();
            if (loginBtn) loginBtn.hidden = false;
            if (logoutBtn) logoutBtn.hidden = true;
            if (userEmailEl) userEmailEl.textContent = '';
            if (friendsNavBtn) friendsNavBtn.style.display = 'none';
            // reindexBtn removed
            this.updateSyncStatus('Offline');
            // unsubscribe realtime listeners
            this.unsubscribeFromFriendRequests();
            this.unsubscribeFromFriends();
        }
    }

    setupFriendsListeners() {
        const searchInput = document.getElementById('friendSearch');
        const friendsNavBtn = document.getElementById('friendsNavBtn');

        if (friendsNavBtn) {
            friendsNavBtn.addEventListener('click', () => this.selectFriendsView());
        }

        // wire Enter key to trigger a search (no visible button)
        if (searchInput) {
            searchInput.addEventListener('keydown', async (e) => {
                if (e.key !== 'Enter') return;
                // require login to search
                if (!this.currentUser) {
                    this.showToast('Faça login para pesquisar amigos', true);
                    const loginModal = document.getElementById('loginModal');
                    if (loginModal) loginModal.classList.remove('hidden');
                    return;
                }
                const q = searchInput.value.trim();
                if (!q) return;
                try {
                    const results = await window.firebaseService.searchUsersPublic(q);
                    this.renderFriendSearchResults(results);
                } catch (err) {
                    console.error('Erro buscando usuários públicos', err);
                    this.showToast('Erro ao pesquisar usuários', true);
                }
            });
        }
        // Click on friend list to view profile
        const searchResultsEl = document.getElementById('searchResults');
        if (searchResultsEl) {
            searchResultsEl.addEventListener('click', (e) => {
                const target = e.target.closest('.friend-item');
                if (target && target.dataset.uid) {
                    // Click on search result opens profile
                    this.viewFriendProfile(target.dataset.uid);
                }
                const addBtn = e.target.closest('.add-friend-btn');
                if (addBtn) {
                    const toUid = addBtn.dataset.uid;
                    this.handleSendFriendRequest(toUid, addBtn);
                }
            });
        }
        const friendList = document.getElementById('friendList');
        if (friendList) {
            friendList.addEventListener('click', (e) => {
                const target = e.target.closest('.friend-item');
                if (target && target.dataset.uid) {
                    this.viewFriendProfile(target.dataset.uid);
                }
            });
        }
        // Reindex button for admin
        // removed reindex button handler and admin migration
        const hintEl = document.getElementById('friendSearchHint');
        if (hintEl) {
            hintEl.addEventListener('click', () => {
                if (!this.currentUser) {
                    const loginModal = document.getElementById('loginModal');
                    if (loginModal) loginModal.classList.remove('hidden');
                    this.showToast('Faça login para pesquisar amigos', true);
                }
            });
        }

        // Button in friends page that opens the notification popup
        const openNotifBtn = document.getElementById('openNotifFromFriends');
        if (openNotifBtn) {
            openNotifBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openNotificationsPopup();
            });
        }
    }

    setupNameModal() {
        const nameModal = document.getElementById('setNameModal');
        const nameInput = document.getElementById('displayNameInput');
        const saveBtn = document.getElementById('saveNameBtn');
        const closeBtn = document.getElementById('closeNameBtn');

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const displayName = (nameInput && nameInput.value.trim()) || '';
                if (!displayName) {
                    this.showToast('Digite um nome para ser encontrado', true);
                    return;
                }
                if (!this.currentUser) {
                    this.showToast('Faça login antes de salvar o nome', true);
                    return;
                }
                const success = await window.firebaseService.savePublicProfile(this.currentUser.uid, { displayName, photoURL: this.currentUser.photoURL || '' });
                if (success) {
                    this.showToast('Nome salvo com sucesso');
                    if (nameModal) nameModal.classList.add('hidden');
                    // refresh friends list and requests
                    this.fetchFriends();
                    this.fetchFriendRequests();
                } else {
                    this.showToast('Erro ao salvar nome', true);
                }
            });
        }
        if (closeBtn) closeBtn.addEventListener('click', () => { if (nameModal) nameModal.classList.add('hidden'); });
    }

    updateFriendsAuthState() {
        const searchInput = document.getElementById('friendSearch');
        const hint = document.getElementById('friendSearchHint');
        if (!searchInput || !hint) return;
        if (!this.currentUser) {
            searchInput.disabled = true;
            hint.classList.remove('hidden');
        } else {
            searchInput.disabled = false;
            hint.classList.add('hidden');
        }
    }

    selectFriendsView() {
        // Deselect areas
        document.querySelectorAll('.area-btn').forEach(btn => btn.classList.remove('active'));

        // Activate friends nav button
        const friendsNavBtn = document.getElementById('friendsNavBtn');
        if (friendsNavBtn) friendsNavBtn.classList.add('active');

        // update search UI based on auth
        this.updateFriendsAuthState();

        // Hide achievements views
        const achievementsView = document.getElementById('achievementsView');
        const actionsView = document.getElementById('actionsView');
        const progressSection = document.querySelector('.progress-section');
        const header = document.querySelector('.header');

        if (achievementsView) achievementsView.classList.add('hidden');
        if (actionsView) actionsView.classList.add('hidden');
        if (progressSection) progressSection.classList.add('hidden');
        if (header) header.classList.add('hidden');

        // Show friends page
        const friendsPage = document.getElementById('friendsPage');
        if (friendsPage) friendsPage.classList.remove('hidden');

        this.currentView = 'friends';
    }

    selectAchievementsView() {
        // Deselect friends nav button
        const friendsNavBtn = document.getElementById('friendsNavBtn');
        if (friendsNavBtn) friendsNavBtn.classList.remove('active');

        // Hide friends page
        const friendsPage = document.getElementById('friendsPage');
        if (friendsPage) friendsPage.classList.add('hidden');

        // Show achievements views
        const achievementsView = document.getElementById('achievementsView');
        const actionsView = document.getElementById('actionsView');
        const progressSection = document.querySelector('.progress-section');
        const header = document.querySelector('.header');

        if (achievementsView) achievementsView.classList.remove('hidden');
        if (actionsView) actionsView.classList.remove('hidden');
        if (progressSection) progressSection.classList.remove('hidden');
        if (header) header.classList.remove('hidden');

        this.currentView = 'achievements';
    }

    async renderFriendSearchResults(results) {
        const el = document.getElementById('searchResults');
        if (!el) return;
        el.innerHTML = '';
        const uid = this.currentUser ? this.currentUser.uid : null;
        const hint = document.getElementById('friendSearchHint');
        if (hint) {
            if (!this.currentUser) {
                hint.textContent = 'Faça login para pesquisar por amigos.';
                hint.classList.remove('hidden');
            } else {
                hint.classList.add('hidden');
            }
        }
        const toRender = results && results.length > 0 ? results : (this.lastSearchResults || []);
        this.lastSearchResults = toRender;
        console.debug('renderFriendSearchResults: toRender length=', toRender.length, 'userId=', uid);
        const hintEl = document.getElementById('friendSearchHint');
        if (hintEl) {
            if (!this.currentUser) {
                hintEl.textContent = 'Faça login para pesquisar por amigos.';
            } else {
                hintEl.textContent = `Resultados: ${toRender.length}`;
                hintEl.classList.remove('hidden');
            }
        }
        if (!toRender || toRender.length === 0) {
            el.innerHTML = '<div class="friend-empty">Nenhum usuário encontrado</div>';
            if (hint && this.currentUser) {
                hint.textContent = 'Nenhum usuário encontrado. Apenas usuários que usaram o app e definiram um nome público podem ser encontrados.';
                hint.classList.remove('hidden');
            }
            return;
        }
        for (const r of toRender) {
            // skip self
            if (uid && r.uid === uid) continue;
            const item = document.createElement('div');
            item.className = 'friend-item';
            item.dataset.uid = r.uid;
            const isFriend = this.friendsMap.has(r.uid);
            const pending = this.pendingRequests.get(r.uid);
            let actionHtml = '';
            if (isFriend) {
                actionHtml = `<button class="action-btn" disabled>Amigo</button>`;
            } else if (pending && pending.direction === 'sent') {
                actionHtml = `<button class="action-btn" disabled>Pendente</button>`;
            } else if (pending && pending.direction === 'received') {
                actionHtml = `<button class="action-btn" disabled>Solicitação Recebida</button>`;
            } else {
                actionHtml = `<button class="action-btn add-friend-btn" data-uid="${r.uid}">Adicionar</button>`;
            }

            item.innerHTML = `
                <div class="friend-avatar">${r.photoURL ? `<img src="${r.photoURL}" alt="${r.displayName}">` : '👤'}</div>
                <div class="friend-meta">
                    <strong>${r.displayName || 'Sem nome'}</strong>
                </div>
                <div class="friend-actions">
                    ${actionHtml}
                </div>
            `;
            // delegating add-button click to searchResultsEl handler
            el.appendChild(item);
        }
    }

    async handleSendFriendRequest(toUid, addBtn = null) {
        console.debug('handleSendFriendRequest start', { toUid, currentUid: this.currentUser ? this.currentUser.uid : null });
        if (!this.currentUser) {
            this.showToast('Faça login para enviar solicitações', true);
            const loginModal = document.getElementById('loginModal');
            if (loginModal) loginModal.classList.remove('hidden');
            return;
        }
        if (!toUid) {
            this.showToast('Usuário inválido', true);
            return;
        }
        try {
            const res = await window.firebaseService.sendFriendRequest(toUid);
            console.debug('sendFriendRequest response:', res);
            if (res && res.success) {
                this.pendingRequests.set(toUid, { direction: 'sent', requestId: res.id });
                this.showToast('Solicitação enviada com sucesso!');
                // Update UI - change button state
                if (addBtn) {
                    addBtn.textContent = 'Pendente';
                    addBtn.disabled = true;
                    addBtn.classList.remove('add-friend-btn');
                }
                // re-render last search results
                this.renderFriendSearchResults(this.lastSearchResults);
            } else {
                this.showToast('Erro ao enviar solicitação', true);
            }
        } catch (err) {
            console.error('handleSendFriendRequest error:', { err, code: err.code, message: err.message });
            // Extract error message
            let errorMsg = 'Erro ao enviar solicitação';
            if (err && err.message) {
                if (err.message.includes('already-exists')) {
                    errorMsg = 'Solicitação ou amizade já existe';
                } else if (err.message.includes('not-found')) {
                    errorMsg = 'Usuário não encontrado';
                } else if (err.message.includes('permission-denied')) {
                    errorMsg = 'Sem permissão';
                } else {
                    errorMsg = err.message;
                }
            }
            this.showToast(errorMsg, true);
        }
    }

    async fetchFriendRequests() {
        if (!this.currentUser) return;
        try {
            // get both received and sent pending requests
            const receivedSnapshot = await firebase.firestore().collection('friendRequests')
                .where('toUid', '==', this.currentUser.uid)
                .where('status', '==', 'pending')
                .get();
            const sentSnapshot = await firebase.firestore().collection('friendRequests')
                .where('fromUid', '==', this.currentUser.uid)
                .where('status', '==', 'pending')
                .get();
            // Build pendingRequests map
            this.pendingRequests.clear();
            for (const doc of sentSnapshot.docs) {
                const data = doc.data();
                this.pendingRequests.set(data.toUid, { direction: 'sent', requestId: doc.id });
            }
            for (const doc of receivedSnapshot.docs) {
                const data = doc.data();
                this.pendingRequests.set(data.fromUid, { direction: 'received', requestId: doc.id });
            }
            const container = document.getElementById('friendRequestsList');
            if (!container) return;
            // Render received requests into the friend requests panel using shared builder
            container.innerHTML = '';
            for (const doc of receivedSnapshot.docs) {
                const data = doc.data();
                const publicDoc = await firebase.firestore().collection('usersPublic').doc(data.fromUid).get().catch(() => null);
                const publicData = publicDoc && publicDoc.exists ? publicDoc.data() : { displayName: data.fromUid, photoURL: '' };
                const item = this.createFriendRequestElement(publicData, doc.id);
                container.appendChild(item);
            }
            // After populating pendingRequests, update search UI if visible
            const sr = document.getElementById('searchResults');
            if (sr && sr.children.length) this.renderFriendSearchResults(this.lastSearchResults); // re-render to update states
            // Update notifications UI (bell)
            this.updateNotificationsUI();
        } catch (err) {
            console.error('fetchFriendRequests', err);
        }
    }

    // Create DOM element for a friend request (shared between panel and popup)
    createFriendRequestElement(publicData, requestId) {
        const item = document.createElement('div');
        item.className = 'friend-request';
        item.innerHTML = `
            <div class="request-meta">
                <div class="friend-avatar">${publicData.photoURL ? `<img src="${publicData.photoURL}" alt="${publicData.displayName}">` : '👤'}</div>
                <strong>${publicData.displayName || 'Sem nome'}</strong>
            </div>
            <div class="request-actions">
                <button class="action-btn accept-request" data-id="${requestId}">Aceitar</button>
                <button class="action-btn reject-request" data-id="${requestId}">Rejeitar</button>
            </div>
        `;

        const acceptBtn = item.querySelector('.accept-request');
        const rejectBtn = item.querySelector('.reject-request');
        acceptBtn.addEventListener('click', async () => {
            acceptBtn.disabled = true;
            try {
                const res = await window.firebaseService.acceptFriendRequest(requestId);
                if (res && res.success) {
                    this.showToast('Solicitação aceita');
                    await this.fetchFriends();
                    await this.fetchFriendRequests();
                } else {
                    this.showToast('Erro ao aceitar', true);
                    acceptBtn.disabled = false;
                }
            } catch (err) {
                console.error('acceptFriendRequest error', err);
                this.showToast('Erro ao aceitar', true);
                acceptBtn.disabled = false;
            }
        });

        rejectBtn.addEventListener('click', async () => {
            rejectBtn.disabled = true;
            try {
                const res = await window.firebaseService.rejectFriendRequest(requestId);
                if (res && res.success) {
                    this.showToast('Solicitação rejeitada');
                    await this.fetchFriendRequests();
                } else {
                    this.showToast('Erro ao rejeitar', true);
                    rejectBtn.disabled = false;
                }
            } catch (err) {
                console.error('rejectFriendRequest error', err);
                this.showToast('Erro ao rejeitar', true);
                rejectBtn.disabled = false;
            }
        });

        return item;
    }

    setupNotifications() {
        const notifBtn = document.getElementById('notifBtn');
        const notifPopup = document.getElementById('notifPopup');
        const notifCount = document.getElementById('notifCount');
        if (!notifBtn || !notifPopup || !notifCount) return;

        const closeNotifPopup = () => {
            if (!notifPopup.classList.contains('open')) return;
            notifPopup.classList.remove('open');
            notifBtn.setAttribute('aria-expanded', 'false');
            const onEnd = (e) => {
                if (e.target === notifPopup) {
                    notifPopup.classList.add('hidden');
                    notifPopup.removeEventListener('transitionend', onEnd);
                }
            };
            notifPopup.addEventListener('transitionend', onEnd);
        };

        // Toggle popup on bell click (with animation)
        notifBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (notifPopup.classList.contains('hidden')) {
                await this.renderNotificationsPopup();
                notifPopup.classList.remove('hidden');
                // allow layout to settle then animate
                requestAnimationFrame(() => notifPopup.classList.add('open'));
                notifBtn.setAttribute('aria-expanded', 'true');
            } else {
                closeNotifPopup();
            }
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!notifPopup.classList.contains('hidden')) {
                const target = e.target;
                if (!notifPopup.contains(target) && target !== notifBtn && !notifBtn.contains(target)) {
                    closeNotifPopup();
                }
            }
        });

        // Close on Esc
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeNotifPopup();
            }
        });

        // initial count
        this.updateNotificationsUI();
    }

    // Programmatically open the notifications popup (used by "Abrir Notificações" button)
    async openNotificationsPopup() {
        const notifBtn = document.getElementById('notifBtn');
        const notifPopup = document.getElementById('notifPopup');
        if (!notifBtn || !notifPopup) return;
        if (notifPopup.classList.contains('hidden')) {
            await this.renderNotificationsPopup();
            notifPopup.classList.remove('hidden');
            requestAnimationFrame(() => notifPopup.classList.add('open'));
            notifBtn.setAttribute('aria-expanded', 'true');
        } else {
            // if already open, ensure it's visible
            notifPopup.classList.add('open');
        }
    }

    updateNotificationsUI() {
        const notifCount = document.getElementById('notifCount');
        const notifBtn = document.getElementById('notifBtn');
        if (!notifCount || !notifBtn) return;
        let received = 0;
        for (const [uid, info] of this.pendingRequests.entries()) {
            if (info && info.direction === 'received') received++;
        }
        if (received > 0) {
            notifCount.textContent = String(received);
            notifCount.classList.remove('hidden');
            notifBtn.classList.add('has-notifs');
        } else {
            notifCount.classList.add('hidden');
            notifBtn.classList.remove('has-notifs');
        }
    }

    async renderNotificationsPopup() {
        const notifPopup = document.getElementById('notifPopup');
        if (!notifPopup) return;
        notifPopup.innerHTML = '<h4>Solicitações Pendentes</h4>';

        // gather received pending requests
        const received = [];
        for (const [uid, info] of this.pendingRequests.entries()) {
            if (info && info.direction === 'received') {
                received.push({ uid, requestId: info.requestId });
            }
        }

        if (received.length === 0) {
            notifPopup.innerHTML += '<div class="friend-empty">Nenhuma solicitação pendente</div>';
            return;
        }

        for (const r of received) {
            // fetch public profile (best-effort)
            let publicData = { displayName: r.uid, photoURL: '' };
            try {
                const doc = await firebase.firestore().collection('usersPublic').doc(r.uid).get();
                if (doc.exists) publicData = doc.data();
            } catch (e) {
                // ignore
            }

            const item = this.createFriendRequestElement(publicData, r.requestId);
            // mark element for popup-specific styling
            item.classList.add('notif-item');
            notifPopup.appendChild(item);
        }
    }

    // Real-time listeners for friend requests
    subscribeToFriendRequests() {
        if (!this.currentUser) return;
        const uid = this.currentUser.uid;
        // avoid duplicate listeners
        this.unsubscribeFromFriendRequests();
        const requestsRef = firebase.firestore().collection('friendRequests');

        // Received
        this._frReqUnsubReceived = requestsRef.where('toUid', '==', uid).onSnapshot(async snapshot => {
            for (const change of snapshot.docChanges()) {
                const doc = change.doc;
                const data = doc.data();
                const otherUid = data.fromUid;
                if (change.type === 'added' && data.status === 'pending') {
                    this.pendingRequests.set(otherUid, { direction: 'received', requestId: doc.id });
                } else if (change.type === 'modified') {
                    if (data.status === 'accepted') {
                        // Accepting user will have created own friends doc via acceptFriendRequest
                        this.pendingRequests.delete(otherUid);
                        this.fetchFriends();
                    } else if (data.status === 'rejected') {
                        this.pendingRequests.delete(otherUid);
                    }
                } else if (change.type === 'removed') {
                    this.pendingRequests.delete(otherUid);
                }
            }
            this.fetchFriendRequests();
        }, err => console.error('friendRequests received listener error', err));

        // Sent
        this._frReqUnsubSent = requestsRef.where('fromUid', '==', uid).onSnapshot(async snapshot => {
            for (const change of snapshot.docChanges()) {
                const doc = change.doc;
                const data = doc.data();
                const otherUid = data.toUid;
                if (change.type === 'added' && data.status === 'pending') {
                    this.pendingRequests.set(otherUid, { direction: 'sent', requestId: doc.id });
                } else if (change.type === 'modified') {
                    if (data.status === 'accepted') {
                        // We were the sender; now create our friend doc for otherUid (our own side)
                        try {
                            const myUid = this.currentUser.uid;
                            const frDoc = await firebase.firestore().collection('users').doc(myUid).collection('friends').doc(otherUid).get();
                            if (!frDoc.exists) {
                                await firebase.firestore().collection('users').doc(myUid).collection('friends').doc(otherUid).set({ uid: otherUid, since: firebase.firestore.FieldValue.serverTimestamp() });
                            }
                        } catch (e) {
                            console.error('Error creating friend doc for sender after acceptance', e);
                        }
                        this.pendingRequests.delete(otherUid);
                        this.fetchFriends();
                    } else if (data.status === 'rejected') {
                        this.pendingRequests.delete(otherUid);
                    }
                } else if (change.type === 'removed') {
                    this.pendingRequests.delete(otherUid);
                }
            }
            this.fetchFriendRequests();
        }, err => console.error('friendRequests sent listener error', err));
    }

    unsubscribeFromFriendRequests() {
        if (this._frReqUnsubReceived) {
            try { this._frReqUnsubReceived(); } catch (e) { }
            this._frReqUnsubReceived = null;
        }
        if (this._frReqUnsubSent) {
            try { this._frReqUnsubSent(); } catch (e) { }
            this._frReqUnsubSent = null;
        }
    }

    subscribeToFriends() {
        if (!this.currentUser) return;
        const uid = this.currentUser.uid;
        this.unsubscribeFromFriends();
        this._friendsUnsub = firebase.firestore().collection('users').doc(uid).collection('friends').onSnapshot(snapshot => {
            // rebuild friendsMap
            this.friendsMap.clear();
            snapshot.forEach(doc => {
                const data = doc.data();
                const friendUid = data.uid;
                this.friendsMap.add(friendUid);
            });
            // update UI
            this.fetchFriends(); // Will re-render friend list
            this.renderFriendSearchResults(this.lastSearchResults);
        }, err => console.error('friends listener error', err));
    }

    unsubscribeFromFriends() {
        if (this._friendsUnsub) {
            try { this._friendsUnsub(); } catch (e) { }
            this._friendsUnsub = null;
        }
    }

    async fetchFriends() {
        if (!this.currentUser) return;
        try {
            const snapshot = await firebase.firestore().collection('users').doc(this.currentUser.uid).collection('friends').get();
            const container = document.getElementById('friendList');
            if (!container) return;
            container.innerHTML = '';
            this.friendsMap.clear();
            for (const doc of snapshot.docs) {
                const data = doc.data();
                const friendUid = data.uid;
                this.friendsMap.add(friendUid);
                // Load public profile
                let publicData = { displayName: 'Sem nome' };
                try {
                    const publicDoc = await firebase.firestore().collection('usersPublic').doc(friendUid).get();
                    if (publicDoc.exists) publicData = publicDoc.data();
                } catch (e) {
                    console.error('Error loading public profile for friend', friendUid, e);
                }

                // Load private progress to get totalPoints (if available)
                let progress = null;
                try {
                    if (window.firebaseService && window.firebaseService.loadUserProgress) {
                        progress = await window.firebaseService.loadUserProgress(friendUid);
                    } else {
                        const userDoc = await firebase.firestore().collection('users').doc(friendUid).get();
                        progress = userDoc.exists ? userDoc.data() : null;
                    }
                } catch (e) {
                    console.error('Error loading friend progress for', friendUid, e);
                }

                const points = (progress && (progress.totalPoints || progress.totalPoints === 0)) ? (progress.totalPoints || 0) : (publicData.totalPoints || 0);
                const item = document.createElement('div');
                item.className = 'friend-item';
                item.dataset.uid = friendUid;
                
                item.innerHTML = `
                    <div class="friend-avatar">${publicData.photoURL ? `<img src="${publicData.photoURL}" alt="${publicData.displayName}">` : '👤'}</div>
                    <div class="friend-meta">
                        <div class="name">${publicData.displayName || 'Sem nome'}</div>
                        <div class="small">${publicData.email || ''}</div>
                    </div>
                    <div class="meta-right">
                        <div class="friend-points">+${points}</div>
                    </div>
                `;
                container.appendChild(item);
            }
            // update search results UI if any
            const sr = document.getElementById('searchResults');
            if (sr && sr.children.length) this.renderFriendSearchResults(this.lastSearchResults);
        } catch (err) {
            console.error('fetchFriends', err);
        }
    }

    async viewFriendProfile(friendUid) {
        try {
            console.debug('viewFriendProfile called for:', friendUid);
            const res = await window.firebaseService.getFriendProfile(friendUid);
            console.debug('viewFriendProfile response:', res);
            if (!(res && res.success)) {
                this.showToast('Não foi possível carregar o perfil do amigo', true);
                return;
            }
            const profile = res.profile || {};
            const isFriend = !!res.isFriend;
            const container = document.getElementById('friendProfileContent');
            if (!container) return;
            // Render simple profile header
            let html = `<div class="friend-header">`;
            html += `<div class="friend-avatar">${profile.photoURL ? `<img src="${profile.photoURL}" alt="${profile.displayName}">` : '👤'}</div>`;
            html += `<div class="friend-meta"><strong>${profile.displayName || 'Sem nome'}</strong>`;
            html += `<div>Pontos: ${profile.totalPoints || 0}</div>`;
            html += `</div></div>`;

            if (!isFriend) {
                html += `<div class="friend-note">Este perfil é público. Adicione para ver as conquistas.</div>`;
                html += `<div class="friend-actions"><button id="fpSendRequestBtn" class="action-btn add-friend-btn" data-uid="${friendUid}">Enviar Solicitação</button></div>`;
                container.innerHTML = html;
                const btn = document.getElementById('fpSendRequestBtn');
                if (btn) btn.addEventListener('click', async () => {
                    try {
                        await this.handleSendFriendRequest(friendUid, btn);
                    } catch (e) {
                        // handled in handler
                    }
                });
                return;
            }

            // If friend - show unlocked achievements
            html += `<h4>Conquistas desbloqueadas</h4>`;
            html += `<div class="friend-achievements-grid">`;
            const unlockedIds = profile.unlockedIds || [];
            const unlockedSet = new Set(unlockedIds);

            // Collect achievements unlocked by friend
            const friendAchievements = this.achievements.filter(a => unlockedSet.has(a.id));

            // Define priority for rarities (higher first)
            const rarityPriority = { 'lendário': 5, 'épico': 4, 'raro': 3, 'incomum': 2, 'comum': 1 };

            // Sort by rarity descending so DOM order matches visual priority
            friendAchievements.sort((a, b) => {
                const pa = rarityPriority[a.rarity] || 0;
                const pb = rarityPriority[b.rarity] || 0;
                return pb - pa;
            });

            // Render reduced achievement cards (icon, title, points)
            for (const a of friendAchievements) {
                const icon = a.icon || '🎖️';
                const rarityClass = a.rarity || 'comum';
                const lockedClass = a.unlocked ? '' : ' locked';
                const areaObj = this.areas.find(ar => ar.id === a.areaId || String(ar.id) === String(a.areaId));
                const areaName = areaObj ? areaObj.name : '';

                html += `<div class="friend-achieved-item ${rarityClass}${lockedClass}">
                            <div class="emoji">${icon}</div>
                            <div class="meta">
                                <div class="title">${a.name}</div>
                                <div class="area-badge">${areaName}</div>
                            </div>
                            <div class="points">+${a.points}</div>
                        </div>`;
            }

            html += `</div>`;
            container.innerHTML = html;
        } catch (err) {
            console.error('viewFriendProfile', err);
            // handle unauthenticated specially
            if (err && err.message && err.message.indexOf('unauthenticated') !== -1) {
                this.showToast('Faça login para ver perfis', true);
                const loginModal = document.getElementById('loginModal');
                if (loginModal) loginModal.classList.remove('hidden');
                return;
            }
            const container = document.getElementById('friendProfileContent');
            if (container) container.innerHTML = '<div class="friend-error">Erro ao carregar profile do amigo</div>';
            this.showToast('Erro ao carregar profile do amigo', true);
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
        // Prefer remote progress as authoritative: replace local unlocked state
        const remoteUnlocked = Array.isArray(remote.unlockedIds) ? remote.unlockedIds : [];
        const remoteSet = new Set(remoteUnlocked);

        this.achievements.forEach(a => {
            a.unlocked = remoteSet.has(a.id);
        });

        // Update local storage and UI from remote data. Do NOT overwrite remote immediately.
        this.saveToLocalStorage();
        this.render();
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

        // Deselect friends nav button
        const friendsNavBtn = document.getElementById('friendsNavBtn');
        if (friendsNavBtn) friendsNavBtn.classList.remove('active');

        // Resetar filtro
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === 'todas');
        });

        // Show achievements views
        this.selectAchievementsView();

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
                ${achievement.repeat ? `<div class="achievement-repeat-badge">x${achievement.repeat}</div>` : ''}
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

