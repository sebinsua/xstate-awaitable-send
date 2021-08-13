import {
  interpret,
  StateMachine,
  Interpreter,
  InterpreterStatus,
} from "xstate";
import { ActionTypes } from "xstate/lib";
import { isMachine } from "xstate/lib/utils";

import type { Event, EventObject, State, StateSchema, Typestate } from "xstate";

type DefaultTypestate<TContext> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  context: TContext;
};

type EventDataAndStateTuple<
  TContext,
  TEvent extends EventObject,
  TStateSchema extends StateSchema<unknown>,
  TTypestate extends Typestate<TContext> = DefaultTypestate<TContext>
> = [
  ReturnType<State<TContext, TEvent, TStateSchema, TTypestate>["toJSON"]>,
  unknown
];

export const getEventDataAndState = <
  TContext,
  TEvent extends EventObject,
  TStateSchema extends StateSchema<unknown>,
  TTypestate extends Typestate<TContext> = DefaultTypestate<TContext>
>(
  state: State<TContext, TEvent, TStateSchema, TTypestate>,
  event: TEvent
): EventDataAndStateTuple<TContext, TEvent, TStateSchema, TTypestate> => [
  state.toJSON(),
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  event.data,
];

const isInternalEvent = (eventType: string) => {
  const { NullEvent, ...ActionTypesWithoutNullEvent } = ActionTypes;
  const otherInternalEventPrefixes = Object.values(ActionTypesWithoutNullEvent);
  return (
    eventType === NullEvent ||
    otherInternalEventPrefixes.some((internalEventPrefix) =>
      eventType.startsWith(internalEventPrefix)
    )
  );
};

type ExtractResultItem<TValue> =
  | { type: "ERROR"; error: Error }
  | { type: "DONE"; value: TValue }
  | { type: "IGNORE" };

function extractErrorOrDone<
  TContext,
  TStateSchema extends StateSchema<unknown>,
  TEvent extends EventObject,
  TTypestate extends Typestate<TContext> = DefaultTypestate<TContext>
>(
  state: State<TContext, TEvent, TStateSchema, TTypestate>,
  event: TEvent,
  options: CreateAwaitableSendOptions<
    TContext,
    TStateSchema,
    TEvent,
    TTypestate
  >
): ExtractResultItem<
  EventDataAndStateTuple<TContext, TEvent, TStateSchema, TTypestate>
> {
  const eventType = event.type;

  if (eventType === ActionTypes.Init) {
    return { type: "IGNORE" };
  }

  // See: https://www.w3.org/TR/scxml/#ErrorEvents
  if (
    eventType.startsWith(ActionTypes.ErrorPlatform) ||
    eventType.startsWith(ActionTypes.ErrorCommunication) ||
    eventType.startsWith(ActionTypes.ErrorExecution) ||
    eventType.startsWith(ActionTypes.ErrorCustom)
  ) {
    return {
      type: "ERROR",
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      error: event.data instanceof Error ? event.data : new Error(event.data),
    };
  }

  // If a `waitUntil` option is supplied we expect to resolve the Promise before it reaches
  // a final `StateNode` or point that it needs to wait for future events from users/consumers.
  if (options.waitUntil) {
    if (typeof options.waitUntil !== "function") {
      if (typeof options.waitUntil.id !== "string") {
        throw new Error(
          "The arguments to createAwaitableSend were invalid." +
            "`options.waitFor` must contain a string id."
        );
      }

      const doneType =
        options.waitUntil.type === undefined ||
        options.waitUntil.type === "invoke"
          ? ActionTypes.DoneInvoke
          : ActionTypes.DoneState;
      if (
        eventType.startsWith(doneType) &&
        eventType === `${doneType}.${options.waitUntil.id}`
      ) {
        return {
          type: "DONE",
          value: getEventDataAndState(state, event),
        };
      }
    } else if (options.waitUntil(state, event)) {
      return {
        type: "DONE",
        value: getEventDataAndState(state, event),
      };
    }

    return { type: "IGNORE" };
  }

  // If a `StateNode` has a final type, then it will already be marked as 'done' and handled
  // by the `onDone` handler.
  //
  // But, if the current `StateNode` isn't final we should still check for a 'soft final' by
  // checking to see whether the state machine has entered a resting state.
  //
  // It is in a resting state if:
  //
  // (1) There are no `state.nextEvents` that could cause another transition at all.
  // (2) The only `state.nextEvents` that could cause another transition are application-level
  //     events produced by the consumer/user (we exclude the internal XState events and the
  //     current event). Note that we don't consider this a 'resting state' unless there are
  //     also no internal events.
  //
  // If we have a resting state, the current work can be considered to have concluded and we
  // can resolve our `Promise`.
  //
  // See: https://xstate.js.org/api/classes/state.html#nextevents
  const nextEvents = state.nextEvents;
  const internalNextEvents = nextEvents.filter((nextEvent) =>
    isInternalEvent(nextEvent)
  );
  const consumerNextEventsNotCurrentlyProvided = nextEvents.filter(
    (nextEvent) => nextEvent !== eventType && !isInternalEvent(nextEvent)
  );

  if (
    nextEvents.length == 0 ||
    (consumerNextEventsNotCurrentlyProvided.length > 0 &&
      internalNextEvents.length === 0)
  ) {
    return {
      type: "DONE",
      value: getEventDataAndState(state, event),
    };
  }

  return { type: "IGNORE" };
}

