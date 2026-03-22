"use strict";

require("dotenv").config();

const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SUDO_API_BASE_URL =
  process.env.SUDO_API_BASE_URL || "https://api.sandbox.sudo.cards";
const SUDO_API_KEY = process.env.SUDO_API_KEY || "";

function redactHeaders(headers = {}) {
  const clonedHeaders = { ...headers };

  for (const key of Object.keys(clonedHeaders)) {
    if (key.toLowerCase() === "authorization") {
      clonedHeaders[key] = "[REDACTED]";
    }
  }

  return clonedHeaders;
}

function logInfo(message, details = {}) {
  console.log(
    JSON.stringify({
      level: "info",
      message,
      timestamp: new Date().toISOString(),
      ...details,
    })
  );
}

function logWarn(message, details = {}) {
  console.warn(
    JSON.stringify({
      level: "warn",
      message,
      timestamp: new Date().toISOString(),
      ...details,
    })
  );
}

function logError(message, details = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      message,
      timestamp: new Date().toISOString(),
      ...details,
    })
  );
}

app.use(express.json());
app.use((req, res, next) => {
  const startedAt = Date.now();

  logInfo("Incoming request", {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    headers: redactHeaders(req.headers),
    body: req.body ?? null,
  });

  res.on("finish", () => {
    logInfo("Request completed", {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

function buildWebhookSummary(payload) {
  const eventType = payload?.type || "unknown";
  const object = payload?.data?.object || {};
  const pendingRequest = object.pendingRequest || {};
  const transactionMetadata = object.transactionMetadata || {};
  const customer = object.customer || {};
  const account = object.account || {};

  return {
    eventType,
    environment: payload?.environment || null,
    eventId: payload?._id || payload?.data?._id || null,
    objectId: object._id || null,
    status: object.status || null,
    approved: object.approved ?? null,
    amount: pendingRequest.amount ?? object.amount ?? null,
    currency: pendingRequest.currency || object.currency || null,
    reference: transactionMetadata.reference || null,
    customerName: customer.name || null,
    accountNumber: account.accountNumber || null,
  };
}

function isAuthorizationNotFoundError(error) {
  const message = error?.responseBody?.message;
  return error?.status === 400 && message === "Authorization not found.";
}

function isAuthorizationNotFoundResponse(responseBody) {
  return (
    responseBody?.statusCode === 400 &&
    responseBody?.message === "Authorization not found."
  );
}

async function fetchAuthorizationById(id) {
  if (!SUDO_API_KEY) {
    throw new Error("Missing SUDO_API_KEY environment variable.");
  }

  const url = `${SUDO_API_BASE_URL}/cards/authorizations/${encodeURIComponent(id)}`;
  logInfo("Calling Sudo authorization endpoint", {
    url,
    headers: {
      Authorization: "[REDACTED]",
    },
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: SUDO_API_KEY,
    },
  });

  const rawText = await response.text();
  let data = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { raw: rawText };
    }
  }

  logInfo("Received Sudo authorization response", {
    url,
    statusCode: response.status,
    ok: response.ok,
    responseBody: data,
  });

  if (isAuthorizationNotFoundResponse(data)) {
    const error = new Error("Authorization lookup failed.");
    error.status = 400;
    error.responseBody = data;
    throw error;
  }

  if (!response.ok) {
    const error = new Error("Authorization lookup failed.");
    error.status = response.status;
    error.responseBody = data;
    throw error;
  }

  return data;
}

app.get("/", (_req, res) => {
  logInfo("Health check hit");

  return res.status(200).json({
    ok: true,
    service: "safehaven-webhook-server",
  });
});

app.post("/webhook", async (req, res) => {
  const contentType = req.get("content-type") || "";
  const body = req.body ?? null;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    logWarn("Webhook rejected: invalid JSON body", {
      method: req.method,
      path: req.path,
      contentType,
    });

    return res.status(400).json({
      ok: false,
      error: "Invalid webhook payload. Expected a JSON object body.",
    });
  }

  const summary = buildWebhookSummary(body);

  if (!summary.eventType || !summary.objectId) {
    logWarn("Webhook rejected: missing required fields", {
      method: req.method,
      path: req.path,
      contentType,
      body,
    });

    return res.status(400).json({
      ok: false,
      error: "Invalid webhook payload. Missing event type or object identifier.",
    });
  }

  logInfo("Webhook parsed successfully", {
    method: req.method,
    path: req.path,
    summary,
  });

  const expectedEventType = "authorization.request";

  if (summary.eventType !== expectedEventType) {
    return res.status(200).json({
      ok: true,
      ignored: true,
      message: `Ignored webhook event type: ${summary.eventType || "unknown"}.`,
    });
  }

  try {
    const authorization = await fetchAuthorizationById(summary.objectId);

    logInfo("Authorization fetched successfully", {
      objectId: summary.objectId,
      reference: summary.reference,
      authorizationId: authorization?.data?._id || null,
      authorizationResponse: authorization,
    });

    return res.status(200).json({
      statusCode: 200,
      data: {
        responseCode: "00",
      },
    });
  } catch (error) {
    logError("Authorization fetch failed", {
      objectId: summary.objectId,
      reference: summary.reference,
      error: error.message,
      status: error.status || 500,
      responseBody: error.responseBody || null,
    });

    if (isAuthorizationNotFoundError(error)) {
      return res.status(400).json({
        statusCode: 400,
        data: {
          responseCode: "51",
        },
      });
    }

    return res.status(error.status || 500).json({
      ok: false,
      message: "Webhook received but authorization lookup failed.",
      eventType: summary.eventType,
      authorizationId: summary.objectId,
      reference: summary.reference,
      error: error.message,
      details: error.responseBody || null,
      receivedAt: new Date().toISOString(),
    });
  }
});

app.listen(PORT, () => {
  logInfo("Webhook server listening", {
    port: PORT,
    sudoApiBaseUrl: SUDO_API_BASE_URL,
    hasSudoApiKey: Boolean(SUDO_API_KEY),
    nodeVersion: process.version,
    envLoaded: true,
  });
});

process.on("uncaughtException", (error) => {
  logError("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection", {
    reason,
  });
});
