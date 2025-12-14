# Deploy instructions

1. Create a Firebase project in the Console
2. Create and download service account JSON (if you need admin scripts) and do NOT commit it to repo.
3. Copy `data/firebase-config.js` to `data/firebase-config.js` and paste your web app config values.
4. Deploy Firestore rules:

```bash
firebase deploy --only firestore:rules
```

5. Deploy Cloud Functions:

```bash
cd functions
npm install
firebase deploy --only functions
```

6. Optional: deploy hosting to serve the project (if you want):

```bash
firebase init hosting
# follow prompts
firebase deploy --only hosting
```

7. To set an admin claim for a user:

```bash
cd admin-scripts
npm install
node setAdminClaim.js /path/to/service-account.json <uid>
```
