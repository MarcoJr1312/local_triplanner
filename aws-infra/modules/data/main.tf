resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.private_data_subnet_ids
  tags       = merge(var.tags, { Name = "${var.name}-db-subnets" })
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-postgres16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = merge(var.tags, { Name = "${var.name}-postgres16" })
}

resource "aws_db_instance" "this" {
  identifier = "${var.name}-db"

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = var.db_name
  username = var.db_username

  # RDS creates and rotates the master password in Secrets Manager.
  manage_master_user_password = true

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.rds_security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name

  # Demo: single-AZ, no final snapshot, destroy is allowed.
  multi_az                = false
  publicly_accessible     = false
  skip_final_snapshot     = true
  deletion_protection     = false
  backup_retention_period = 1
  apply_immediately       = true

  auto_minor_version_upgrade   = true
  copy_tags_to_snapshot        = false
  performance_insights_enabled = false

  tags = merge(var.tags, { Name = "${var.name}-db" })
}

resource "aws_dynamodb_table" "locations" {
  name         = "${var.name}-locations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "place_id"
    type = "S"
  }

  attribute {
    name = "data_id"
    type = "S"
  }

  global_secondary_index {
    name = "place_id-index"
    key_schema {
      attribute_name = "place_id"
      key_type       = "HASH"
    }
    projection_type = "ALL"
  }

  global_secondary_index {
    name = "data_id-index"
    key_schema {
      attribute_name = "data_id"
      key_type       = "HASH"
    }
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  deletion_protection_enabled = false

  tags = merge(var.tags, { Name = "${var.name}-locations" })
}
