output "db_endpoint" {
  value = aws_db_instance.this.address
}

output "db_port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "db_master_user_secret_arn" {
  value     = aws_db_instance.this.master_user_secret[0].secret_arn
  sensitive = true
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.locations.name
}

output "dynamodb_table_arn" {
  value = aws_dynamodb_table.locations.arn
}
