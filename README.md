# Steam Life - Firebase Integration

This project integrates Firebase Authentication and Firestore to save user achievement progress per user.

## Setup

### 1. Firebase Project Setup

1. Go to https://console.firebase.google.com and create a new project.
2. Add a Web app and copy the config values.
3. Enable Google Authentication:
   - In Firebase Console → Authentication → Sign-in Method
   - Enable 'Google' and configure support
4. Enable Firestore (Native mode):
   - In Firebase Console → Firestore Database
   - Click "Create Database" and select "Native Mode"

### 2. Firestore Security Rules

Set the following security rules in Firestore:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usersPublic/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /friends/{friendId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
    match /friendRequests/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 3. Configure Firebase Credentials

1. Copy `data/firebase-config.example.js` to `data/firebase-config.js`:
   ```bash
   cp data/firebase-config.example.js data/firebase-config.js
   ```

2. Open `data/firebase-config.js` and fill in your Firebase project credentials (get them from Firebase Console → Project Settings → Your apps → Web)

3. **IMPORTANT:** Add `firebase-config.js` to your `.gitignore` so you don't accidentally commit your API keys:
   ```
   data/firebase-config.js
   ```

### 4. Run Locally

Open `index.html` in a web server (not via `file://` protocol):

```bash
# Option 1: Using npx (requires Node.js)
npx serve .

# Option 2: Using Python
python -m http.server 8000
# Then open http://localhost:8000

# Option 3: Using PHP
php -S localhost:8000
```

## Notes

- The project uses the Firebase SDK (compat build) for simpler browser usage.
- User progress is saved under `users/{uid}` with the following fields:
  - `unlockedIds` (array of achievement IDs)
  - `totalPoints` (number)
  - `lastUpdated` (timestamp)
- Friend lists and requests are stored in `users/{userId}/friends` and `friendRequests` collections.

## Troubleshooting

### "firebaseConfig not found" or "Firebase SDK not loaded"

- Ensure `data/firebase-config.js` exists and is properly populated with your credentials
- Verify that all Firebase SDK scripts are loaded in `index.html` before `firebase-service.js`
- Check the browser console (F12) for detailed error messages

### "Invalid API Key" or "auth/invalid-api-key"

- Make sure you copied the **Web app** configuration (not a service account key)
- Verify the `apiKey` in `firebase-config.js` is correct
- Ensure Google Sign-In provider is enabled in Firebase Console

### Google Sign-In not working

1. Make sure you're running on a local web server, not `file://`
2. Add your local URL to Firebase Console → Authentication → Sign-in Method → Authorized domains
   - For `http://localhost:8000`, add `localhost`
3. Check that Google provider is enabled in Firebase Console

### Friend search not working

- Ensure Firestore rules allow reading from `usersPublic` collection
- Try searching with a full or partial name (case-insensitive)
- Check the browser console for Firestore permission errors


If you still see issues after these checks, open the browser console to see the full error message, and verify the config in the web app's Firebase settings.

## Next steps

- Implement more complex merge behavior (preference UI), offline sync, and full emulator testing.
- Add test instructions with Firebase Emulator for local development.

## Cloud Functions & Admin Scripts

We've included a `functions` folder with callable Cloud Functions useful for admin/operation tasks (see `functions/README.md`). To deploy functions:

```bash
cd functions
npm install
firebase deploy --only functions
```

### Admin scripts

The `admin-scripts/setAdminClaim.js` script allows setting a custom admin claim for a user (useful to call admin-only functions such as `backupAllUsers`). Usage:

```bash
cd admin-scripts
npm install
node setAdminClaim.js /path/to/serviceAccount.json <uid>
```

Do NOT keep your service account JSON in the repo. Add it to `.gitignore` and keep it in a secure store.

