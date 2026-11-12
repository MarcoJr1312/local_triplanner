locals {
  secret_names = toset([
    "firebase-service-account",
    "hasdata-api-key",
    "resend-api-key",
    "deepseek-api-key",
    "internal-token",
  ])
}

resource "aws_kms_key" "this" {
  description             = "${var.name} app data key"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(var.tags, { Name = "${var.name}-app" })
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name}-app"
  target_key_id = aws_kms_key.this.key_id
}

resource "aws_s3_bucket" "uploads" {
  bucket        = "${var.name}-uploads-${var.account_id}"
  force_destroy = true

  tags = merge(var.tags, { Name = "${var.name}-uploads" })
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.this.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "deny_insecure_transport" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.uploads.arn,
      "${aws_s3_bucket.uploads.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  policy = data.aws_iam_policy_document.deny_insecure_transport.json
}

resource "aws_secretsmanager_secret" "this" {
  for_each = local.secret_names

  name                    = "${var.name}/${each.value}"
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = 0

  tags = merge(var.tags, {
    Name = "${var.name}/${each.value}"
  })
}
