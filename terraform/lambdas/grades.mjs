import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const WRITE_QUEUE_URL = process.env.WRITE_QUEUE_URL;

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

const getMethod = (event) => event.httpMethod || event.requestContext?.http?.method;

const getPath = (event) => {
  const rawPath = event.path || event.requestContext?.http?.path || '';
  return rawPath.replace(/^\/grades\/[^/]+$/, '/grades/{id}');
};

const getRouteKey = (event) => {
  if (event.routeKey && event.routeKey !== '$default') {
    return event.routeKey;
  }

  return `${getMethod(event)} ${getPath(event)}`;
};
const getMethod = (event) => event.httpMethod || event.requestContext?.http?.method;
const getPath = (event) => event.resource || event.requestContext?.http?.path || event.path;

const parseBody = (event) => {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const queueWrite = async (eventType, payload) => {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: WRITE_QUEUE_URL,
      MessageBody: JSON.stringify({ eventType, payload })
    })
  );
};

const assignGrade = async (event) => {
  const body = parseBody(event);

  if (!body.studentId || !body.courseId || !body.grade) {
    return json(400, { message: 'studentId, courseId and grade are required' });
  }

  const gradeId = body.gradeId || `grade-${randomUUID()}`;
  await queueWrite('ASSIGN_GRADE', {
    gradeId,
    studentId: body.studentId,
    courseId: body.courseId,
    grade: body.grade
  });

  return json(202, { message: 'Grade assignment queued', gradeId });
};

const listGrades = async () => {
  const data = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': 'GRADES',
        ':prefix': 'GRADE#'
      }
    })
  );

  return json(200, { items: data.Items || [] });
};

const getGrade = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });

  const data = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: 'GRADES', SK: `GRADE#${id}` }
    })
  );

  if (!data.Item) return json(404, { message: 'Grade not found' });
  return json(200, data.Item);
};

const updateGrade = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });
  const body = parseBody(event);

  await queueWrite('UPDATE_GRADE', { gradeId: id, ...body });
  return json(202, { message: 'Grade update queued', gradeId: id });
};

const deleteGrade = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });

  await queueWrite('DELETE_GRADE', { gradeId: id });
  return json(202, { message: 'Grade delete queued', gradeId: id });
};

const routes = {
  'POST /grades': assignGrade,
  'GET /grades': listGrades,
  'GET /grades/{id}': getGrade,
  'PUT /grades/{id}': updateGrade,
  'DELETE /grades/{id}': deleteGrade
};

export const handler = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);
  const routeKey = `${method} ${path}`;
  const route = routes[routeKey];

  if (!route) return json(404, { message: 'Route not found', routeKey });

  try {
    return await route(event);
  } catch (error) {
    return json(500, { message: 'Internal server error', error: error.message });
  }
};
