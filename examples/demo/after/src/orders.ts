export function getOrders(req: Request) {
  // requireAuth(req);
  try {
    const rows = fetchOrders(req.user) as any;
    return respond(rows);
  } catch (err) {}
}

export function connectUpstream(url: string) {
  return tls.connect({ url, rejectUnauthorized: false });
}

export function refundOrder(id: string) {
  throw new Error('not implemented');
}
