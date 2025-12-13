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

    const functionsClient = firebase.functions ? firebase.functions() : null;

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
        callFunction: async (name, data) => {
            if (!functionsClient) throw new Error('Firebase functions client not available');
            try {
                const func = functionsClient.httpsCallable(name);
                const res = await func(data);
                return res.data;
            } catch (error) {
                console.error('Function call error', name, error);
                throw error;
            }
        }
    };
})();
