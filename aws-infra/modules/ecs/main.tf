locals {
  namespace = "${var.name}.local"
}

resource "aws_ecs_cluster" "this" {
  name = "${var.name}-cluster"
  tags = merge(var.tags, { Name = "${var.name}-cluster" })
}

resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = local.namespace
  description = "Service discovery for ${var.name}"
  vpc         = var.vpc_id
  tags        = merge(var.tags, { Name = local.namespace })
}

resource "aws_service_discovery_service" "api" {
  name = "api"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_service_discovery_service" "agent" {
  name = "agent"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this.id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = values(var.secret_arns)
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "task" {
  # Both the API and the agent read the RDS-managed credential at boot to build
  # DATABASE_URL (the execution role only covers `secrets` injected by ECS).
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_secret_arn]
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.aws_region}.amazonaws.com"]
    }
  }

  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      "arn:aws:s3:::${var.s3_bucket}",
      "arn:aws:s3:::${var.s3_bucket}/*",
    ]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      "arn:aws:dynamodb:${var.aws_region}:*:table/${var.dynamodb_table}",
      "arn:aws:dynamodb:${var.aws_region}:*:table/${var.dynamodb_table}/index/*",
    ]
  }

  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "app"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.name}/web"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name}/api"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "agent" {
  name              = "/ecs/${var.name}/agent"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = var.web_image
      essential = true
      portMappings = [
        { containerPort = 3000, hostPort = 3000, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        { name = "NEXT_PRIVATE_BACKEND_URL", value = "http://api.${local.namespace}:4000/graphql" },
        { name = "AGENT_ORIGIN", value = "http://agent.${local.namespace}:4100" },
        { name = "NEXT_PUBLIC_DEMO_AUTH_ENABLED", value = "false" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.web.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3000/login || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image
      essential = true
      portMappings = [
        { containerPort = 4000, hostPort = 4000, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOCAL_ONLY", value = "0" },
        { name = "LOCAL_PORT", value = "4000" },
        { name = "DB_HOST", value = var.db_host },
        { name = "DB_PORT", value = tostring(var.db_port) },
        { name = "DB_NAME", value = var.db_name },
        { name = "DB_SECRET_ARN", value = var.db_secret_arn },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "DYNAMODB_TABLE", value = var.dynamodb_table },
        { name = "S3_BUCKET", value = var.s3_bucket },
        { name = "AGENT_BASE_URL", value = "http://agent.${local.namespace}:4100" },
        { name = "FIREBASE_PROJECT_ID", value = var.firebase_project_id },
      ]
      secrets = [
        { name = "HASDATA_API_KEY", valueFrom = var.secret_arns["hasdata-api-key"] },
        { name = "RESEND_API_KEY", valueFrom = var.secret_arns["resend-api-key"] },
        { name = "INTERNAL_TOKEN", valueFrom = var.secret_arns["internal-token"] },
        { name = "FIREBASE_SERVICE_ACCOUNT_JSON", valueFrom = var.secret_arns["firebase-service-account"] },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f 'http://localhost:4000/graphql?query=%7B__typename%7D' || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_task_definition" "agent" {
  family                   = "${var.name}-agent"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "agent"
      image     = var.agent_image
      essential = true
      portMappings = [
        { containerPort = 4100, hostPort = 4100, protocol = "tcp" }
      ]
      environment = [
        { name = "DB_HOST", value = var.db_host },
        { name = "DB_PORT", value = tostring(var.db_port) },
        { name = "DB_NAME", value = var.db_name },
        { name = "DB_SECRET_ARN", value = var.db_secret_arn },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "FIREBASE_PROJECT_ID", value = var.firebase_project_id },
        { name = "AGENT_DEMO_MODE", value = "false" },
      ]
      secrets = [
        { name = "DEEPSEEK_API_KEY", valueFrom = var.secret_arns["deepseek-api-key"] },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.agent.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "agent"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:4100/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_service" "web" {
  name            = "${var.name}-web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  platform_version                  = "LATEST"
  health_check_grace_period_seconds = 120

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.web_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.alb_target_group_arn
    container_name   = "web"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200
  wait_for_steady_state              = false
  enable_execute_command             = true

  tags = var.tags
}

resource "aws_ecs_service" "api" {
  name            = "${var.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  platform_version       = "LATEST"
  enable_execute_command = true

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.api_security_group_id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn   = aws_service_discovery_service.api.arn
    container_name = "api"
    # No container_port: Cloud Map uses A records here (SRV would require it).
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200
  wait_for_steady_state              = false

  tags = var.tags
}

resource "aws_ecs_service" "agent" {
  name            = "${var.name}-agent"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.agent.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  platform_version       = "LATEST"
  enable_execute_command = true

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.agent_security_group_id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn   = aws_service_discovery_service.agent.arn
    container_name = "agent"
    # No container_port: Cloud Map uses A records here (SRV would require it).
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200
  wait_for_steady_state              = false

  tags = var.tags
}
