/**
 * Manifold Hub — Proxy fetch for site scanner (CORS bypass).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url: reqUrl }) => {
  const target = reqUrl.searchParams.get('url');
  if (!target || !target.startsWith('http')) {
    return json({ error: 'Invalid url' }, { status: 400 });
  }
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
    });
    const html = await res.text();
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Fetch failed' }, { status: 502 });
  }
};
