// Firebase Configuration Example
// Copy this file to firebase-config.js and fill in your Firebase project credentials
// DO NOT commit firebase-config.js to git (add it to .gitignore)

window.firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123def456"
};

/* HOW TO GET YOUR CREDENTIALS:
 * 1. Go to https://console.firebase.google.com/
 * 2. Select or create a Firebase project
 * 3. Click on "Project Settings" (gear icon)
 * 4. Under "Your apps", click on the web app (or create one if it doesn't exist)
 * 5. Copy the config object and paste the values above
 * 6. Rename this file to firebase-config.js in the same directory
 * 7. Reload the page
 */
