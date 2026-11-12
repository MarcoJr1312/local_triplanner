output "state_bucket" {
  description = "S3 bucket for Terraform state."
  value       = aws_s3_bucket.state.bucket
}

output "account_id" {
  description = "AWS account ID."
  value       = data.aws_caller_identity.current.account_id
}
