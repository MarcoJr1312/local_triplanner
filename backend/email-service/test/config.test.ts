import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.ts';

const base = {
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test_key',
};

describe('loadConfig', () => {
  test('applies broker and delivery defaults', () => {
    const config = loadConfig(base);
    assert.equal(config.broker.url, 'http://127.0.0.1:8080');
    assert.equal(config.broker.topic, 'TripInvitation');
    assert.equal(config.broker.consumer, 'email-service');
    assert.equal(config.broker.dlqTopic, 'TripInvitation.dlq');
    assert.equal(config.broker.batchSize, 10);
    assert.equal(config.broker.waitSeconds, 20);
    assert.equal(config.email.provider, 'resend');
    assert.equal(config.email.maxAttempts, 5);
    assert.equal(config.healthPort, 4200);
  });

  test('requires an API key when Resend is the provider', () => {
    assert.throws(() => loadConfig({ ...base, RESEND_API_KEY: '' }), ConfigError);
  });

  test('allows the sink provider without a key', () => {
    const config = loadConfig({ EMAIL_PROVIDER: 'sink' });
    assert.equal(config.email.provider, 'sink');
    assert.equal(config.email.resendApiKey, undefined);
  });

  test('validates the broker URL and topic names', () => {
    assert.throws(() => loadConfig({ ...base, BROKER_URL: 'not-a-url' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, BROKER_URL: 'ftp://broker' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, BROKER_TOPIC: 'bad topic' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, BROKER_CONSUMER: 'bad/consumer' }), ConfigError);
  });

  test('validates broker numeric bounds', () => {
    assert.throws(() => loadConfig({ ...base, BROKER_BATCH_SIZE: '0' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, BROKER_BATCH_SIZE: '101' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, BROKER_WAIT_SECONDS: '31' }), ConfigError);
  });

  test('validates ports, providers and log levels', () => {
    assert.throws(() => loadConfig({ ...base, HEALTH_PORT: '0' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, EMAIL_PROVIDER: 'smtp' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, LOG_LEVEL: 'verbose' }), ConfigError);
  });

  test('normalizes the app URL and derives the DLQ topic', () => {
    const config = loadConfig({
      ...base,
      APP_URL: 'https://triplanner.example.com/',
      BROKER_TOPIC: 'CustomTopic',
    });
    assert.equal(config.appUrl, 'https://triplanner.example.com');
    assert.equal(config.broker.dlqTopic, 'CustomTopic.dlq');
  });
});
