"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const SUDO_API_BASE_URL =
  process.env.SUDO_API_BASE_URL || "";
const SUDO_API_KEY = process.env.SUDO_API_KEY || "";

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

async function fetchAuthorizationById(id) {
  if (!SUDO_API_KEY) {
    throw new Error("Missing SUDO_API_KEY environment variable.");
  }

  const url = `${SUDO_API_BASE_URL}/cards/authorizations/${encodeURIComponent(id)}`;
  logger.info("Fetching authorization by id", {
    id,
    encodedId: encodeURIComponent(id),
    url,
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
    } catch (error) {
      data = { raw: rawText };
    }
  }

  if (!response.ok) {
    const error = new Error("Authorization lookup failed.");
    error.status = response.status;
    error.responseBody = data;
    throw error;
  }

  return data;
}

exports.webhook = onRequest(
  {
    region: "us-central1",
    cors: false,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      return res.status(405).json({
        ok: false,
        error: "Method not allowed. Use POST.",
      });
    }

    const contentType = req.get("content-type") || "";
    const body = req.body ?? null;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      logger.warn("Webhook rejected: invalid JSON body", {
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
      logger.warn("Webhook rejected: missing required fields", {
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

    logger.info("Webhook received", {
      method: req.method,
      path: req.path,
      contentType,
      summary,
    });

    try {
      const authorization = await fetchAuthorizationById(summary.objectId);

      logger.info("Authorization fetched", {
        objectId: summary.objectId,
        reference: summary.reference,
        authorizationId: authorization?.data?._id || null,
      });

      return res.status(200).json({
        statusCode: 200,
        data: {
          responseCode: "00",
        },
      });
    } catch (error) {
      logger.error("Authorization fetch failed", {
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
  }
);
