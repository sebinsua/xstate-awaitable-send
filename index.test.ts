import { createMachine, assign } from "xstate";

import { createAwaitableSend } from "./";

function createSequentialAsyncMachine() {
  type Context = {
    userId: number;
    user?: {
      id: string;
      name: string;
      friends: number[];
    };
    friends: Array<{ id: number; name: string }>;
  };
  type Events = { type: "START" };
  type Typestate =
    | { value: "initial"; context: Context }
    | { value: "gettingUser"; context: Context }
    | { value: "gettingFriends"; context: Context }
    | { value: "success"; context: Context };

  return createMachine<Context, Events, Typestate>({
    id: "sequential-async-machine",
    context: { userId: 42, user: undefined, friends: [] },
    initial: "initial",
    states: {
      initial: {
        on: { START: "gettingUser" },
      },
      gettingUser: {
        invoke: {
          src: function getUserInfo(context) {
            return new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    id: context.userId,
                    name: "Main person",
                    friends: [12, 34, 66, 4],
                  }),
                1000
              )
            );
          },
          onDone: {
            target: "gettingFriends",
            actions: assign({
              user: (context, event) => event.data,
            }),
          },
        },
      },
      gettingFriends: {
        invoke: {
          src: function getUserFriends(context) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const { friends } = context.user!;

            return Promise.all(
              friends.map(
                (friendId) =>
                  new Promise((resolve) =>
                    setTimeout(
                      () =>
                        resolve({
                          id: friendId,
                          name: `Friend ${friendId}`,
                        }),
                      1000
                    )
                  )
              )
            );
          },
          onDone: {
            target: "success",
            actions: assign({
              friends: (context, event) => event.data,
            }),
          },
        },
      },
      success: {
        type: "final",
      },
    },
  });
}

function createMachineWithRestingStates(
  target: "empty" | "penultimate" | "finality" = "penultimate"
) {
  type Context = Record<string, unknown>;
  type Events = { type: "START" } | { type: "SELECT" } | { type: "BACK" };
  type Typestate =
    | { value: "initial"; context: Context }
    | { value: "empty"; context: Context }
    | { value: "penultimate"; context: Context }
    | { value: "finality"; context: Context };

  return createMachine<Context, Events, Typestate>({
    id: "machine-with-resting-states",
    context: {},
    initial: "initial",
    states: {
      initial: {
        on: { START: target },
      },
      empty: {},
      penultimate: {
        on: {
          SELECT: "finality",
          BACK: "initial",
        },
      },
      finality: {
        type: "final",
      },
    },
  });
}

function createMachineWithErrorOnLaterStep() {
  type Context = Record<string, unknown>;
  type Events = { type: "START" };
  type Typestate =
    | { value: "initial"; context: Context }
    | { value: "started"; context: Context }
    | { value: "invoker1Succeeded"; context: Context }
    | { value: "invoker1Errored"; context: Context }
    | { value: "invoker2Succeeded"; context: Context }
    | { value: "invoker2Errored"; context: Context };

  return createMachine<Context, Events, Typestate>({
    id: "machine-with-error-on-later-step",
    initial: "initial",
    context: {},
    states: {
      initial: {
        on: { START: "started" },
      },
      started: {
        invoke: {
          id: "invoker-1",
          src: () => Promise.resolve("Hello World!"),
          onDone: { target: "invoker1Succeeded" },
          onError: { target: "invoker1Errored" },
        },
      },
      invoker1Succeeded: {
        invoke: {
          id: "invoker-2",
          src: () => Promise.reject(new Error("This is an error.")),
          onDone: { target: "invoker2Succeeded" },
          onError: { target: "invoker2Errored" },
        },
      },
      invoker1Errored: {},
      invoker2Succeeded: {},
      invoker2Errored: {},
    },
  });
}

test("should resolve slow sequential steps all the way to the end", async () => {
  const send = createAwaitableSend(createSequentialAsyncMachine());

  const [state] = await send("START");

  expect(state).toMatchObject({ value: "success" });
  expect(state.context).toMatchInlineSnapshot(`
Object {
  "friends": Array [
    Object {
      "id": 12,
      "name": "Friend 12",
    },
    Object {
      "id": 34,
      "name": "Friend 34",
    },
    Object {
      "id": 66,
      "name": "Friend 66",
    },
    Object {
      "id": 4,
      "name": "Friend 4",
    },
  ],
  "user": Object {
    "friends": Array [
      12,
      34,
      66,
      4,
    ],
    "id": 42,
    "name": "Main person",
  },
  "userId": 42,
}
`);
});

test("should resolve when the machine is done", async () => {
  const send = createAwaitableSend(createMachineWithRestingStates("finality"));

  const [state] = await send("START");
  expect(state).toMatchObject({ value: "finality" });
});

test("should resolve if it ends up on a state node that needs another application-level event from the user to exit", async () => {
  const send = createAwaitableSend(
    createMachineWithRestingStates("penultimate")
  );

  const [state] = await send("START");
  expect(state).toMatchObject({ value: "penultimate" });
});

test("should resolve if it ends up on a state node with no exit", async () => {
  const send = createAwaitableSend(createMachineWithRestingStates("empty"));

  const [state] = await send("START");
  expect(state).toMatchObject({ value: "empty" });
});

test("should resolve if a developer-specified invoke completes", async () => {
  const send = createAwaitableSend(createMachineWithErrorOnLaterStep(), {
    waitUntil: { id: "invoker-1" },
  });

  const [state, eventData] = await send("START");
  expect(state).toMatchObject({ value: "invoker1Succeeded" });
  expect(eventData).toEqual("Hello World!");
});

test("should reject when there is an error", async () => {
  expect.assertions(1);
  try {
    const send = createAwaitableSend(createMachineWithErrorOnLaterStep());

    await send("START");
  } catch (error) {
    expect(error).toStrictEqual(new Error("This is an error."));
  }
});
