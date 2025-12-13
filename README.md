# Steam Life - Firebase Integration

This project integrates Firebase Authentication and Firestore to save user achievement progress per user.

## Setup

1. Create a Firebase project at https://console.firebase.google.com.
2. Add a Web app and copy the config values.
3. Enable the Google Authentication provider only. In the Firebase Console, under Authentication → Sign-in Method, enable 'Google' and configure support.
4. Enable Firestore in Native mode.
5. Add the following security rule (or adjust as necessary) in the Firestore rules tab:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

6. Copy `data/firebase-config.example.js` to `data/firebase-config.js` and fill with your project's values.
7. Open `index.html` in your browser (or serve with a local web server).

## Notes

- The project uses the Firebase SDK (compat build) for simpler browser usage.
- User progress is saved under `users/{uid}` with the following fields:
  - `unlockedIds` (array of achievement IDs)
  - `totalPoints` (number)
  - `lastUpdated` (timestamp)

## Troubleshooting

If you get an "Invalid API Key" or "auth/invalid-api-key" error, check the following:

- Ensure you copied the *Web* app configuration keys (not the admin service account) into `data/firebase-config.js` (copy from `data/firebase-config.example.js`).
- Make sure the `apiKey` property is present and correct.
- If you are testing locally, avoid opening `index.html` using `file://` — run a local web server instead (recommended: `npx serve` or `python -m http.server`):

```bash
npx serve .
# or
python -m http.server 8000
```

- Add your testing origin to Firebase Console (Firebase Authentication -> Sign-in Method -> Authorized domains). For local testing add `localhost` and the port used (for example: `localhost:3000`).
- Make sure the Google sign-in provider is enabled in Firebase Console -> Authentication -> Sign-in Method.

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

