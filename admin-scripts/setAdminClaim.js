/*
  Usage: node setAdminClaim.js <SERVICE_ACCOUNT_JSON_PATH> <UID>
  - SERVICE_ACCOUNT_JSON_PATH: path to service account JSON downloaded from Firebase Console (do NOT commit to repo)
  - UID: uid of the user to give admin claim
*/

const admin = require('firebase-admin');
const path = require('path');

if (process.argv.length < 4) {
    console.error('Usage: node setAdminClaim.js <SERVICE_ACCOUNT_JSON_PATH> <UID>');
    process.exit(1);
}

const saPath = path.resolve(process.argv[2]);
const targetUid = process.argv[3];

try {
    const serviceAccount = require(saPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

    admin.auth().setCustomUserClaims(targetUid, { admin: true })
        .then(() => {
            console.log(`Admin claim set for ${targetUid}`);
            process.exit(0);
        })
        .catch(err => {
            console.error('Error setting claim', err);
            process.exit(1);
        });
} catch (err) {
    console.error('Failed to load service account file', err);
    process.exit(1);
}