export interface CreateAwaitableSendOptions<
  TContext,
  TStateSchema extends StateSchema<unknown>,
  TEvent extends EventObject,
  TTypestate extends Typestate<TContext> = DefaultTypestate<TContext>
> {
  waitUntil?:
    | {
        id: string;
        type?: "invoke" | "state";
      }
    | ((
        state: State<TContext, TEvent, TStateSchema, TTypestate>,
        event: TEvent
      ) => boolean);
  onTransition?: (
    state: State<TContext, TEvent, TStateSchema, TTypestate>,
    event: TEvent
  ) => Promise<void>;
}

export function createAwaitableSend<
  TContext,
  TStateSchema extends StateSchema<unknown>,
  TEvent extends EventObject,
  TTypestate extends Typestate<TContext> = DefaultTypestate<TContext>
>(
  serviceOrMachine:
    | Interpreter<TContext, TStateSchema, TEvent, TTypestate>
    | StateMachine<TContext, TStateSchema, TEvent, TTypestate>,
  options: CreateAwaitableSendOptions<
    TContext,
    TStateSchema,
    TEvent,
    TTypestate
  > = {}
): (
  event: Event<TEvent>
) => Promise<
  EventDataAndStateTuple<TContext, TEvent, TStateSchema, TTypestate>
> {
  if (
    !serviceOrMachine ||
    (serviceOrMachine instanceof Interpreter === false &&
      isMachine(serviceOrMachine) === false)
  ) {
    throw new Error(
      "The arguments to createAwaitableSend were invalid. " +
        "A service or machine must be supplied as the first argument."
    );
  }

  const service =
    serviceOrMachine instanceof Interpreter
      ? serviceOrMachine
      : interpret(serviceOrMachine);

  return async function awaitableSend(event) {
    if (
      !event ||
      (typeof event !== "string" && event && typeof event.type !== "string")
    ) {
      throw new Error(
        "The arguments to awaitableSend were invalid. " +
          "The event argument must be supplied and must be a string or an event object containing a type property."
      );
    }

    return new Promise((resolve, reject) => {
      service
        .onTransition(async (state, event) => {
          if (typeof options.onTransition === "function") {
            // We ignore the result of any custom `onTransition` but do not want to
            // reject our Promise on any errors within it.
            try {
              await options.onTransition(state, event);
            } catch (error) {
              reject(error);
            }
          }

          const result = extractErrorOrDone(state, event, options);
          if (result.type === "ERROR") {
            reject(result.error);
          } else if (result.type === "DONE") {
            resolve(result.value);
          }
        })
        .onDone((doneEvent) => {
          return resolve(
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            getEventDataAndState(service.state, doneEvent)
          );
        });

      service.send(event);

      if (service.status !== InterpreterStatus.Running) {
        service.start();
      }
    });
  };
}
