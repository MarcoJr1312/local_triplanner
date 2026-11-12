output "uploads_bucket_name" {
  value = aws_s3_bucket.uploads.bucket
}

output "uploads_bucket_arn" {
  value = aws_s3_bucket.uploads.arn
}

output "kms_key_arn" {
  value = aws_kms_key.this.arn
}

output "secret_arns" {
  description = "Map of logical secret name to ARN."
  value       = { for name, secret in aws_secretsmanager_secret.this : name => secret.arn }
}
