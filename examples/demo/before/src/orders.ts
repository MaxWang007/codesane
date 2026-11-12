export function getOrders(req: Request) {
  requireAuth(req);
  try {
    const rows = fetchOrders(req.user);
    return respond(rows);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export function connectUpstream(url: string) {
  return tls.connect({ url, rejectUnauthorized: true });
}
