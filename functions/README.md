# Firebase Cloud Functions for Steam Life

This folder contains Cloud Functions to support admin tasks and data migrations for Steam Life.

## Provided Functions

- `importUserProgress` (callable): Import user progress (merge or overwrite). Callable by the user for their own UID or by admin to import any UID.
- `getLeaderboard` (callable): Returns top users by `totalPoints`.
- `backupAllUsers` (callable): Admin-only function to copy `users` collection documents into a backup collection.

## Setup & Deploy

1. Install Firebase CLI

```bash
npm install -g firebase-tools
```

2. Login and initialize (if you haven't):

```bash
firebase login
firebase init functions
```

3. Install dependencies and deploy

```bash
cd functions
npm install
firebase deploy --only functions
```

## Local Emulator

You can run the functions locally and test callable functions with the emulator:

```bash
firebase emulators:start --only functions,firestore,auth
```

When testing callable functions from a local web page, set the functions origin or use the functions emulator host in the SDK initialization.

## Security

- `importUserProgress`: requires authentication. Only the same user or users with `admin` claim can import data for a target uid other than themselves.
- `backupAllUsers` requires `admin` claim.

### Setting admin claim

You can set an admin claim using the Admin SDK (example Node.js script) or via Firebase Console custom claims (no direct UI):

```bash
node ../admin-scripts/setAdminClaim.js /path/to/service-account.json <uid>
```

RISK: Running the script requires a service account with appropriate permissions; keep the JSON file private and out of version control.

Make sure to protect the service account JSON and never commit it to source control.
