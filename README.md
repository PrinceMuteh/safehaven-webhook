# safeHaven webhook receiver

Small Firebase Functions project for receiving and responding to webhook requests.

## Endpoint

After deployment, the HTTP function name is `webhook`.

The current handler expects a `POST` request with a JSON body shaped like the sample in
[`samplewehbook.json`](/Users/primetech/Web development/safeHaven-webhook/samplewehbook.json).
It extracts `data.object._id`, calls `GET /cards/authorizations/{id}` on the Sudo API, and
replies with the fetched authorization details.

## Environment variables

Set these before running or deploying:

- `SUDO_API_KEY`: your Sudo API key, sent as the `Authorization` header
- `SUDO_API_BASE_URL`: optional, defaults to `https://api.sandbox.sudo.cards`

## Local development

1. Install Firebase CLI if needed.
2. Run `cd functions && npm install`
3. Export your API key:

```bash
export SUDO_API_KEY="your-api-key"
```

4. Run `firebase emulators:start --only functions`

Example request:

```bash
curl -X POST http://127.0.0.1:5001/YOUR_PROJECT_ID/us-central1/webhook \
  -H "Content-Type: application/json" \
  --data @../samplewehbook.json
```

## Deploy

Run:

```bash
firebase deploy --only functions:webhook
```

For Firebase, set the secret in the environment you deploy from, for example:

```bash
export SUDO_API_KEY="your-api-key"
firebase deploy --only functions:webhook
```

## Next step

If you want, I can make the API key use Firebase Secret Manager instead of a plain environment variable.
