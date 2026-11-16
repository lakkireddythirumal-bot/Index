# Feed Plant Dashboard Push Notifications

## Implemented
- Supabase Edge Function: push-notify
- RLS-protected subscription and event tables; no anon/authenticated table grants
- VAPID Web Push; private key is server-only
- Daily MIS-ready dedupe by report date
- System-alert dedupe by alert key
- iOS Home Screen PWA support (requires iOS/iPadOS 16.4+)

## Supabase Edge Function secrets
Set these under Supabase Dashboard → Edge Functions → Secrets. Never commit values:
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY
- VAPID_SUBJECT (e.g. mailto:admin@example.com)
- PUSH_WEBHOOK_SECRET (n8n bearer token)
- PUSH_DEVICE_ENROLLMENT_TOKEN (device enrollment + browser system-alert token)

Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Edge Functions.

## Device setup
Serve the Dashboard over HTTPS. On iPhone: Safari → Share → Add to Home Screen; open the installed app; tap Enable Push; allow notifications; enter the device enrollment token once. It is stored in that browser's local storage.

## n8n event body
POST to https://iqxprkmainafqjodpfdk.supabase.co/functions/v1/push-notify
Authorization: Bearer <PUSH_WEBHOOK_SECRET>
Content-Type: application/json

{
  "action": "notify",
  "event": "daily_mis_ready",
  "status": "success",
  "report_date": "YYYY-MM-DD",
  "workflow_run_id": "n8n execution id"
}

Keep the n8n HTTP node disabled until the webhook secret is configured in an n8n credential and assigned to it.
