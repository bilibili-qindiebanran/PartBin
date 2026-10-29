import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, destroyFixture, createAdminAccount, createUserAccount, request } from './helpers.js';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function multipartBody(buffer, boundary = '----partbintest') {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, buffer, tail]), boundary };
}

describe('照片', () => {
  let ctx;
  let admin;
  let viewer;

  beforeEach(async () => {
    ctx = await createFixture();
    admin = await createAdminAccount(ctx);
    viewer = await createUserAccount(ctx, 'viewer');
  });

  afterEach(async () => {
    await destroyFixture(ctx);
  });

  function upload(buffer, cookie = admin.cookie) {
    const { body, boundary } = multipartBody(buffer);
    return request(ctx.app, {
      method: 'POST',
      url: '/api/photos',
      cookie,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  it('上传、读取与 sha256 去重', async () => {
    const first = await upload(PNG);
    expect(first.statusCode).toBe(201);
    const photo = first.json().photo;
    expect(photo.mime).toBe('image/png');

    const second = await upload(PNG);
    expect(second.json().photo.id).toBe(photo.id);

    const read = await request(ctx.app, {
      url: `/api/photos/${photo.id}`,
      cookie: viewer.cookie,
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toContain('image/png');

    const anonymous = await request(ctx.app, { url: `/api/photos/${photo.id}` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('拒绝非图片与只读账号上传', async () => {
    const text = Buffer.from('not an image');
    const invalid = await upload(text);
    expect(invalid.statusCode).toBe(415);

    const forbidden = await upload(PNG, viewer.cookie);
    expect(forbidden.statusCode).toBe(403);
  });

  it('相册排序、引用保护与移出后清理', async () => {
    const created = await request(ctx.app, {
      method: 'POST',
      url: '/api/items',
      cookie: admin.cookie,
      payload: { name: '带照片的板子', quantity: 1 },
    });
    const itemId = created.json().item.id;
    const photo = (await upload(PNG)).json().photo;

    const attach = await request(ctx.app, {
      method: 'PUT',
      url: `/api/items/${itemId}/photos`,
      cookie: admin.cookie,
      payload: { photoIds: [photo.id] },
    });
    expect(attach.statusCode).toBe(200);
    expect(attach.json().photos).toHaveLength(1);

    const detail = await request(ctx.app, {
      url: `/api/items/${itemId}`,
      cookie: admin.cookie,
    });
    expect(detail.json().item.photos).toHaveLength(1);

    const blocked = await request(ctx.app, {
      method: 'DELETE',
      url: `/api/photos/${photo.id}`,
      cookie: admin.cookie,
    });
    expect(blocked.statusCode).toBe(409);

    const detach = await request(ctx.app, {
      method: 'PUT',
      url: `/api/items/${itemId}/photos`,
      cookie: admin.cookie,
      payload: { photoIds: [] },
    });
    expect(detach.statusCode).toBe(200);

    const gone = await request(ctx.app, {
      url: `/api/photos/${photo.id}`,
      cookie: admin.cookie,
    });
    expect(gone.statusCode).toBe(404);
  });
});
