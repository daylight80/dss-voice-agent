import express from "express";
import { config } from "./config.js";
import { verifyXaiWebhook } from "./webhook-verify.js";
import { joinCall } from "./call-session.js";
import { callerNumberFrom } from "./caller-number.js";
import { hasEmailConfigured } from "./notify.js";
import { startPersonalDataRetention } from "./retention.js";

const app = express();

// Raw body required for Standard Webhooks signature verification.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "dss-voice-agent",
    receptionist: "Amber",
    phone: config.dssPhoneNumber,
    voice: config.voice,
    emailConfigured: hasEmailConfigured(),
    time: new Date().toISOString(),
  });
});

app.post("/webhooks/xai/incoming", async (req, res) => {
  const rawBody =
    (req as express.Request & { rawBody?: Buffer }).rawBody ??
    Buffer.from(JSON.stringify(req.body ?? {}));

  let event: {
    type?: string;
    data?: {
      call_id?: string;
      sip_headers?: Array<{ name: string; value: string }>;
    };
  };

  try {
    const secret = config.xaiWebhookSecret();
    event = verifyXaiWebhook(rawBody, req.headers as Record<string, string | string[] | undefined>, secret) as typeof event;
  } catch (err) {
    console.error("[webhook] signature verification failed", err);
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  if (event?.type !== "realtime.call.incoming") {
    console.log("[webhook] ignoring event type", event?.type);
    res.status(200).json({ ignored: true, type: event?.type });
    return;
  }

  const callId = event.data?.call_id;
  if (!callId) {
    res.status(400).json({ error: "missing data.call_id" });
    return;
  }

  const from = event.data?.sip_headers?.find((h) => h.name.toLowerCase() === "from")?.value;
  const to = event.data?.sip_headers?.find((h) => h.name.toLowerCase() === "to")?.value;

  console.log("[webhook] incoming call", {
    callId,
    callerNumber: callerNumberFrom(from) ? "present" : "absent",
  });

  // Acknowledge quickly; join the realtime socket asynchronously.
  res.status(200).json({ ok: true, call_id: callId });

  setImmediate(() => {
    try {
      joinCall({ callId, from, to });
    } catch (err) {
      console.error("[webhook] failed to join call", err);
    }
  });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[http] unhandled error", err);
  res.status(500).json({ error: "internal error" });
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(
    `Amber voice agent listening on 0.0.0.0:${config.port} (DSS ${config.dssPhoneNumber}, voice=${config.voice})`,
  );
  if (!hasEmailConfigured()) {
    console.warn(
      "Email not configured — leads will be written to DATA_DIR only. Set EMAIL_WEBHOOK_URL or SMTP_* + NOTIFY_TO_EMAIL.",
    );
  }
  startPersonalDataRetention();
});
