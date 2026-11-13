output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_app_subnet_ids" {
  value = aws_subnet.private_app[*].id
}

output "private_data_subnet_ids" {
  value = aws_subnet.private_data[*].id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "web_security_group_id" {
  value = aws_security_group.web.id
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}

output "agent_security_group_id" {
  value = aws_security_group.agent.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}
