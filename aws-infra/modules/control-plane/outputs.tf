output "wake_url" {
  description = "HTTP API endpoint that dispatches the wake workflow."
  # $default stage invoke_url carries a trailing slash; do not double it.
  value = "${trimsuffix(aws_apigatewayv2_stage.wake.invoke_url, "/")}/wake"
}

output "control_table_name" {
  value = aws_dynamodb_table.control.name
}

output "github_token_secret_arn" {
  value = aws_secretsmanager_secret.github_token.arn
}

output "wake_lambda_name" {
  value = aws_lambda_function.wake.function_name
}

output "sleep_lambda_name" {
  value = aws_lambda_function.sleep.function_name
}
