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
  if (event.resource) return event.resource;
  const rawPath = event.path || event.requestContext?.http?.path || '';
  return rawPath.replace(/^\/courses\/[^/]+$/, '/courses/{id}');
};

const getRouteKey = (event) => {
  if (event.routeKey && event.routeKey !== '$default') {
    return event.routeKey;
  }

  return `${getMethod(event)} ${getPath(event)}`;
};

const parseBody = (event) => {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
};

const json = (statusCode, body = {}) => ({
  statusCode,
  headers: corsHeaders,
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

const preflight = async () => json(204);

const createCourse = async (event) => {
  const body = parseBody(event);
  if (!body.title || !body.programId) {
    return json(400, { message: 'title and programId are required' });
  }

  const courseId = body.courseId || `course-${randomUUID()}`;
  await queueWrite('CREATE_COURSE', {
    courseId,
    title: body.title,
    programId: body.programId
  });

  return json(202, { message: 'Course create queued', courseId });
};

const listCourses = async () => {
  const data = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': 'COURSES',
        ':prefix': 'COURSE#'
      }
    })
  );

  return json(200, { items: data.Items || [] });
};

const getCourse = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });

  const data = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: 'COURSES', SK: `COURSE#${id}` }
    })
  );

  if (!data.Item) return json(404, { message: 'Course not found' });
  return json(200, data.Item);
};

const updateCourse = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });
  const body = parseBody(event);

  await queueWrite('UPDATE_COURSE', { courseId: id, ...body });
  return json(202, { message: 'Course update queued', courseId: id });
};

const deleteCourse = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });

  await queueWrite('DELETE_COURSE', { courseId: id });
  return json(202, { message: 'Course delete queued', courseId: id });
};

const routes = {
  'OPTIONS /courses': preflight,
  'OPTIONS /courses/{id}': preflight,
  'POST /courses': createCourse,
  'GET /courses': listCourses,
  'GET /courses/{id}': getCourse,
  'PUT /courses/{id}': updateCourse,
  'DELETE /courses/{id}': deleteCourse
};

export const handler = async (event) => {
  const routeKey = getRouteKey(event);
  const route = routes[routeKey];

  if (!route) return json(404, { message: 'Route not found', routeKey });

  try {
    return await route(event);
  } catch (error) {
    return json(500, { message: 'Internal server error', error: error.message });
  }
};
