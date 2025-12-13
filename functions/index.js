const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize admin (when deployed, env is configured, locally use service account if provided)
try {
    admin.initializeApp();
} catch (e) {
    // already initialized
}

const db = admin.firestore();

// Callable function to import or migrate user progress.
// data: { uid, unlockedIds, totalPoints, merge } - merge defaults to true
// Only allowed if requester is admin or same uid
exports.importUserProgress = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const requesterUid = context.auth.uid;
    const targetUid = data.uid;
    const unlockedIds = Array.isArray(data.unlockedIds) ? data.unlockedIds : [];
    const totalPoints = typeof data.totalPoints === 'number' ? data.totalPoints : 0;
    const merge = data.merge !== undefined ? !!data.merge : true;

    if (!targetUid) {
        throw new functions.https.HttpsError('invalid-argument', 'UID alvo obrigatório');
    }

    // Allow if requester is the same user OR has admin claim
    const isAdmin = context.auth.token && context.auth.token.admin === true;
    if (requesterUid !== targetUid && !isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Sem permissão para alterar outro usuário.');
    }

    try {
        const userRef = db.collection('users').doc(targetUid);
        const doc = await userRef.get();
        let finalUnlocked = new Set(unlockedIds);

        if (doc.exists && merge) {
            const remoteUnlocked = doc.data().unlockedIds || [];
            remoteUnlocked.forEach(id => finalUnlocked.add(id));
        }

        const progress = {
            unlockedIds: Array.from(finalUnlocked),
            totalPoints,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };

        await userRef.set(progress, { merge: true });

        return { success: true, updatedCount: finalUnlocked.size };
    } catch (err) {
        console.error('importUserProgress error', err);
        throw new functions.https.HttpsError('internal', 'Erro ao importar progresso');
    }
});

// Public callable function to return leaderboard (top N users)
// data: { limit }
exports.getLeaderboard = functions.https.onCall(async (data, context) => {
    const limit = typeof data.limit === 'number' ? data.limit : 10;
    try {
        const snapshot = await db.collection('users').orderBy('totalPoints', 'desc').limit(limit).get();
        const leaderboard = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            leaderboard.push({ uid: doc.id, totalPoints: d.totalPoints || 0, lastUpdated: d.lastUpdated || null });
        });
        return { success: true, leaderboard };
    } catch (err) {
        console.error('getLeaderboard error', err);
        throw new functions.https.HttpsError('internal', 'Erro ao buscar leaderboard');
    }
});

// Admin-only function to backup all users to a backup collection (or bucket in future)
// data: { backupCollectionName }
exports.backupAllUsers = functions.https.onCall(async (data, context) => {
    if (!context.auth || !(context.auth.token && context.auth.token.admin === true)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin permissions required');
    }

    const backupCollection = typeof data.backupCollectionName === 'string' && data.backupCollectionName.length > 0 ? data.backupCollectionName : 'users_backup';
    try {
        const usersSnapshot = await db.collection('users').get();
        const batch = db.batch();
        usersSnapshot.forEach(doc => {
            const destRef = db.collection(backupCollection).doc(doc.id);
            batch.set(destRef, { ...doc.data(), backedUpAt: admin.firestore.FieldValue.serverTimestamp() });
        });
        await batch.commit();
        return { success: true, backedUp: usersSnapshot.size };
    } catch (err) {
        console.error('backupAllUsers', err);
        throw new functions.https.HttpsError('internal', 'Erro no backup');
    }
});
