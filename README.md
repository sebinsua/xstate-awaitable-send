# `xstate-awaitable-send`

[![Build Status](https://github.com/sebinsua/xstate-awaitable-send/workflows/CI/badge.svg?branch=main)](https://github.com/sebinsua/xstate-awaitable-send/actions)
[![NPM version](https://badge.fury.io/js/xstate-awaitable-send.svg)](http://badge.fury.io/js/xstate-awaitable-send)

An `await`able [`xstate`](https://xstate.js.org/) [`Interpreter#send`](https://xstate.js.org/api/classes/interpreter.html#send) made for use in backend applications with request-response communication (e.g. Node servers such as `fastify`, `express` and `koa`).

It will wait until any internal [invocations of services](https://xstate.js.org/docs/guides/communication.html) have completed and resolve either (a) [when it reaches a `StateNode` that is 'final'](https://xstate.js.org/docs/guides/final.html), (b) when it is waiting for further events from the user, or (c) when the current `StateNode` has no more events that can cause transitions.

## Usage

```ts
import { createAwaitableSend } from "xstate-awaitable-send";

import { asyncMachine } from "./asyncMachine";

export async function doThing(currentState) {
  const send = createAwaitableSend(
    interpret(asyncMachine).start(State.create(currentState))
  );

  const [state] = await send("YOUR_EVENT");

  // ...
}

// ...
```
