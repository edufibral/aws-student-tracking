output "api_base_url" {
  description = "Base URL for frontend configuration"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.student_tracker.name
}

output "write_queue_url" {
  value = aws_sqs_queue.write_events.url
}
