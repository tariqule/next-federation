# NF-038: Server Action request failed

## What happened

A Server Action request got a response that is not a Server Action response, and the response
carried no NF code: a `5xx` status, an unexpected status, a content type other than
`text/x-component`, or no body. Or the remote did not start answering within the remote's
`actions.timeoutMs` (only when the remote sets it), and the request was aborted. The caller's
promise rejected; the action may or may not have run.

## Why

A `5xx` means the remote, or something between the browser and the remote (a proxy, load balancer
or CDN), failed: the remote is down or restarting, timed out, or could not start the response
stream. Another status or content type usually means the request reached something that is not the
remote's `/_nf/action` endpoint, for example an error page served by a proxy.

## How to fix

Check the remote's server log and that the remote's `base` URL reaches it, including through any
proxy in front of it. A `5xx` is not retried by the island runtime: retry the action from your own
code if it is safe to run twice. A `404` without an NF code is reported as `NF-031`, and a `413` as
`NF-032`. For a timeout ("did not answer within N ms"), find what makes the action slow on the
remote, or raise `actions.timeoutMs` in its `nextFederationIslands` options.

See [Server Actions: errors](../guides/server-actions.md#errors).
