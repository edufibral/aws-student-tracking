import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME;

const now = () => new Date().toISOString();

const putItem = async (PK, SK, attributes) => {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK,
        SK,
        ...attributes,
        updatedAt: now()
      }
    })
  );
};

const deleteItem = async (PK, SK) => {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK, SK }
    })
  );
};

const updateItem = async (PK, SK, payload) => {
  const allowedFields = Object.entries(payload).filter(
    ([key]) => !['studentId', 'programId', 'courseId', 'gradeId'].includes(key)
  );

  if (allowedFields.length === 0) return;

  const names = { '#updatedAt': 'updatedAt' };
  const values = { ':updatedAt': now() };
  const sets = ['#updatedAt = :updatedAt'];

  allowedFields.forEach(([key, value], idx) => {
    const nameKey = `#f${idx}`;
    const valueKey = `:v${idx}`;
    names[nameKey] = key;
    values[valueKey] = value;
    sets.push(`${nameKey} = ${valueKey}`);
  });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK, SK },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    })
  );
};

const handlers = {
  CREATE_STUDENT: ({ studentId, name, email }) =>
    putItem('STUDENTS', `STUDENT#${studentId}`, {
      entityType: 'STUDENT',
      studentId,
      name,
      email,
      createdAt: now()
    }),
  UPDATE_STUDENT: ({ studentId, ...payload }) =>
    updateItem('STUDENTS', `STUDENT#${studentId}`, payload),
  DELETE_STUDENT: ({ studentId }) => deleteItem('STUDENTS', `STUDENT#${studentId}`),

  CREATE_PROGRAM: ({ programId, name, department }) =>
    putItem('PROGRAMS', `PROGRAM#${programId}`, {
      entityType: 'PROGRAM',
      programId,
      name,
      department,
      createdAt: now()
    }),
  UPDATE_PROGRAM: ({ programId, ...payload }) =>
    updateItem('PROGRAMS', `PROGRAM#${programId}`, payload),
  DELETE_PROGRAM: ({ programId }) => deleteItem('PROGRAMS', `PROGRAM#${programId}`),

  CREATE_COURSE: ({ courseId, title, programId }) =>
    putItem('COURSES', `COURSE#${courseId}`, {
      entityType: 'COURSE',
      courseId,
      title,
      programId,
      createdAt: now()
    }),
  UPDATE_COURSE: ({ courseId, ...payload }) =>
    updateItem('COURSES', `COURSE#${courseId}`, payload),
  DELETE_COURSE: ({ courseId }) => deleteItem('COURSES', `COURSE#${courseId}`),

  ASSIGN_GRADE: ({ gradeId, studentId, courseId, grade }) =>
    putItem('GRADES', `GRADE#${gradeId}`, {
      entityType: 'GRADE',
      gradeId,
      studentId,
      courseId,
      grade,
      createdAt: now()
    }),
  UPDATE_GRADE: ({ gradeId, ...payload }) =>
    updateItem('GRADES', `GRADE#${gradeId}`, payload),
  DELETE_GRADE: ({ gradeId }) => deleteItem('GRADES', `GRADE#${gradeId}`)
};

export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    const body = JSON.parse(record.body || '{}');
    const fn = handlers[body.eventType];
    if (!fn) {
      console.warn('Unknown event type', body.eventType);
      continue;
    }
    await fn(body.payload || {});
  }
};
