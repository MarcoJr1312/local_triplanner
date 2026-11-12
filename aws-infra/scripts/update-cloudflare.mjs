#!/usr/bin/env node
/**
 * Point the Cloudflare CNAME at the current ALB DNS name.
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_ZONE_ID
 *   APP_HOSTNAME            e.g. demo.example.com
 *
 * Usage:
 *   node aws-infra/scripts/update-cloudflare.mjs <alb-dns-name>
 */

const albDns = process.argv[2];
const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const hostname = process.env.APP_HOSTNAME;
const proxied = (process.env.CLOUDFLARE_PROXIED ?? 'false').toLowerCase() === 'true';

if (!albDns || !token || !zoneId || !hostname) {
  console.error('Missing albDns, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID or APP_HOSTNAME');
  process.exit(1);
}

const base = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function cf(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(`Cloudflare error: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.result;
}

const existing = await cf(
  `?type=CNAME&name=${encodeURIComponent(hostname)}`
);

const payload = {
  type: 'CNAME',
  name: hostname,
  content: albDns,
  ttl: 60,
  proxied,
};

if (Array.isArray(existing) && existing.length > 0) {
  const record = existing[0];
  await cf(`/${record.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  console.log(`Updated ${hostname} -> ${albDns}`);
} else {
  await cf('', { method: 'POST', body: JSON.stringify(payload) });
  console.log(`Created ${hostname} -> ${albDns}`);
}
