# cloudflare-proxy
## WARNING
You should not use this as a proxy to take advantage of an address rotation (in order to circumvent the rate-limiting of a third-party service), also avoid scrapping data via this. On the other hand, you can totally use this as an internal proxy to hide the ORIGIN IP address of your server or anything that is part of a legitimate use. Refer to the CloudFlare TOS to determine if your use is legitimate.


Worker Cloudflare qui exécute des requêtes **HTTPS** sortantes à partir d’un JSON décrivant la requête (`method`, `headers`, `body`). Utile pour appeler des APIs depuis un environnement où vous ne pouvez pas faire de requêtes directes, ou pour centraliser des appels via un point unique sécurisé par clé API.

## Prérequis

- Compte [Cloudflare](https://dash.cloudflare.com/)
- [Node.js](https://nodejs.org/) 18+
- CLI Wrangler : `npm install` dans ce dépôt (inclus en devDependency)

## Installation locale

```bash
git clone <url-du-repo> cloudflare-proxy
cd cloudflare-proxy
npm ci
```

## Configuration

### Secret `API_KEY`

Le Worker refuse les appels sans en-tête `x-api-key` valide.

**En local** (fichier non versionné) :

```bash
echo 'API_KEY=votre-cle-secrete' > .dev.vars
```

**En production** :

```bash
npx wrangler secret put API_KEY
```

Ou : Dashboard → Workers & Pages → votre Worker → **Settings** → **Variables** → **Secrets** → ajouter `API_KEY`.

## Développement local

```bash
npm run dev
```

Le Worker est disponible sur l’URL affichée par Wrangler (souvent `http://127.0.0.1:8787`).

## Déploiement

### Depuis votre machine

```bash
npx wrangler login
npm run deploy
```

### Depuis Cloudflare (Workers Builds + Git)

1. Liez ce dépôt dans **Workers & Pages** → **Create** → **Connect to Git**.
2. Cloudflare lit `wrangler.toml` (`main` = `src/index.ts`, bundlé par Wrangler au deploy).
3. **Build command** (Workers Builds) : `npm run build` — ne pas mettre `[build]` dans `wrangler.toml` (sinon `wrangler deploy` relance la commande et échoue sans `package-lock.json`).
4. Ajoutez le secret **`API_KEY`** dans les paramètres du Worker (voir ci-dessus).
5. Chaque push sur la branche configurée déclenche build + déploiement.

Aucun artefact de build séparé n’est requis : le bundle final est produit par `wrangler deploy` à partir du TypeScript.

## Utilisation

### Endpoints

| Méthode | Chemin   | Description                          |
|---------|----------|--------------------------------------|
| `GET`   | `/`      | Aide JSON (schéma minimal)           |
| `POST`  | `/proxy` | Exécute la requête HTTPS décrite     |

### Authentification

En-tête obligatoire sur `POST /proxy` :

```http
x-api-key: <valeur de API_KEY>
Content-Type: application/json
```

### Corps de la requête (`POST /proxy`)

| Champ      | Type     | Obligatoire | Description |
|------------|----------|-------------|-------------|
| `url`      | string   | oui         | URL cible **https://** uniquement |
| `method`   | string   | non         | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` (défaut : `GET`) |
| `headers`  | object   | non         | En-têtes envoyés à la cible (clé → valeur string) |
| `body`     | string \| object \| null | non | Corps de la requête ; si `object` et `Content-Type` JSON, sérialisé en JSON |

### Exemple `curl`

```bash
curl -sS -X POST "https://cloudflare-proxy.<votre-compte>.workers.dev/proxy" \
  -H "x-api-key: $API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://httpbin.org/post",
    "method": "POST",
    "headers": {
      "content-type": "application/json"
    },
    "body": { "hello": "world" }
  }'
```

### Réponse du Worker

Toujours JSON (HTTP 200 côté Worker si la requête a été traitée), avec la réponse de la cible encapsulée :

```json
{
  "status": 200,
  "statusText": "OK",
  "headers": { "...": "..." },
  "body": "..."
}
```

`body` est le corps brut de la réponse distante (texte). En cas d’erreur côté Worker (auth, JSON invalide, URL interdite, etc.), vous recevez `{ "error": "..." }` avec le code HTTP approprié (`401`, `400`, `403`, `502`, etc.).

## Sécurité

- Seules les URLs **`https://`** sont acceptées.
- Hôtes privés / locaux (localhost, RFC1918, etc.) sont **refusés** pour limiter le SSRF.
- Protégez **`API_KEY`** : secret Cloudflare uniquement, jamais dans le dépôt.

## Scripts npm

| Script        | Rôle |
|---------------|------|
| `npm run dev` | Wrangler en local |
| `npm run deploy` | Déploiement production |
| `npm run typecheck` | Vérification TypeScript |
| `npm run build` | Alias vers `typecheck` (utilisé par Workers Builds) |

## Licence

Projet privé — adaptez selon vos besoins.
