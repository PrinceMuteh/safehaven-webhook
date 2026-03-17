# safeHaven webhook receiver

Small Node.js server for Render that receives a webhook, extracts `data.object._id`, fetches
the authorization from the Sudo API, and returns:

```json
{
  "statusCode": 200,
  "data": {
    "responseCode": "00"
  }
}
```

when the lookup succeeds.

## Endpoint

The webhook endpoint is:

`POST /webhook`

## Environment variables

Set these in your local `.env` file or in Render environment variables:

- `SUDO_API_KEY`: your Sudo API key, sent as the `Authorization` header
- `SUDO_API_BASE_URL`: optional, for example `https://api.sudo.africa`
- `PORT`: optional, Render sets this automatically

## Local development

1. Run `npm install`
2. Run `npm start`

Example request:

```bash
curl -X POST http://127.0.0.1:3000/webhook \
  -H "Content-Type: application/json" \
  --data @samplewehbook.json
```

## Render deploy

- Build command: `npm install`
- Start command: `npm start`

Set `SUDO_API_KEY` and `SUDO_API_BASE_URL` in the Render dashboard under environment variables.
