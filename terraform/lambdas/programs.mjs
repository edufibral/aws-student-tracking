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
  return rawPath.replace(/^\/programs\/[^/]+$/, '/programs/{id}');
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

const createProgram = async (event) => {
  const body = parseBody(event);
  if (!body.name || !body.department) {
    return json(400, { message: 'name and department are required' });
  }

  const programId = body.programId || `program-${randomUUID()}`;
  await queueWrite('CREATE_PROGRAM', {
    programId,
    name: body.name,
    department: body.department
  });

  return json(202, { message: 'Program create queued', programId });
};

const listPrograms = async () => {
  const data = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': 'PROGRAMS',
        ':prefix': 'PROGRAM#'
      }
    })
  );

  return json(200, { items: data.Items || [] });
};

const getProgram = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });

  const data = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: 'PROGRAMS', SK: `PROGRAM#${id}` }
    })
  );

  if (!data.Item) return json(404, { message: 'Program not found' });
  return json(200, data.Item);
};

const updateProgram = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });
  const body = parseBody(event);

  await queueWrite('UPDATE_PROGRAM', { programId: id, ...body });
  return json(202, { message: 'Program update queued', programId: id });
};

const deleteProgram = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return json(400, { message: 'id is required' });

  await queueWrite('DELETE_PROGRAM', { programId: id });
  return json(202, { message: 'Program delete queued', programId: id });
};

const routes = {
  'OPTIONS /programs': preflight,
  'OPTIONS /programs/{id}': preflight,
  'POST /programs': createProgram,
  'GET /programs': listPrograms,
  'GET /programs/{id}': getProgram,
  'PUT /programs/{id}': updateProgram,
  'DELETE /programs/{id}': deleteProgram
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
