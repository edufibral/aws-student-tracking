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

const createStudent = async (event) => {
  const body = parseBody(event);

  if (!body.name || !body.email) {
    return json(400, { message: 'name and email are required' });
  }

  const studentId = body.studentId || `student-${randomUUID()}`;
  await queueWrite('CREATE_STUDENT', {
    studentId,
    name: body.name,
    email: body.email
  });

  return json(202, { message: 'Student create queued', studentId });
};

const listStudents = async () => {
  const data = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': 'STUDENTS',
        ':prefix': 'STUDENT#'
      }
    })
  );

  return json(200, { items: data.Items || [] });
};

const getStudent = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });

  const data = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: 'STUDENTS', SK: `STUDENT#${id}` }
    })
  );

  if (!data.Item) return json(404, { message: 'Student not found' });
  return json(200, data.Item);
};

const updateStudent = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });
  const body = parseBody(event);

  await queueWrite('UPDATE_STUDENT', { studentId: id, ...body });
  return json(202, { message: 'Student update queued', studentId: id });
};

const deleteStudent = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });

  await queueWrite('DELETE_STUDENT', { studentId: id });
  return json(202, { message: 'Student delete queued', studentId: id });
};

const routes = {
  'POST /students': createStudent,
  'GET /students': listStudents,
  'GET /students/{id}': getStudent,
  'PUT /students/{id}': updateStudent,
  'DELETE /students/{id}': deleteStudent
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
