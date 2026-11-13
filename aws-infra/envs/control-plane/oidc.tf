data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = var.tags
}

locals {
  github_owner = split("/", var.github_repo)[0]
  github_repo  = split("/", var.github_repo)[1]
  # GitHub now emits `owner@owner_id/repo@repo_id` in the sub claim. Accept both
  # the new and the legacy form; both are pinned to the same owner/repo/ref.
  github_subjects = compact([
    "repo:${var.github_repo}:ref:refs/heads/main",
    var.github_owner_id != "" && var.github_repo_id != "" ? "repo:${local.github_owner}@${var.github_owner_id}/${local.github_repo}@${var.github_repo_id}:ref:refs/heads/main" : "",
  ])
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only the default branch can assume the deploy role. repository_dispatch
    # runs the workflow from the default branch, so this is sufficient for
    # wake/sleep and it keeps every feature branch out of the account.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_subjects
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.project}-github-actions"
  description        = "GitHub Actions role for wake/sleep Terraform workflows"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
  tags               = var.tags
}

# Demo convenience: the workflows create and destroy the whole app stack.
# Tighten this to the exact services used before using the repo for real work.
resource "aws_iam_role_policy_attachment" "github_admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
