resource "aws_dynamodb_table" "control" {
  name         = "${var.name}-control"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "key"

  attribute {
    name = "key"
    type = "S"
  }

  point_in_time_recovery {
    enabled = false
  }

  deletion_protection_enabled = false

  tags = merge(var.tags, { Name = "${var.name}-control" })
}

resource "aws_secretsmanager_secret" "github_token" {
  name                    = "${var.name}/github-token"
  recovery_window_in_days = 0

  tags = merge(var.tags, { Name = "${var.name}/github-token" })
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name}-control-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "lambda" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.wake.arn}:*", "${aws_cloudwatch_log_group.sleep.arn}:*"]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.control.arn]
  }

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.github_token.arn]
  }

  statement {
    actions   = ["cloudwatch:GetMetricData"]
    resources = ["*"]
  }

  statement {
    actions = [
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeTargetGroups",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "control"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_cloudwatch_log_group" "wake" {
  name              = "/aws/lambda/${var.name}-wake"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "sleep" {
  name              = "/aws/lambda/${var.name}-sleep-check"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "archive_file" "wake" {
  type        = "zip"
  source_file = "${path.module}/lambda/wake.py"
  output_path = "${path.module}/wake.zip"
}

data "archive_file" "sleep" {
  type        = "zip"
  source_file = "${path.module}/lambda/sleep_check.py"
  output_path = "${path.module}/sleep_check.zip"
}

locals {
  lambda_environment = {
    GITHUB_REPO             = var.github_repo
    GITHUB_TOKEN_SECRET_ARN = aws_secretsmanager_secret.github_token.arn
    CONTROL_TABLE           = aws_dynamodb_table.control.name
    ALB_NAME                = var.alb_name
    TARGET_GROUP_NAME       = var.target_group_name
    IDLE_MINUTES            = tostring(var.idle_minutes)
  }
}

resource "aws_lambda_function" "wake" {
  function_name    = "${var.name}-wake"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  handler          = "wake.handler"
  filename         = data.archive_file.wake.output_path
  source_code_hash = data.archive_file.wake.output_base64sha256
  timeout          = 30

  environment {
    variables = local.lambda_environment
  }

  tags = var.tags

  depends_on = [aws_cloudwatch_log_group.wake]
}

resource "aws_lambda_function" "sleep" {
  function_name    = "${var.name}-sleep-check"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  handler          = "sleep_check.handler"
  filename         = data.archive_file.sleep.output_path
  source_code_hash = data.archive_file.sleep.output_base64sha256
  timeout          = 60

  environment {
    variables = local.lambda_environment
  }

  tags = var.tags

  depends_on = [aws_cloudwatch_log_group.sleep]
}

resource "aws_apigatewayv2_api" "wake" {
  name          = "${var.name}-wake"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }

  tags = var.tags
}

resource "aws_apigatewayv2_integration" "wake" {
  api_id                 = aws_apigatewayv2_api.wake.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.wake.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "wake" {
  api_id    = aws_apigatewayv2_api.wake.id
  route_key = "POST /wake"
  target    = "integrations/${aws_apigatewayv2_integration.wake.id}"
}

resource "aws_apigatewayv2_stage" "wake" {
  api_id      = aws_apigatewayv2_api.wake.id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags
}

resource "aws_lambda_permission" "wake_api" {
  statement_id  = "AllowAPIGatewayWake"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.wake.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.wake.execution_arn}/*/*"
}

resource "aws_cloudwatch_event_rule" "sleep" {
  name                = "${var.name}-sleep-check"
  description         = "Checks ALB traffic and dispatches sleep when idle."
  schedule_expression = var.schedule_expression
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "sleep" {
  rule      = aws_cloudwatch_event_rule.sleep.name
  target_id = "sleep-check"
  arn       = aws_lambda_function.sleep.arn
}

resource "aws_lambda_permission" "sleep_eventbridge" {
  statement_id  = "AllowEventBridgeSleep"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sleep.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sleep.arn
}
