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

// Callable function to send a friend request.
// data: { toUid }
exports.sendFriendRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado.');
    }
    const fromUid = context.auth.uid;
    const toUid = data.toUid;
    if (!toUid) {
        throw new functions.https.HttpsError('invalid-argument', 'toUid obrigatório');
    }
    if (fromUid === toUid) {
        throw new functions.https.HttpsError('invalid-argument', 'Não é possível enviar solicitação para si mesmo');
    }

    try {
        // Check if toUid user exists
        const targetUserDoc = await db.collection('usersPublic').doc(toUid).get();
        if (!targetUserDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Usuário não encontrado');
        }

        // Prevent duplicate or already accepted requests
        const requestsRef = db.collection('friendRequests');
        const existing = await requestsRef
            .where('fromUid', '==', fromUid)
            .where('toUid', '==', toUid)
            .get();
        if (!existing.empty) {
            // If there's any request doc, check status in docs to decide
            let found = false;
            let foundStatus = null;
            existing.forEach(doc => {
                const status = doc.data().status;
                if (status === 'pending' || status === 'accepted') {
                    found = true;
                    foundStatus = status;
                }
            });
            if (found) {
                const msg = foundStatus === 'accepted' ? 'Vocês já são amigos' : 'Uma solicitação pendente já existe';
                throw new functions.https.HttpsError('already-exists', msg);
            }
        }

        // Check reverse direction too
        const reverseExisting = await requestsRef
            .where('fromUid', '==', toUid)
            .where('toUid', '==', fromUid)
            .get();
        if (!reverseExisting.empty) {
            let foundStatus = null;
            reverseExisting.forEach(doc => {
                const status = doc.data().status;
                if (status === 'pending') foundStatus = status;
            });
            if (foundStatus === 'pending') {
                throw new functions.https.HttpsError('already-exists', 'Este usuário já enviou uma solicitação para você');
            }
        }

        const req = {
            fromUid,
            toUid,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await requestsRef.add(req);
        console.debug('sendFriendRequest success:', { fromUid, toUid, requestId: docRef.id });
        return { success: true, id: docRef.id };
    } catch (err) {
        console.error('sendFriendRequest error:', { fromUid, toUid, errCode: err.code, errMsg: err.message });
        throw err;
    }
});

// Callable function to accept a friend request.
// data: { requestId }
exports.acceptFriendRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado.');
    }
    const uid = context.auth.uid;
    const requestId = data.requestId;
    if (!requestId) {
        throw new functions.https.HttpsError('invalid-argument', 'requestId obrigatório');
    }
    try {
        const reqRef = db.collection('friendRequests').doc(requestId);
        const reqDoc = await reqRef.get();
        if (!reqDoc.exists) throw new functions.https.HttpsError('not-found', 'Solicitação não encontrada');
        const reqData = reqDoc.data();
        if (reqData.toUid !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Somente o destinatário pode aceitar');
        }
        if (reqData.status === 'accepted') {
            return { success: true, message: 'Já aceita' };
        }

        // Create mutual friend docs under users/{uid}/friends/{friendUid}
        const batch = db.batch();
        const { fromUid, toUid } = reqData;

        const f1 = db.collection('users').doc(toUid).collection('friends').doc(fromUid);
        const f2 = db.collection('users').doc(fromUid).collection('friends').doc(toUid);
        const now = admin.firestore.FieldValue.serverTimestamp();

        batch.set(f1, { uid: fromUid, since: now });
        batch.set(f2, { uid: toUid, since: now });
        batch.update(reqRef, { status: 'accepted', acceptedAt: now });
        await batch.commit();
        return { success: true };
    } catch (err) {
        console.error('acceptFriendRequest error', err);
        throw new functions.https.HttpsError('internal', 'Erro ao aceitar solicitação');
    }
});

// Callable function to reject a friend request.
// data: { requestId }
exports.rejectFriendRequest = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado.');
    }
    const uid = context.auth.uid;
    const requestId = data.requestId;
    if (!requestId) {
        throw new functions.https.HttpsError('invalid-argument', 'requestId obrigatório');
    }
    try {
        const reqRef = db.collection('friendRequests').doc(requestId);
        const reqDoc = await reqRef.get();
        if (!reqDoc.exists) throw new functions.https.HttpsError('not-found', 'Solicitação não encontrada');
        const reqData = reqDoc.data();
        if (reqData.toUid !== uid && reqData.fromUid !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Somente quem enviou ou recebeu pode rejeitar');
        }
        if (reqData.status === 'rejected') {
            return { success: true, message: 'Já rejeitada' };
        }
        await reqRef.update({ status: 'rejected', rejectedAt: admin.firestore.FieldValue.serverTimestamp() });
        return { success: true };
    } catch (err) {
        console.error('rejectFriendRequest error', err);
        throw new functions.https.HttpsError('internal', 'Erro ao rejeitar solicitação');
    }
});

// Callable function to get a friend's public profile + unlocked achievements.
// data: { friendUid }
// If the requester is a friend, return full profile with unlocked achievements.
// If not a friend, return permission-denied so client can show fallback UI.
exports.getFriendProfile = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Usuário não autenticado.');
    }
    const requesterUid = context.auth.uid;
    const friendUid = data.friendUid;
    if (!friendUid) {
        throw new functions.https.HttpsError('invalid-argument', 'friendUid obrigatório');
    }
    if (requesterUid === friendUid) {
        throw new functions.https.HttpsError('invalid-argument', 'Não é possível ver perfil de si mesmo deste endpoint');
    }

    try {
        // Check if friendship exists
        const friendDoc = await db.collection('users').doc(friendUid).collection('friends').doc(requesterUid).get();
        const isFriend = friendDoc.exists;

        // If not a friend, return permission-denied to trigger fallback UI
        if (!isFriend) {
            throw new functions.https.HttpsError('permission-denied', 'Você precisa ser amigo para ver este perfil');
        }

        // Return friend's public profile (from usersPublic) and unlocked progress
        const publicDoc = await db.collection('usersPublic').doc(friendUid).get();
        const userDoc = await db.collection('users').doc(friendUid).get();
        const publicData = publicDoc.exists ? publicDoc.data() : {};
        const privateData = userDoc.exists ? { unlockedIds: userDoc.data().unlockedIds || [], totalPoints: userDoc.data().totalPoints || 0 } : { unlockedIds: [], totalPoints: 0 };

        console.debug('getFriendProfile success:', { requesterUid, friendUid, isFriend });
        return { success: true, profile: { ...publicData, ...privateData } };
    } catch (err) {
        console.error('getFriendProfile error:', { requesterUid, friendUid, errCode: err.code, errMsg: err.message });
        throw err;
    }
});

// Migration callable removed – keep search logic to use `searchName` prefixes only.
