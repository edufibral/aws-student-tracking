terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  lambdas = {
    students = {
      filename = "students.mjs"
      handler  = "students.handler"
    }
    programs = {
      filename = "programs.mjs"
      handler  = "programs.handler"
    }
    courses = {
      filename = "courses.mjs"
      handler  = "courses.handler"
    }
    grades = {
      filename = "grades.mjs"
      handler  = "grades.handler"
    }
    write_worker = {
      filename = "write-worker.mjs"
      handler  = "write-worker.handler"
    }
  }

  entity_routes = {
    students = "/students"
    programs = "/programs"
    courses  = "/courses"
    grades   = "/grades"
  }

  collection_methods = toset(["GET", "POST", "OPTIONS"])
  item_methods       = toset(["GET", "PUT", "DELETE", "OPTIONS"])

  collection_route_map = merge([
    for entity, path in local.entity_routes : {
      for method in local.collection_methods : "${method} ${path}" => entity
    }
  ]...)

  item_route_map = merge([
    for entity, path in local.entity_routes : {
      for method in local.item_methods : "${method} ${path}/{id}" => entity
    }
  ]...)

  route_map = merge(local.collection_route_map, local.item_route_map)
}

resource "aws_dynamodb_table" "student_tracker" {
  name         = "${var.project_name}-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Project = var.project_name
  }
}

resource "aws_sqs_queue" "write_events" {
  name                       = "${var.project_name}-write-events"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600
}

resource "aws_sqs_queue" "write_events_dlq" {
  name = "${var.project_name}-write-events-dlq"
}

resource "aws_sqs_queue_redrive_policy" "write_events_redrive" {
  queue_url = aws_sqs_queue.write_events.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.write_events_dlq.arn
    maxReceiveCount     = 4
  })
}

resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query"
        ]
        Resource = aws_dynamodb_table.student_tracker.arn
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = [
          aws_sqs_queue.write_events.arn,
          aws_sqs_queue.write_events_dlq.arn
        ]
      }
    ]
  })
}

resource "archive_file" "lambda_zip" {
  for_each = local.lambdas

  type        = "zip"
  source_file = "${path.module}/lambdas/${each.value.filename}"
  output_path = "${path.module}/build/${each.key}.zip"
}

resource "aws_lambda_function" "handlers" {
  for_each = local.lambdas

  function_name = "${var.project_name}-${each.key}"
  role          = aws_iam_role.lambda_exec.arn
  runtime       = "nodejs20.x"
  handler       = each.value.handler
  filename      = archive_file.lambda_zip[each.key].output_path

  source_code_hash = archive_file.lambda_zip[each.key].output_base64sha256
  timeout          = each.key == "write_worker" ? 30 : 10

  environment {
    variables = {
      TABLE_NAME      = aws_dynamodb_table.student_tracker.name
      WRITE_QUEUE_URL = aws_sqs_queue.write_events.url
    }
  }
}

resource "aws_lambda_event_source_mapping" "write_events" {
  event_source_arn = aws_sqs_queue.write_events.arn
  function_name    = aws_lambda_function.handlers["write_worker"].arn
  batch_size       = 10
  enabled          = true
}

resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project_name}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["*"]
    allow_methods = ["*"]
    allow_origins = ["*"]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  for_each = {
    students = aws_lambda_function.handlers["students"].invoke_arn
    programs = aws_lambda_function.handlers["programs"].invoke_arn
    courses  = aws_lambda_function.handlers["courses"].invoke_arn
    grades   = aws_lambda_function.handlers["grades"].invoke_arn
  }

  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = each.value
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "routes" {
  for_each = local.route_map

  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.lambda[each.value].id}"
}

resource "aws_lambda_permission" "api_invoke" {
  for_each = {
    students = aws_lambda_function.handlers["students"].function_name
    programs = aws_lambda_function.handlers["programs"].function_name
    courses  = aws_lambda_function.handlers["courses"].function_name
    grades   = aws_lambda_function.handlers["grades"].function_name
  }

  statement_id  = "AllowApiGatewayInvoke-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = var.stage_name
  auto_deploy = true
}
