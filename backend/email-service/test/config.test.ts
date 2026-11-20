import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.ts';

const base = {
  KAFKA_BROKERS: 'kafka-0:9092, kafka-1:9092',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_test_key',
};

describe('loadConfig', () => {
  test('applies production-safe defaults', () => {
    const config = loadConfig(base);
    assert.deepEqual(config.kafka.brokers, ['kafka-0:9092', 'kafka-1:9092']);
    assert.equal(config.kafka.topic, 'triplanner.email.requests.v1');
    assert.equal(config.kafka.dlqTopic, 'triplanner.email.requests.v1.dlq');
    assert.equal(config.kafka.groupId, 'triplanner-email-service');
    assert.equal(config.kafka.ssl, false);
    assert.equal(config.kafka.ensureTopics, false);
    assert.equal(config.email.provider, 'resend');
    assert.equal(config.email.maxAttempts, 5);
    assert.equal(config.healthPort, 4200);
  });

  test('requires Kafka brokers', () => {
    assert.throws(() => loadConfig({ ...base, KAFKA_BROKERS: '' }), ConfigError);
  });

  test('requires an API key when Resend is the provider', () => {
    assert.throws(() => loadConfig({ ...base, RESEND_API_KEY: '' }), ConfigError);
  });

  test('allows the sink provider without a key', () => {
    const config = loadConfig({ KAFKA_BROKERS: 'kafka:9092', EMAIL_PROVIDER: 'sink' });
    assert.equal(config.email.provider, 'sink');
    assert.equal(config.email.resendApiKey, undefined);
  });

  test('parses SASL settings and rejects incomplete credentials', () => {
    const config = loadConfig({
      ...base,
      KAFKA_SASL_MECHANISM: 'SCRAM-SHA-512',
      KAFKA_SASL_USERNAME: 'triplanner',
      KAFKA_SASL_PASSWORD: 'secret',
    });
    assert.deepEqual(config.kafka.sasl, {
      mechanism: 'scram-sha-512',
      username: 'triplanner',
      password: 'secret',
    });

    assert.throws(
      () =>
        loadConfig({
          ...base,
          KAFKA_SASL_MECHANISM: 'scram-sha-512',
          KAFKA_SASL_USERNAME: 'triplanner',
        }),
      ConfigError,
    );
  });

  test('rejects a SASL password without a mechanism', () => {
    assert.throws(() => loadConfig({ ...base, KAFKA_SASL_PASSWORD: 'secret' }), ConfigError);
  });

  test('validates ports, booleans and provider names', () => {
    assert.throws(() => loadConfig({ ...base, HEALTH_PORT: '0' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, KAFKA_SSL: 'yes' }), ConfigError);
    assert.throws(() => loadConfig({ ...base, EMAIL_PROVIDER: 'smtp' }), ConfigError);
  });

  test('normalizes the app URL and custom topics', () => {
    const config = loadConfig({
      ...base,
      APP_URL: 'https://triplanner.example.com/',
      KAFKA_TOPIC: 'custom.email.v1',
    });
    assert.equal(config.appUrl, 'https://triplanner.example.com');
    assert.equal(config.kafka.dlqTopic, 'custom.email.v1.dlq');
  });
});
