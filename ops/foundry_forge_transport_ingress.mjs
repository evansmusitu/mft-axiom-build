const TOKEN_SHA256 = '2e824e7ab96ac861870422c70ed95a3a4f21d0f97d38efe98ad0159647d24e35';
const MAX_CHUNK_CHARS = 60000;

function j(value, status = 200) {
  return new Response(JSON.stringify(value) + '\n', {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function authorized(request) {
  const token = request.headers.get('x-upload-token') || '';
  if (!token || token.length > 256) return false;
  return (await sha256Hex(token)) === TOKEN_SHA256;
}

async function state(env) {
  return await env.TRANSPORT_DB.prepare('SELECT finalized, part_count, total_chars, base64_sha256, bundle_sha256 FROM transport_state WHERE id=1').first();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      const s = await state(env);
      return j({schema:'musitu.forge.transport_ingress_health.v1', status:'READY', finalized:Boolean(s?.finalized)});
    }

    if (request.method === 'POST' && /^\/chunk\/\d+$/.test(url.pathname)) {
      if (!(await authorized(request))) return j({error:'unauthorized'}, 401);
      const s = await state(env);
      if (s?.finalized) return j({error:'transport_finalized'}, 409);
      const index = Number(url.pathname.split('/').pop());
      if (!Number.isInteger(index) || index < 0 || index > 999) return j({error:'chunk_index_invalid'}, 400);
      const expected = (url.searchParams.get('sha256') || '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expected)) return j({error:'chunk_sha256_required'}, 400);
      const text = await request.text();
      if (!text || text.length > MAX_CHUNK_CHARS || !/^[A-Za-z0-9+/=]+$/.test(text)) return j({error:'chunk_content_invalid'}, 400);
      const actual = await sha256Hex(text);
      if (actual !== expected) return j({error:'chunk_sha256_mismatch'}, 400);
      const prior = await env.TRANSPORT_DB.prepare('SELECT sha256, size_chars FROM transport_chunks WHERE idx=?1').bind(index).first();
      if (prior) {
        if (prior.sha256 !== actual || Number(prior.size_chars) !== text.length) return j({error:'chunk_index_conflict'}, 409);
        return j({schema:'musitu.forge.transport_chunk_receipt.v1', index, size_chars:text.length, sha256:actual, idempotent:true});
      }
      await env.TRANSPORT_DB.prepare('INSERT INTO transport_chunks(idx,data,sha256,size_chars) VALUES(?1,?2,?3,?4)').bind(index,text,actual,text.length).run();
      return j({schema:'musitu.forge.transport_chunk_receipt.v1', index, size_chars:text.length, sha256:actual, idempotent:false}, 201);
    }

    if (request.method === 'POST' && url.pathname === '/finalize') {
      if (!(await authorized(request))) return j({error:'unauthorized'}, 401);
      const s = await state(env);
      if (s?.finalized) return j({error:'transport_finalized'}, 409);
      const body = await request.json().catch(() => null);
      const count = Number(body?.part_count);
      const total = Number(body?.total_chars);
      const base64Sha = String(body?.base64_sha256 || '').toLowerCase();
      const bundleSha = String(body?.bundle_sha256 || '').toLowerCase();
      if (!Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(total) || total < 1 || !/^[0-9a-f]{64}$/.test(base64Sha) || !/^[0-9a-f]{64}$/.test(bundleSha)) return j({error:'finalize_contract_invalid'}, 400);
      const result = await env.TRANSPORT_DB.prepare('SELECT idx,data,sha256,size_chars FROM transport_chunks ORDER BY idx').all();
      const rows = result.results || [];
      if (rows.length !== count || rows.some((r,i) => Number(r.idx) !== i)) return j({error:'chunk_sequence_incomplete', observed:rows.length}, 409);
      const joined = rows.map((r) => r.data).join('');
      if (joined.length !== total) return j({error:'transport_size_mismatch'}, 409);
      if ((await sha256Hex(joined)) !== base64Sha) return j({error:'transport_sha256_mismatch'}, 409);
      await env.TRANSPORT_DB.prepare('UPDATE transport_state SET finalized=1, part_count=?1, total_chars=?2, base64_sha256=?3, bundle_sha256=?4 WHERE id=1').bind(count,total,base64Sha,bundleSha).run();
      return j({schema:'musitu.forge.transport_finalization.v1', finalized:true, part_count:count, total_chars:total, base64_sha256:base64Sha, bundle_sha256:bundleSha});
    }

    if (request.method === 'GET' && url.pathname === '/manifest') {
      const s = await state(env);
      if (!s?.finalized) return j({error:'transport_not_finalized'}, 404);
      return j({schema:'musitu.forge.transport_public_manifest.v1', finalized:true, part_count:Number(s.part_count), total_chars:Number(s.total_chars), base64_sha256:s.base64_sha256, bundle_sha256:s.bundle_sha256, private_plaintext:false});
    }

    if (request.method === 'GET' && /^\/chunk\/\d+$/.test(url.pathname)) {
      const s = await state(env);
      if (!s?.finalized) return j({error:'transport_not_finalized'}, 404);
      const index = Number(url.pathname.split('/').pop());
      const row = await env.TRANSPORT_DB.prepare('SELECT data,sha256,size_chars FROM transport_chunks WHERE idx=?1').bind(index).first();
      if (!row) return j({error:'chunk_not_found'}, 404);
      return new Response(row.data, {status:200, headers:{'content-type':'text/plain; charset=utf-8','cache-control':'public, max-age=31536000, immutable','x-content-sha256':row.sha256,'x-content-chars':String(row.size_chars),'x-content-type-options':'nosniff'}});
    }

    return j({error:'route_not_found'}, 404);
  },
};
