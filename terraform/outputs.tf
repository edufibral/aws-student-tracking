output "api_base_url" {
  description = "Base URL for frontend configuration"
  value       = "https://${aws_api_gateway_rest_api.api.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_api_gateway_stage.stage.stage_name}"
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.student_tracker.name
}

output "write_queue_url" {
  value = aws_sqs_queue.write_events.url
}
