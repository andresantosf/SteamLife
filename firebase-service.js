// firebase-service.js
// Initializes Firebase and exposes helper functions via window.firebaseService

(function () {
    if (!window.firebaseConfig) {
        console.warn('firebaseConfig not found. Create firebase-config.js from firebase-config.example.js and fill in your project keys.');
    }

    // Load Firebase into global namespace via compat build
    // Assumes firebase-app-compat, auth-compat, and firestore-compat scripts are loaded in the page
    if (!window.firebase || !window.firebase.initializeApp) {
        console.error('Firebase not loaded. Ensure firebase scripts are included in index.html.');
        return;
    }

    const app = firebase.initializeApp(window.firebaseConfig || {});
    const auth = firebase.auth();
    const db = firebase.firestore();

    // Enable offline persistence where possible
    if (db && db.enablePersistence) {
        db.enablePersistence()
            .catch(function (err) {
                console.warn('Firestore persistence enable error', err);
            });
    }

    // No cloud functions client: we'll implement helper functions using Firestore client-side

    window.firebaseService = {
        onAuthStateChanged: (cb) => auth.onAuthStateChanged(cb),
        signInWithGoogle: () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            return auth.signInWithPopup(provider);
        },
        signOut: () => auth.signOut(),
        getCurrentUser: () => auth.currentUser,
        loadUserProgress: async (uid) => {
            try {
                const doc = await db.collection('users').doc(uid).get();
                return doc.exists ? doc.data() : null;
            } catch (error) {
                console.error('Error loading user progress', error);
                return null;
            }
        },
        saveUserProgress: async (uid, progress) => {
            try {
                await db.collection('users').doc(uid).set(progress, { merge: true });
                return true;
            } catch (error) {
                console.error('Error saving user progress', error);
                return false;
            }
        },
        // Helper: build n-grams for substring search
        // (Removed buildNgrams: no n-gram approach - keeping searchName prefix queries)

        // Friend helpers implemented using Firestore client (see below)
        sendFriendRequest: async (toUid) => {
            try {
                const user = auth.currentUser;
                if (!user) throw new Error('unauthenticated');
                const fromUid = user.uid;
                if (!toUid) throw new Error('invalid-argument');
                if (fromUid === toUid) throw new Error('invalid-argument');
                const targetDoc = await db.collection('usersPublic').doc(toUid).get();
                if (!targetDoc.exists) throw new Error('not-found');
                const myFriend = await db.collection('users').doc(fromUid).collection('friends').doc(toUid).get();
                if (myFriend.exists) throw new Error('already-friends');
                const requestsRef = db.collection('friendRequests');
                const existing = await requestsRef.where('fromUid', '==', fromUid).where('toUid', '==', toUid).get();
                if (!existing.empty) {
                    for (const doc of existing.docs) {
                        const status = doc.data().status;
                        if (status === 'pending' || status === 'accepted') throw new Error('already-exists');
                    }
                }
                const reverse = await requestsRef.where('fromUid', '==', toUid).where('toUid', '==', fromUid).get();
                if (!reverse.empty) {
                    for (const doc of reverse.docs) {
                        const status = doc.data().status;
                        if (status === 'pending') throw new Error('reverse-pending');
                        if (status === 'accepted') throw new Error('already-friends');
                    }
                }
                const req = { fromUid, toUid, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() };
                const docRef = await requestsRef.add(req);
                return { success: true, id: docRef.id };
            } catch (err) {
                console.error('sendFriendRequest error', err);
                throw err;
            }
        },
        acceptFriendRequest: async (requestId) => {
            try {
                const user = auth.currentUser;
                if (!user) throw new Error('unauthenticated');
                const uid = user.uid;
                const reqRef = db.collection('friendRequests').doc(requestId);
                const reqDoc = await reqRef.get();
                if (!reqDoc.exists) throw new Error('not-found');
                const reqData = reqDoc.data();
                if (reqData.toUid !== uid) throw new Error('permission-denied');
                if (reqData.status === 'accepted') return { success: true };
                await reqRef.update({ status: 'accepted', acceptedAt: firebase.firestore.FieldValue.serverTimestamp() });
                const friendId = reqData.fromUid;
                await db.collection('users').doc(uid).collection('friends').doc(friendId).set({ uid: friendId, since: firebase.firestore.FieldValue.serverTimestamp() });
                return { success: true };
            } catch (err) {
                console.error('acceptFriendRequest error', err);
                throw err;
            }
        },
        rejectFriendRequest: async (requestId) => {
            try {
                const user = auth.currentUser;
                if (!user) throw new Error('unauthenticated');
                const uid = user.uid;
                const reqRef = db.collection('friendRequests').doc(requestId);
                const reqDoc = await reqRef.get();
                if (!reqDoc.exists) throw new Error('not-found');
                const reqData = reqDoc.data();
                if (reqData.fromUid !== uid && reqData.toUid !== uid) throw new Error('permission-denied');
                if (reqData.status === 'rejected') return { success: true };
                await reqRef.update({ status: 'rejected', rejectedAt: firebase.firestore.FieldValue.serverTimestamp() });
                return { success: true };
            } catch (err) {
                console.error('rejectFriendRequest error', err);
                throw err;
            }
        },
        getFriendProfile: async (friendUid) => {
            try {
                const user = auth.currentUser;
                if (!user) throw new Error('unauthenticated');
                const requesterUid = user.uid;
                const publicDoc = await db.collection('usersPublic').doc(friendUid).get();
                const publicData = publicDoc.exists ? publicDoc.data() : {};
                const mutualFriendDoc = await db.collection('users').doc(friendUid).collection('friends').doc(requesterUid).get();
                const isFriend = mutualFriendDoc.exists;
                let privateData = { unlockedIds: [], totalPoints: 0 };
                if (isFriend) {
                    const userDoc = await db.collection('users').doc(friendUid).get();
                    if (userDoc.exists) {
                        const d = userDoc.data();
                        privateData = { unlockedIds: d.unlockedIds || [], totalPoints: d.totalPoints || 0 };
                    }
                }
                return { success: true, profile: { ...publicData, ...privateData }, isFriend };
            } catch (err) {
                console.error('getFriendProfile error', err);
                throw err;
            }
        },

        // Search users via public collection (case-insensitive prefix search on 'searchName').
        searchUsersPublic: async (query) => {
            try {
                const qNormalized = (query || '').trim().toLowerCase();
                console.debug('searchUsersPublic: rawQuery=', query, 'normalized=', qNormalized);
                if (!qNormalized) return [];
                // Use 'searchName' prefix range only (no n-grams).
                let snapshot = null;
                // perform prefix range on searchName
                snapshot = null;
                if (!snapshot || snapshot === null) {
                    const q = db.collection('usersPublic')
                        .where('searchName', '>=', qNormalized)
                        .where('searchName', '<=', qNormalized + '\uf8ff')
                        .limit(100); // return more results for broader searches
                    snapshot = await q.get();
                }
                const results = [];
                snapshot.forEach(doc => results.push({ uid: doc.id, ...doc.data() }));
                // If still nothing, and dataset small, fallback to scanning collection and filter
                if (results.length === 0) {
                    try {
                        const fallbackSnapshot = await db.collection('usersPublic').limit(500).get();
                        fallbackSnapshot.forEach(doc => {
                            const data = doc.data();
                            if ((data.displayName || '').toLowerCase().indexOf(qNormalized) !== -1) {
                                results.push({ uid: doc.id, ...data });
                            }
                        });
                    } catch (e) {
                        console.debug('searchUsersPublic: fallback collection scan failed', e && e.code);
                    }
                }
                // Client-side filter: ensure displayName contains query substring (in case of e.g. searchName includes accents etc.)
                const out = results.filter(r => (r.displayName || '').toLowerCase().indexOf(qNormalized) !== -1);
                console.debug('searchUsersPublic: found=', results.length, 'ids=', results.map(r => r.uid));
                return out;
            } catch (err) {
                console.error('searchUsersPublic error', err);
                return [];
            }
        },

        getPublicProfile: async (uid) => {
            try {
                const doc = await db.collection('usersPublic').doc(uid).get();
                return doc.exists ? doc.data() : null;
            } catch (err) {
                console.error('getPublicProfile error', err);
                return null;
            }
        },
        // isAdmin/migrateSearchNgrams functions were removed to keep only prefix query behavior
        savePublicProfile: async (uid, publicData) => {
            try {
                const dataToSave = { ...publicData };
                if (dataToSave.displayName) {
                    dataToSave.searchName = dataToSave.displayName.trim().toLowerCase();
                }
                // no extra fields required; use normalized `searchName` only
                await db.collection('usersPublic').doc(uid).set(dataToSave, { merge: true });
                return true;
            } catch (err) {
                console.error('savePublicProfile error', err);
                return false;
            }
        },
        // Keep generic fallback caller removed (no functions)
    };
})();
