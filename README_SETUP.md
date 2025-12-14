# Steam Life - Conquistas

Uma aplicação web para rastrear conquistas em estilo Steam, com suporte a amigos e pontos.

## Setup Local

### 1. Configurar Firebase

```bash
# Copie o arquivo de exemplo
cp data/firebase-config.example.js data/firebase-config.js
```

Edite `data/firebase-config.js` e preencha suas credenciais do Firebase:
- Vá para https://console.firebase.google.com/
- Selecione seu projeto
- Clique em "Project Settings" (⚙️)
- Na aba "Your apps", clique no web app (ou crie um)
- Copie as credenciais para o arquivo

### 2. Rodar localmente

```bash
# Abra index.html em um navegador local (Chrome, Firefox, etc.)
# Ou use um servidor HTTP simples:

python3 -m http.server 8000
# ou
npx http-server
```

Acesse `http://localhost:8000`

## Deploy no GitHub Pages

### 1. Adicionar Secrets ao GitHub

No seu repositório:
1. Vá para **Settings** → **Secrets and variables** → **Actions**
2. Clique em **New repository secret** e adicione cada um:

```
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
```

### 2. Ativar GitHub Pages

1. Vá para **Settings** → **Pages**
2. Em "Source", selecione **Deploy from a branch**
3. Selecione a branch `gh-pages` e pasta `root`
4. Clique em **Save**

### 3. Fazer Push

```bash
git add .
git commit -m "Setup Firebase for GitHub Pages"
git push origin main
```

O GitHub Action vai:
- Injetar as credenciais via Secrets
- Criar o arquivo `data/firebase-config.js`
- Fazer deploy automático para GitHub Pages

Seu site estará disponível em: `https://SEU_USERNAME.github.io/SEU_REPOSITORIO/`

## Estrutura do Projeto

```
├── index.html              # HTML principal
├── styles.css              # Estilos
├── script.js               # Lógica da aplicação
├── firebase-service.js     # Wrapper do Firebase
├── data/
│   ├── achievements.json   # Dados de conquistas
│   ├── areas.json          # Dados de áreas
│   └── firebase-config.js  # Credenciais (local) - não commit!
└── admin-scripts/          # Scripts administrativos
```

## Firestore - Estrutura de Dados

### Collections

**usersPublic** - Perfis públicos
```json
{
  "displayName": "André Santos",
  "photoURL": "...",
  "searchName": "andré santos"
}
```

**users/{uid}** - Dados privados do usuário
```json
{
  "unlockedIds": [1, 2, 3],
  "totalPoints": 150
}
```

**friendRequests** - Solicitações de amizade
```json
{
  "fromUid": "...",
  "toUid": "...",
  "status": "pending|accepted|rejected",
  "createdAt": {...}
}
```

**users/{uid}/friends/{friendUid}** - Lista de amigos
```json
{
  "uid": "...",
  "since": {...}
}
```

## Troubleshooting

### "Cannot read properties of undefined (reading 'signInWithGoogle')"

1. Abra o console do navegador (F12 → Console)
2. Procure por mensagens `[firebase-service.js]`
3. Verifique se:
   - `firebase-config.js` existe
   - As credenciais estão corretas
   - Os scripts do Firebase carregaram

### Amigos não aparecem

1. Certifique-se de que está logado
2. Verifique as Firestore rules (Security Rules)
3. Confira que os amigos têm `usersPublic` document criado

## Firestore Security Rules

Para desenvolvimento (abra para todos):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Para produção (exemplo seguro):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Public profiles - anyone can read
    match /usersPublic/{uid} {
      allow read: if true;
      allow write: if request.auth.uid == uid;
    }
    
    // Private user data - only owner
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    
    // Friend requests
    match /friendRequests/{requestId} {
      allow read: if request.auth.uid == resource.data.fromUid || request.auth.uid == resource.data.toUid;
      allow create: if request.auth.uid != null;
      allow update, delete: if request.auth.uid == resource.data.fromUid || request.auth.uid == resource.data.toUid;
    }
    
    // Friends list
    match /users/{uid}/friends/{friendId} {
      allow read: if request.auth.uid == uid;
      allow write: if request.auth.uid == uid;
    }
  }
}
```

## Licença

MIT
