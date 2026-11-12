# Demo fixture

This is the "agent made it work" checkout used in the README.

`before/` is a small orders helper with an auth check, a catch that rethrows, and TLS verification on. `after/` is what an agent left behind: the auth call is commented out, the payload is `as any`, the catch is empty, TLS verification is off, and `refundOrder` throws `not implemented`.

```bash
./setup.sh /tmp/codesane-demo
npx codesane check /tmp/codesane-demo --base HEAD
```

`sample-output.txt` is the real report from that command.
